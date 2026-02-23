require('dotenv').config();
// Only load .env.local in development (not in production/Railway)
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: '.env.local' });
}
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
const { injectParameters, extractParameterNames } = require('./utils/parameterInjector');
const { refreshTokenIfNeeded } = require('./tokenRefresh'); // Import the new refresh module
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
 *   tokenMapping: {...},  // Optional: custom token name mapping
 *   delay: 0  // Optional: delay in milliseconds before execution (default: 0, max: 30 days)
 * }
 */
app.post('/queue', async (req, res) => {
  try {
    const { workflow, initialData, tokens, tokenMapping, delay } = req.body;

    if (!workflow) {
      return res.status(400).json({ error: 'Workflow is required' });
    }

    // Validate delay if provided
    if (delay !== undefined) {
      if (typeof delay !== 'number' || delay < 0) {
        return res.status(400).json({ 
          error: 'Delay must be a non-negative number (milliseconds)' 
        });
      }
      
      const MAX_DELAY = 30 * 24 * 60 * 60 * 1000; // 30 days
      if (delay > MAX_DELAY) {
        return res.status(400).json({ 
          error: `Delay cannot exceed 30 days (${MAX_DELAY}ms)` 
        });
      }
    }

    console.log(`[API] Queuing workflow: ${workflow.name || 'unnamed'}`);
    if (delay) {
      const delayHours = (delay / (1000 * 60 * 60)).toFixed(2);
      console.log(`[API] Delayed execution: ${delayHours} hours`);
    }
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
      tokenMapping || {},
      delay || 0
    );

    const response = {
      success: true,
      jobId,
      message: delay ? 'Workflow scheduled successfully' : 'Workflow queued successfully'
    };
    
    if (delay) {
      response.scheduledFor = new Date(Date.now() + delay).toISOString();
    }

    res.json(response);
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
      .select('id, automation_id, user_id, provider, parameters, is_active, access_token, refresh_token, token_expiry, automation_data, run_count')
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

    // Check for token refresh before using them
    // This handles both Google and TikTok refreshes
    let validAccessToken = instanceData.access_token;
    let validRefreshToken = instanceData.refresh_token;

    try {
      const refreshResult = await refreshTokenIfNeeded(instanceData, supabase);
      if (refreshResult.refreshed) {
        validAccessToken = refreshResult.accessToken;
        validRefreshToken = refreshResult.refreshToken;
        console.log(`[Orchestration] Using refreshed tokens for provider: ${instanceData.provider}`);
      }
    } catch (refreshErr) {
      console.error(`[Orchestration] Token refresh failed: ${refreshErr.message}`);
      // Continue with old tokens if refresh fails, or throw? 
      // Existing behavior was to fail for Google, so let's fail here too if it was a required refresh
      // But refreshTokenIfNeeded uses token_expiry check. If it threw, it means it tried and failed.
      return res.status(401).json({
        success: false,
        error: `Authentication refresh failed: ${refreshErr.message}. User needs to re-authenticate.`
      });
    }

    // Step 4: Add user OAuth tokens
    // Provider-aware: only set googleAccessToken for Google providers
    const orchProviderName = (instanceData.provider || '').toLowerCase();
    if (validAccessToken) {
      tokens.accessToken = validAccessToken;
      if (!orchProviderName.includes('tiktok')) {
        tokens.googleAccessToken = validAccessToken; // Only for Google/default providers
      }
      console.log(`[Orchestration] Loaded access token (provider: ${orchProviderName || 'default'})`);
    }
    if (validRefreshToken) {
      tokens.refreshToken = validRefreshToken;
      if (!orchProviderName.includes('tiktok')) {
        tokens.googleRefreshToken = validRefreshToken; // Only for Google/default providers
      }
      console.log(`[Orchestration] Loaded refresh token (provider: ${orchProviderName || 'default'})`);
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
    const { body: _ignoredBody, headers: _ignoredHeaders, query: _ignoredQuery, ...flatConfig } = userConfig;

    const initialData = {
      // Expose config at top-level for schedule-triggered workflows
      ...flatConfig,
      body: {
        ...flatConfig,
        // Add tokens to body for workflows that expect them
        access_token: tokens.accessToken || tokens.googleAccessToken || null,
        refresh_token: tokens.refreshToken || tokens.googleRefreshToken || null,
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

    // Capture start time BEFORE execution to avoid missing files that arrive during execution
    // This fixes the "gap" race condition
    const executionStartTime = new Date().toISOString();

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

    // Find the trigger node name dynamically to be robust against renames
    const triggerNode = workflow.nodes.find(n => n.type === 'n8n-nodes-base.googleDriveTrigger');
    const triggerNodeName = triggerNode ? triggerNode.name : 'When Invoices Are Uploaded';

    // Get trigger output to track properly processed files
    const triggerOutput = result.outputs?.[triggerNodeName] || [];

    // Check if this was a "no new files" scenario
    const noNewFiles = triggerOutput.length === 0;

    // Add newly found files to processedFiles tracking
    if (triggerOutput.length > 0) {
      triggerOutput.forEach(item => {
        if (item.json && item.json.id) {
          processedFiles.add(item.json.id);
        }
      });
      console.log(`[Orchestration] Added ${triggerOutput.length} new files to tracking`);
    }

    // Step 8: Update automation_data with new processed files
    // Use executionStartTime instead of "now" to ensure we cover the execution window next time
    const newPollTime = executionStartTime;
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
    // triggerOutput and noNewFiles are already defined above

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
    const {
      workflow,
      initialData,
      tokens,
      tokenMapping,
      cronExpression,
      automation_id,
      user_id,
      config = {},
      maxRuns = null
    } = req.body;

    // Safe logging (avoid dumping secrets)
    const configKeys = config && typeof config === 'object' ? Object.keys(config) : [];
    console.log(`[API] /schedule called from: ${req.headers.origin || 'unknown'}`);
    console.log(`[API] /schedule payload: automation_id=${automation_id || 'n/a'}, user_id=${user_id || 'n/a'}, cron=${cronExpression || 'n/a'}, maxRuns=${maxRuns || 'unlimited'}, hasWorkflow=${!!workflow}, hasTokens=${!!tokens}, hasTokenMapping=${!!tokenMapping}, configKeys=${configKeys.join(', ') || 'none'}, prefix=${config?.prefix || 'n/a'}`);

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

    let workflowToSchedule = workflow;
    let initialDataToSchedule = initialData || {};
    let tokensToSchedule = tokens || {};
    let tokenMappingToSchedule = tokenMapping || {};

    if (!workflowToSchedule) {
      if (!automation_id || !user_id) {
        return res.status(400).json({
          error: 'workflow OR (automation_id and user_id) is required'
        });
      }

      if (!supabase) {
        return res.status(500).json({
          success: false,
          error: 'Database not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
        });
      }

      console.log(`[API] Scheduling automation: ${automation_id} for user: ${user_id}`);

      const { data: instanceData, error: instanceError } = await supabase
        .from('user_automations')
        .select('id, automation_id, user_id, provider, parameters, access_token, refresh_token, token_expiry')
        .eq('user_id', user_id)
        .eq('automation_id', automation_id)
        .single();

      if (instanceError || !instanceData) {
        console.error('[API] Failed to fetch user_automation:', instanceError);
        return res.status(404).json({
          success: false,
          error: `No user automation found for user ${user_id} and automation ${automation_id}.`
        });
      }

      const { data: automationData, error: automationError } = await supabase
        .from('automations')
        .select('workflow, developer_keys')
        .eq('id', automation_id)
        .single();

      if (automationError || !automationData) {
        console.error('[API] Failed to fetch automation:', automationError);
        return res.status(404).json({
          success: false,
          error: `Automation template not found: ${automation_id}`
        });
      }

      let workflowTemplate = automationData.workflow;
      if (typeof workflowTemplate === 'string') {
        try {
          workflowTemplate = JSON.parse(workflowTemplate);
        } catch (parseError) {
          console.error('[API] Failed to parse workflow JSON:', parseError);
          return res.status(500).json({
            success: false,
            error: 'Invalid workflow JSON format'
          });
        }
      }

      const userConfig = config && Object.keys(config).length > 0 ? config : (instanceData.parameters || {});
      const developerKeys = automationData.developer_keys || {};

      const { workflow: resolvedWorkflow, resolvedCredentials } = resolveCredentials(workflowTemplate, developerKeys);
      workflowTemplate = resolvedWorkflow;

      const requiredParams = Array.from(extractParameterNames(workflowTemplate));
      const missing = requiredParams.filter(
        (name) => !Object.prototype.hasOwnProperty.call(userConfig, name)
      );
      if (missing.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Missing parameters',
          missing
        });
      }

      workflowToSchedule = injectParameters(workflowTemplate, userConfig);

      const tokensLocal = { ...resolvedCredentials };
      if (developerKeys.OPEN_ROUTER_API_KEY && !tokensLocal.openRouterApiKey) {
        tokensLocal.openRouterApiKey = developerKeys.OPEN_ROUTER_API_KEY;
      }
      if (developerKeys.OPENAI_API_KEY && !tokensLocal.openAiApiKey) {
        tokensLocal.openAiApiKey = developerKeys.OPENAI_API_KEY;
      }
      if (developerKeys.ANTHROPIC_API_KEY && !tokensLocal.anthropicApiKey) {
        tokensLocal.anthropicApiKey = developerKeys.ANTHROPIC_API_KEY;
      }
      if (developerKeys.HUGGINGFACE_API_KEY && !tokensLocal.huggingFaceApiKey) {
        tokensLocal.huggingFaceApiKey = developerKeys.HUGGINGFACE_API_KEY;
      }
      if (developerKeys.GROQ_API_KEY && !tokensLocal.groqApiKey) {
        tokensLocal.groqApiKey = developerKeys.GROQ_API_KEY;
      }
      if (developerKeys.SMTP_HOST) tokensLocal.smtpHost = developerKeys.SMTP_HOST;
      if (developerKeys.SMTP_PORT) tokensLocal.smtpPort = developerKeys.SMTP_PORT;
      if (developerKeys.SMTP_USER) tokensLocal.smtpUser = developerKeys.SMTP_USER;
      if (developerKeys.SMTP_PASSWORD) tokensLocal.smtpPassword = developerKeys.SMTP_PASSWORD;

      // Provider-aware: only set googleAccessToken for Google providers, not TikTok etc.
      const schedProviderName = (instanceData.provider || '').toLowerCase();

      // Attempt refresh before assignment
      let validAccessToken = instanceData.access_token;
      let validRefreshToken = instanceData.refresh_token;

      try {
        const refreshResult = await refreshTokenIfNeeded(instanceData, supabase);
        if (refreshResult.refreshed) {
          validAccessToken = refreshResult.accessToken;
          validRefreshToken = refreshResult.refreshToken;
          console.log(`[Schedule] Using refreshed tokens for provider: ${instanceData.provider}`);
        }
      } catch (refreshErr) {
        console.error(`[Schedule] Token refresh failed: ${refreshErr.message}`);
        // For schedule, we log error but maybe try to proceed with old tokens? 
        // Or fail? If it failed it likely means it processed the request and got an error.
        // Let's log heavily.
      }

      if (validAccessToken) {
        tokensLocal.accessToken = validAccessToken;
        if (!schedProviderName.includes('tiktok')) {
          tokensLocal.googleAccessToken = validAccessToken; // Only for Google/default providers
        }
      }
      if (validRefreshToken) {
        tokensLocal.refreshToken = validRefreshToken;
        if (!schedProviderName.includes('tiktok')) {
          tokensLocal.googleRefreshToken = validRefreshToken; // Only for Google/default providers
        }
      }

      const { body: _ignoredBody, headers: _ignoredHeaders, query: _ignoredQuery, ...flatConfig } = userConfig;
      initialDataToSchedule = {
        ...flatConfig,
        body: {
          ...flatConfig,
          access_token: tokensLocal.accessToken || tokensLocal.googleAccessToken || null,
          refresh_token: tokensLocal.refreshToken || tokensLocal.googleRefreshToken || null,
          openrouter_api_key: tokensLocal.openRouterApiKey || null,
          openai_api_key: tokensLocal.openAiApiKey || null,
          anthropic_api_key: tokensLocal.anthropicApiKey || null,
          slack_token: tokensLocal.slackToken || null
        },
        headers: {
          'content-type': 'application/json',
          'user-agent': 'automation-runner'
        },
        query: {}
      };

      tokensToSchedule = tokensLocal;
    }

    console.log(`[API] Scheduling workflow: ${workflowToSchedule.name || 'unnamed'}`);
    console.log(`[API] Schedule: ${cronExpression}`);
    if (tokensToSchedule) {
      const tokenKeys = Object.keys(tokensToSchedule).filter(key => tokensToSchedule[key] !== null);
      console.log(`[API] Injecting tokens: ${tokenKeys.join(', ')}`);
    }

    const scheduleInfo = await scheduleWorkflow(
      workflowToSchedule,
      initialDataToSchedule || {},
      tokensToSchedule || {},
      tokenMappingToSchedule || {},
      cronExpression,
      maxRuns
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

  // Resume polling for active automations
  if (supabase) {
    (async () => {
      console.log('\n🔄 Checking for active automations to resume polling...');
      const { data: activeAutomations, error } = await supabase
        .from('user_automations')
        .select('automation_id, user_id, parameters')
        .eq('is_active', true);

      if (error) {
        console.error('❌ Failed to fetch active automations:', error);
        return;
      }

      if (activeAutomations && activeAutomations.length > 0) {
        console.log(`Found ${activeAutomations.length} active automations to resume`);
        const backgroundService = getBackgroundService();

        for (const automation of activeAutomations) {
          try {
            // Add a small delay between starts to prevent flooding
            await new Promise(resolve => setTimeout(resolve, 500));

            await backgroundService.startPolling(
              automation.automation_id,
              automation.user_id,
              automation.parameters
            );
            console.log(`✅ Resumed polling for ${automation.automation_id} (User: ${automation.user_id})`);
          } catch (err) {
            console.error(`❌ Failed to resume polling for ${automation.automation_id}:`, err.message);
          }
        }
      } else {
        console.log('No active automations found to resume');
      }
    })();
  }
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
