require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const WorkflowRunner = require('./runner');
const WorkflowService = require('./workflowService');
const {
  addWorkflowJob,
  getJobStatus,
  scheduleWorkflow,
  removeScheduledWorkflow,
  listScheduledWorkflows
} = require('./queue');
const { resolveCredentials } = require('./utils/credentialResolver');
const { getBackgroundService } = require('./backgroundService');

const app = express();
const PORT = process.env.PORT || 3001;

// Basic in-memory workflow template store for the WorkflowService.
// This is used as a fallback if Supabase is not configured or a workflow
// is not found there.
const workflowTemplates = new Map();

// Supabase client for loading workflow templates from your DB
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  console.log('[Supabase] Client initialized for workflow template loading');
} else {
  console.warn('[Supabase] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set - using in-memory workflow store only');
}

const workflowService = new WorkflowService({
  loadWorkflowTemplate: async (workflowId) => {
    // 1) Try Supabase if configured
    if (supabase) {
      const { data, error } = await supabase
        .from('automations')
        .select('workflow')
        .eq('id', workflowId)
        .single();

      if (error) {
        console.error('[Supabase] Error loading workflow template:', error);
      } else if (data) {
        let template = data.workflow;

        // Handle case where workflow might be stored as JSON string
        if (typeof template === 'string') {
          try {
            template = JSON.parse(template);
          } catch (parseError) {
            console.error('[Supabase] Failed to parse workflow JSON string:', parseError);
            throw new Error('Invalid workflow JSON format in database');
          }
        }

        // Validate structure
        if (!template || typeof template !== 'object') {
          throw new Error('Workflow template must be a valid JSON object');
        }

        if (!Array.isArray(template.nodes)) {
          throw new Error('Workflow template must have a nodes array');
        }

        // Debug: log the structure to help diagnose issues
        console.log('[Supabase] Loaded workflow template:', {
          hasNodes: !!template.nodes,
          nodesCount: template.nodes.length,
          hasConnections: !!template.connections,
          nodeTypes: template.nodes.map(n => n.type),
          nodeNames: template.nodes.map(n => n.name),
        });

        return {
          template,
          requiredParameters: undefined, // Will be computed from template if needed
        };
      }
    }

    // 2) Fallback to in-memory registry (useful for local testing)
    return workflowTemplates.get(workflowId);
  },
  saveWorkflowTemplate: async (workflowId, template, requiredParameters) => {
    // Always keep a copy in memory
    workflowTemplates.set(workflowId, { template, requiredParameters });

    // Optionally persist to Supabase if configured
    if (supabase) {
      const { error } = await supabase
        .from('automations')
        .upsert({
          id: workflowId,
          workflow: template,
        });

      if (error) {
        console.error('[Supabase] Error saving workflow template:', error);
      }
    }
  },
});

// Enable CORS for Next.js app (localhost:3000)
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
  credentials: true
}));

app.use(express.json({ limit: '50mb' })); // Support large payloads for binary data

/**
 * POST /api/workflows/:id/execute
 * Execute a stored workflow template identified by :id with injected parameters.
 *
 * Request body:
 * {
 *   "parameters": { "PARAM_NAME": "value", ... },
 *   "initialData": {...},
 *   "tokens": {...},
 *   "tokenMapping": {...}
 * }
 */
app.post('/api/workflows/:id/execute', async (req, res) => {
  const workflowId = req.params.id;
  const {
    parameters = {},
    initialData = {},
    tokens = {},
    tokenMapping = {},
  } = req.body || {};

  if (!workflowId) {
    return res.status(400).json({ error: 'Workflow ID is required in URL path' });
  }

  try {
    const result = await workflowService.executeWorkflow(
      workflowId,
      parameters,
      { initialData, tokens, tokenMapping },
    );

    res.json(result);
  } catch (error) {
    if (error.code === 'MISSING_PARAMETERS') {
      return res.status(400).json({
        success: false,
        error: 'Missing parameters',
        missing: error.missing,
      });
    }

    if (/not found/i.test(error.message)) {
      return res.status(404).json({
        success: false,
        error: error.message,
      });
    }

    console.error('[API] WorkflowService execution error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

/**
 * GET /api/workflows/:id/parameters
 * Return the list of required parameter names for a stored workflow template.
 *
 * This is useful for chatbot/frontends to know what to ask the user.
 */
app.get('/api/workflows/:id/parameters', async (req, res) => {
  const workflowId = req.params.id;

  if (!workflowId) {
    return res.status(400).json({ error: 'Workflow ID is required in URL path' });
  }

  try {
    const requiredParameters = await workflowService.getRequiredParameters(workflowId);
    res.json({ requiredParameters });
  } catch (error) {
    if (/not found/i.test(error.message)) {
      return res.status(404).json({
        success: false,
        error: error.message,
      });
    }

    console.error('[API] WorkflowService parameters error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

/**
 * POST /execute
 * Execute a workflow immediately (synchronous)
 * 
 * Request body:
 * {
 *   workflow: {...},
 *   initialData: {...},
 *   tokens: {
 *     googleAccessToken: "...",
 *     openRouterApiKey: "...",
 *     ...
 *   },
 *   tokenMapping: {  // Optional: custom token name mapping
 *     "google_oauth_token": "googleAccessToken",
 *     ...
 *   }
 * }
 */
app.post('/execute', async (req, res) => {
  try {
    const { workflow, initialData, tokens, tokenMapping } = req.body;

    if (!workflow) {
      return res.status(400).json({ error: 'Workflow is required' });
    }

    console.log(`[API] Executing workflow: ${workflow.name || 'unnamed'}`);
    console.log(`[API] Request from: ${req.headers.origin || 'unknown'}`);
    if (tokens) {
      const tokenKeys = Object.keys(tokens).filter(key => tokens[key] !== null);
      console.log(`[API] Injecting tokens: ${tokenKeys.join(', ')}`);
    }
    if (tokenMapping) {
      console.log(`[API] Using custom token mapping: ${Object.keys(tokenMapping).join(', ')}`);
    }

    const runner = new WorkflowRunner();
    const result = await runner.execute(
      workflow,
      initialData || {},
      tokens || {},
      tokenMapping || {}
    );

    res.json(result);
  } catch (error) {
    console.error('[API] Execution error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /queue
 * Add a workflow to the queue (asynchronous)
 * 
 * Request body:
 * {
 *   workflow: {...},
 *   initialData: {...},
 *   tokens: {...},
 *   tokenMapping: {...}  // Optional: custom token name mapping
 * }
 */
app.post('/queue', async (req, res) => {
  try {
    const { workflow, initialData, tokens, tokenMapping } = req.body;

    if (!workflow) {
      return res.status(400).json({ error: 'Workflow is required' });
    }

    console.log(`[API] Queuing workflow: ${workflow.name || 'unnamed'}`);
    if (tokens) {
      const tokenKeys = Object.keys(tokens).filter(key => tokens[key] !== null);
      console.log(`[API] Injecting tokens: ${tokenKeys.join(', ')}`);
    }
    if (tokenMapping) {
      console.log(`[API] Using custom token mapping: ${Object.keys(tokenMapping).join(', ')}`);
    }

    const jobId = await addWorkflowJob(
      workflow,
      initialData || {},
      tokens || {},
      tokenMapping || {}
    );

    res.json({
      success: true,
      jobId,
      message: 'Workflow queued successfully'
    });
  } catch (error) {
    console.error('[API] Queue error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /status/:jobId
 * Get status of a queued job
 */
app.get('/status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const status = await getJobStatus(jobId);

    res.json(status);
  } catch (error) {
    console.error('[API] Status error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/automations/run
 * Orchestration endpoint that handles the complete automation flow:
 * 1. Fetch workflow from database using automation_id
 * 2. Fetch user OAuth tokens using user_id
 * 3. Do placeholder replacement with config
 * 4. Nest config under body for webhook structure
 * 5. Execute workflow (one-time) OR schedule it (recurring)
 * 6. Return summary (not binary data)
 * 
 * Request body:
 * {
 *   "automation_id": "uuid",
 *   "user_id": "uuid", 
 *   "config": { "key": "value", ... },
 *   "schedule": true  // Optional: if true, schedules instead of running once
 * }
 */
app.post('/api/automations/run', async (req, res) => {
  const { automation_id, user_id, config = {}, schedule = false } = req.body;

  // Validate required parameters
  if (!automation_id) {
    return res.status(400).json({
      success: false,
      error: 'automation_id is required'
    });
  }

  if (!user_id) {
    return res.status(400).json({
      success: false,
      error: 'user_id is required'
    });
  }

  try {
    console.log(`[Orchestration] Starting automation: ${automation_id} for user: ${user_id}`);

    // Step 1: Check database connection
    if (!supabase) {
      return res.status(500).json({
        success: false,
        error: 'Database not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
      });
    }

    // Step 2: Fetch user_automation for this specific user (includes OAuth tokens and automation_data)
    console.log(`[Orchestration] Fetching user_automation for user_id=${user_id}, automation_id=${automation_id}`);

    const { data: instanceData, error: instanceError } = await supabase
      .from('user_automations')
      .select('id, automation_id, user_id, parameters, is_active, access_token, refresh_token, token_expiry, automation_data, run_count')
      .eq('user_id', user_id)
      .eq('automation_id', automation_id)
      .single();

    if (instanceError || !instanceData) {
      console.error('[Orchestration] Failed to fetch user_automation:', instanceError);
      return res.status(404).json({
        success: false,
        error: `No user automation found for user ${user_id} and automation ${automation_id}. User needs to set up this automation first.`
      });
    }

    console.log(`[Orchestration] Found user_automation: ${instanceData.id}`);

    // Step 3: Fetch the workflow template from automations table
    const { data: automationData, error: automationError } = await supabase
      .from('automations')
      .select('workflow, developer_keys')
      .eq('id', automation_id)
      .single();

    if (automationError || !automationData) {
      console.error('[Orchestration] Failed to fetch automation:', automationError);
      return res.status(404).json({
        success: false,
        error: `Automation template not found: ${automation_id}`
      });
    }

    let workflow = automationData.workflow;

    // Parse if stored as string
    if (typeof workflow === 'string') {
      try {
        workflow = JSON.parse(workflow);
      } catch (parseError) {
        console.error('[Orchestration] Failed to parse workflow JSON:', parseError);
        return res.status(500).json({
          success: false,
          error: 'Invalid workflow JSON format'
        });
      }
    }

    console.log(`[Orchestration] Workflow loaded: ${workflow.name || 'unnamed'}`);

    // Step 4: Use config from request OR from stored user_automation parameters
    const userConfig = config && Object.keys(config).length > 0 ? config : instanceData.parameters;
    console.log(`[Orchestration] Using config with keys: ${Object.keys(userConfig).join(', ')}`);

    // Step 5: Fetch developer keys from automation
    const developerKeys = automationData.developer_keys || {};

    // Step 6: Resolve credential placeholders in workflow
    const { workflow: resolvedWorkflow, resolvedCredentials } = resolveCredentials(workflow, developerKeys);
    workflow = resolvedWorkflow; // Use resolved workflow

    console.log(`[Orchestration] Loaded ${Object.keys(developerKeys).length} developer keys`);
    if (Object.keys(resolvedCredentials).length > 0) {
      console.log(`[Orchestration] Resolved ${Object.keys(resolvedCredentials).length} credential placeholders`);
    }

    // Step 3: Build tokens object from developer keys
    const tokens = { ...resolvedCredentials }; // Start with resolved credentials

    // Add any remaining developer keys that weren't resolved
    if (developerKeys.OPEN_ROUTER_API_KEY && !tokens.openRouterApiKey) {
      tokens.openRouterApiKey = developerKeys.OPEN_ROUTER_API_KEY;
    }
    if (developerKeys.OPENAI_API_KEY && !tokens.openAiApiKey) {
      tokens.openAiApiKey = developerKeys.OPENAI_API_KEY;
    }
    if (developerKeys.ANTHROPIC_API_KEY && !tokens.anthropicApiKey) {
      tokens.anthropicApiKey = developerKeys.ANTHROPIC_API_KEY;
    }
    if (developerKeys.HUGGINGFACE_API_KEY && !tokens.huggingFaceApiKey) {
      tokens.huggingFaceApiKey = developerKeys.HUGGINGFACE_API_KEY;
    }
    if (developerKeys.GROQ_API_KEY && !tokens.groqApiKey) {
      tokens.groqApiKey = developerKeys.GROQ_API_KEY;
    }

    // Add SMTP credentials from developer keys (if provided)
    if (developerKeys.SMTP_HOST) tokens.smtpHost = developerKeys.SMTP_HOST;
    if (developerKeys.SMTP_PORT) tokens.smtpPort = developerKeys.SMTP_PORT;
    if (developerKeys.SMTP_USER) tokens.smtpUser = developerKeys.SMTP_USER;
    if (developerKeys.SMTP_PASSWORD) tokens.smtpPassword = developerKeys.SMTP_PASSWORD;

    // Step 4: Add user OAuth tokens from user_automations (stored directly in the record)
    if (instanceData.access_token) {
      tokens.googleAccessToken = instanceData.access_token;
      console.log(`[Orchestration] Loaded Google access token from user_automations`);
    }
    if (instanceData.refresh_token) {
      tokens.googleRefreshToken = instanceData.refresh_token;
      console.log(`[Orchestration] Loaded Google refresh token from user_automations`);
    }

    // Check if token is expired and needs refresh
    if (instanceData.token_expiry) {
      const tokenExpiry = new Date(instanceData.token_expiry);
      const isExpired = tokenExpiry < new Date();

      if (isExpired && instanceData.refresh_token) {
        console.log(`[Orchestration] Access token expired, refreshing...`);

        try {
          // Refresh the token using Google OAuth2
          const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_id: process.env.GOOGLE_CLIENT_ID,
              client_secret: process.env.GOOGLE_CLIENT_SECRET,
              refresh_token: instanceData.refresh_token,
              grant_type: 'refresh_token'
            })
          });

          const refreshData = await refreshResponse.json();

          if (!refreshResponse.ok) {
            throw new Error(`Token refresh failed: ${refreshData.error_description || refreshData.error}`);
          }

          // Update tokens in memory for this execution
          tokens.googleAccessToken = refreshData.access_token;

          // Update database with new token
          const newExpiry = new Date(Date.now() + (refreshData.expires_in * 1000));
          await supabase
            .from('user_automations')
            .update({
              access_token: refreshData.access_token,
              token_expiry: newExpiry.toISOString()
            })
            .eq('id', instanceData.id);

          console.log(`[Orchestration] Token refreshed successfully, expires at ${newExpiry.toISOString()}`);
        } catch (refreshError) {
          console.error(`[Orchestration] Token refresh failed:`, refreshError.message);
          return res.status(401).json({
            success: false,
            error: `Google authentication expired and refresh failed: ${refreshError.message}. User needs to re-authenticate.`
          });
        }
      }
    }

    const tokenKeys = Object.keys(tokens);
    console.log(`[Orchestration] Total tokens available: ${tokenKeys.length} (${tokenKeys.join(', ')})`)

    // Step 5: Load automation_data (contains lastPollTime, processedFiles, etc.)
    const automationState = instanceData.automation_data || {};
    const lastPollTime = automationState.lastPollTime || new Date(Date.now() - 86400000).toISOString(); // Default: 24 hours ago
    const processedFiles = new Set(automationState.processedFiles || []);

    console.log(`[Orchestration] Loaded automation_data: lastPollTime=${lastPollTime}, processedFiles=${processedFiles.size} files`);

    // Step 6: Nest userConfig under body for webhook structure
    // This creates the initial data that webhook nodes expect
    const initialData = {
      body: {
        ...userConfig,
        // Add tokens to body for workflows that expect them
        access_token: tokens.googleAccessToken || null,
        refresh_token: tokens.googleRefreshToken || null,
        openrouter_api_key: tokens.openRouterApiKey || null,
        openai_api_key: tokens.openAiApiKey || null,
        anthropic_api_key: tokens.anthropicApiKey || null,
        slack_token: tokens.slackToken || null
      },
      headers: {
        'content-type': 'application/json',
        'user-agent': 'automation-runner'
      },
      query: {}
    };

    console.log(`[Orchestration] Executing workflow with config keys: ${Object.keys(userConfig).join(', ')}`);
    console.log(`[Orchestration] Added ${Object.keys(tokens).length} tokens to execution context`);

    // Step 7: Execute workflow once (no scheduling for now)
    const runner = new WorkflowRunner();

    // Pre-set execution context data that needs to persist
    // (will be merged into the context created by execute())
    runner.lastPollTime = lastPollTime;
    runner.processedFiles = processedFiles;
    runner.initialData = initialData;

    const result = await runner.execute(
      workflow,
      initialData,
      tokens,
      {} // No custom token mapping needed
    );

    // Step 8: Update automation_data with new processed files
    const newPollTime = new Date().toISOString();
    const updatedAutomationData = {
      lastPollTime: newPollTime,
      processedFiles: Array.from(processedFiles),
      lastRun: newPollTime,
      totalProcessed: processedFiles.size
    };

    // Get current run_count to increment it
    const currentRunCount = instanceData.run_count || 0;

    // Save updated automation_data back to database
    const { error: updateError } = await supabase
      .from('user_automations')
      .update({
        automation_data: updatedAutomationData,
        last_run_at: newPollTime,
        run_count: currentRunCount + 1
      })
      .eq('id', instanceData.id);

    if (updateError) {
      console.error('[Orchestration] Failed to update automation_data:', updateError);
    } else {
      console.log(`[Orchestration] Updated automation_data: ${processedFiles.size} files tracked`);
    }

    // Step 9: Return lightweight summary
    console.log(`[Orchestration] Execution complete. Success: ${result.success}`);

    if (!result.success && result.errors && result.errors.length > 0) {
      console.error(`[Orchestration] Execution errors:`, result.errors);
    }

    // Check if this was a "no new files" scenario (not an actual error)
    const triggerOutput = result.outputs?.['When Invoices Are Uploaded'] || [];
    const noNewFiles = triggerOutput.length === 0;

    // If trigger found no files and there are no other errors, consider it success
    const actualSuccess = noNewFiles ? true : result.success;

    res.json({
      success: actualSuccess,
      automation_id,
      user_id,
      errors: actualSuccess ? [] : (result.errors || []),
      message: noNewFiles ? 'No new files to process' : undefined,
      filesProcessed: triggerOutput.length,
      outputs: result.success ? result.outputs : undefined, // Include outputs on success for debugging
      executed_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Orchestration] Execution error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      automation_id,
      user_id
    });
  }
});

/**
 * POST /schedule
 * Schedule a workflow to run repeatedly
 * 
 * Request body:
 * {
 *   workflow: {...},
 *   initialData: {...},
 *   tokens: {...},
 *   tokenMapping: {...},
 *   cronExpression: "0 * * * *"  // Every hour
 * }
 */
app.post('/schedule', async (req, res) => {
  try {
    const { workflow, initialData, tokens, tokenMapping, cronExpression } = req.body;

    if (!workflow) {
      return res.status(400).json({ error: 'Workflow is required' });
    }

    if (!cronExpression) {
      return res.status(400).json({
        error: 'cronExpression is required',
        examples: {
          'every_hour': '0 * * * *',
          'every_day_9am': '0 9 * * *',
          'every_30_minutes': '*/30 * * * *',
          'every_monday_9am': '0 9 * * 1'
        }
      });
    }

    console.log(`[API] Scheduling workflow: ${workflow.name || 'unnamed'}`);
    console.log(`[API] Schedule: ${cronExpression}`);
    if (tokens) {
      const tokenKeys = Object.keys(tokens).filter(key => tokens[key] !== null);
      console.log(`[API] Injecting tokens: ${tokenKeys.join(', ')}`);
    }

    const scheduleInfo = await scheduleWorkflow(
      workflow,
      initialData || {},
      tokens || {},
      tokenMapping || {},
      cronExpression
    );

    res.json({
      success: true,
      message: 'Workflow scheduled successfully',
      schedule: scheduleInfo
    });
  } catch (error) {
    console.error('[API] Schedule error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /schedule/:jobKey
 * Remove a scheduled workflow
 */
app.delete('/schedule/:jobKey', async (req, res) => {
  try {
    const { jobKey } = req.params;

    console.log(`[API] Removing scheduled workflow: ${jobKey}`);

    await removeScheduledWorkflow(jobKey);

    res.json({
      success: true,
      message: 'Scheduled workflow removed successfully'
    });
  } catch (error) {
    console.error('[API] Remove schedule error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /schedules
 * List all scheduled workflows
 */
app.get('/schedules', async (req, res) => {
  try {
    const schedules = await listScheduledWorkflows();

    res.json({
      success: true,
      count: schedules.length,
      schedules
    });
  } catch (error) {
    console.error('[API] List schedules error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/user-automations/setup
 * Setup a user automation with their specific parameters and OAuth tokens
 * This is called from the frontend when user configures an automation
 * 
 * Request body:
 * {
 *   "user_id": "uuid",
 *   "automation_id": "uuid",
 *   "provider": "google",
 *   "parameters": {
 *     "folder_id": "...",
 *     "spreadsheet_id": "...",
 *     "billing_email": "..."
 *   },
 *   "access_token": "ya29...",      // Google OAuth access token
 *   "refresh_token": "1//0g...",    // Google OAuth refresh token
 *   "token_expiry": "2025-01-26T11:30:00Z"  // Optional, will calculate if not provided
 * }
 */
app.post('/api/user-automations/setup', async (req, res) => {
  const { user_id, automation_id, provider, parameters, access_token, refresh_token, token_expiry } = req.body;

  if (!user_id || !automation_id || !parameters) {
    return res.status(400).json({
      success: false,
      error: 'user_id, automation_id, and parameters are required'
    });
  }

  if (!access_token || !refresh_token) {
    return res.status(400).json({
      success: false,
      error: 'access_token and refresh_token are required. User must connect their Google account first.'
    });
  }

  try {
    if (!supabase) {
      return res.status(500).json({
        success: false,
        error: 'Database not configured'
      });
    }

    // Calculate token expiry if not provided (default: 1 hour from now)
    const expiryTime = token_expiry || new Date(Date.now() + 3600000).toISOString();

    // Check if user automation already exists
    const { data: existing, error: checkError } = await supabase
      .from('user_automations')
      .select('id, parameters')
      .eq('user_id', user_id)
      .eq('automation_id', automation_id)
      .single();

    let result;

    if (existing) {
      // Update existing user automation
      const { data, error } = await supabase
        .from('user_automations')
        .update({
          parameters: parameters,
          provider: provider || 'google',
          access_token: access_token,
          refresh_token: refresh_token,
          token_expiry: expiryTime,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      result = data;

      console.log(`[API] Updated user automation ${existing.id} for user ${user_id}`);
    } else {
      // Create new user automation
      const { data, error } = await supabase
        .from('user_automations')
        .insert({
          user_id: user_id,
          automation_id: automation_id,
          provider: provider || 'google',
          parameters: parameters,
          access_token: access_token,
          refresh_token: refresh_token,
          token_expiry: expiryTime,
          is_active: false,
          automation_data: {}
        })
        .select()
        .single();

      if (error) throw error;
      result = data;

      console.log(`[API] Created user automation ${result.id} for user ${user_id}`);
    }

    res.json({
      success: true,
      message: 'User automation configured successfully',
      user_automation: {
        ...result,
        access_token: '***', // Don't send full token back
        refresh_token: '***'
      }
    });

  } catch (error) {
    console.error('[API] Setup user automation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/user-automations/:userId
 * Get all automations for a user
 */
app.get('/api/user-automations/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    if (!supabase) {
      return res.status(500).json({
        success: false,
        error: 'Database not configured'
      });
    }

    const { data, error } = await supabase
      .from('user_automations')
      .select(`
        id,
        automation_id,
        provider,
        is_active,
        parameters,
        automation_data,
        last_run_at,
        run_count,
        created_at,
        automations (
          id,
          name,
          description
        )
      `)
      .eq('user_id', userId);

    if (error) throw error;

    res.json({
      success: true,
      count: data.length,
      user_automations: data
    });

  } catch (error) {
    console.error('[API] Get user automations error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/automations/start-polling
 * Start background polling for a workflow with trigger
 * 
 * Flow:
 * 1. Receive config from frontend
 * 2. Test run the automation
 * 3. If successful → Save config to database + start polling
 * 4. If failed → Return error (don't save, don't start)
 * 
 * Request body:
 * {
 *   "automation_id": "uuid",
 *   "user_id": "uuid",
 *   "config": { 
 *     "folder_id": "...", 
 *     "spreadsheet_id": "...", 
 *     "billing_email": "..." 
 *   }
 * }
 */
app.post('/api/automations/start-polling', async (req, res) => {
  const { automation_id, user_id, config } = req.body;

  if (!automation_id || !user_id) {
    return res.status(400).json({
      success: false,
      error: 'automation_id and user_id are required'
    });
  }

  if (!config) {
    return res.status(400).json({
      success: false,
      error: 'config is required for first-time setup'
    });
  }

  try {
    const backgroundService = getBackgroundService();

    // Try to start polling (this will do a test run first)
    console.log(`[API] Received request:`, {
      automation_id,
      user_id,
      has_config: !!config,
      config_keys: config ? Object.keys(config) : []
    });
    console.log(`[API] Testing automation with provided config...`);

    await backgroundService.startPolling(automation_id, user_id, config);

    // If we get here, it worked! Save config to database
    console.log(`[API] Test successful! Saving config to database...`);

    if (supabase) {
      const { error: updateError } = await supabase
        .from('user_automations')
        .update({
          parameters: config,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', user_id)
        .eq('automation_id', automation_id);

      if (updateError) {
        console.error('[API] Warning: Failed to save config to database:', updateError);
        // Don't fail the request, polling is already started
      } else {
        console.log(`[API] Config saved to database successfully`);
      }
    }

    res.json({
      success: true,
      message: `Automation started successfully! Config saved. Polling every minute.`,
      automation_id,
      user_id,
      config_saved: true
    });

  } catch (error) {
    console.error('[API] Start polling error:', error);

    // Test failed - don't save config, don't start polling
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'FUCK YOU!!! Fix your config and try again! 🖕',
      details: {
        automation_id,
        user_id,
        config_provided: !!config,
        error_type: error.message.includes('OAuth') ? 'missing_tokens' :
          error.message.includes('not found') ? 'invalid_ids' :
            'configuration_error'
      }
    });
  }
});

/**
 * POST /api/automations/stop-polling
 * Stop background polling for a workflow
 * 
 * Request body:
 * {
 *   "automation_id": "uuid",
 *   "user_id": "uuid"
 * }
 */
app.post('/api/automations/stop-polling', async (req, res) => {
  const { automation_id, user_id } = req.body;

  if (!automation_id || !user_id) {
    return res.status(400).json({
      success: false,
      error: 'automation_id and user_id are required'
    });
  }

  try {
    const backgroundService = getBackgroundService();
    await backgroundService.stopPolling(automation_id, user_id);

    res.json({
      success: true,
      message: `Stopped polling for automation ${automation_id} for user ${user_id}`,
      automation_id,
      user_id
    });
  } catch (error) {
    console.error('[API] Stop polling error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/automations/active-polls
 * Get list of workflows currently being polled
 */
app.get('/api/automations/active-polls', (req, res) => {
  try {
    const backgroundService = getBackgroundService();
    const activePolls = backgroundService.getActivePolls();

    res.json({
      success: true,
      count: activePolls.length,
      workflows: activePolls
    });
  } catch (error) {
    console.error('[API] Active polls error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'automation-runner' });
});

app.listen(PORT, () => {
  console.log(`🚀 Automation Runner listening on port ${PORT}`);
  console.log(`📡 Endpoints:`);
  console.log(`   POST /api/user-automations/setup - Setup user automation with parameters`);
  console.log(`   GET /api/user-automations/:userId - Get all automations for a user`);
  console.log(`   POST /api/automations/start-polling - Start background polling for triggers`);
  console.log(`   POST /api/automations/stop-polling - Stop background polling`);
  console.log(`   GET /api/automations/active-polls - List active polling workflows`);
  console.log(`   POST /api/automations/run - Full orchestration (automation_id, user_id, config)`);
  console.log(`   POST /execute - Execute workflow immediately`);
  console.log(`   POST /queue - Queue workflow for async execution`);
  console.log(`   GET /status/:jobId - Get job status`);
  console.log(`   POST /schedule - Schedule workflow to run repeatedly`);
  console.log(`   GET /schedules - List all scheduled workflows`);
  console.log(`   DELETE /schedule/:jobKey - Remove scheduled workflow`);
  console.log(`   GET /health - Health check`);
});

// Cleanup on shutdown
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, stopping all polling...');
  const backgroundService = getBackgroundService();
  backgroundService.stopAll();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Server] SIGINT received, stopping all polling...');
  const backgroundService = getBackgroundService();
  backgroundService.stopAll();
  process.exit(0);
});

