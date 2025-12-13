require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const WorkflowRunner = require('./runner');
const WorkflowService = require('./workflowService');
const { addWorkflowJob, getJobStatus } = require('./queue');
const { resolveCredentials } = require('./utils/credentialResolver');

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
 * 5. Execute workflow
 * 6. Return summary (not binary data)
 * 
 * Request body:
 * {
 *   "automation_id": "uuid",
 *   "user_id": "uuid", 
 *   "config": { "key": "value", ... }
 * }
 */
app.post('/api/automations/run', async (req, res) => {
  const { automation_id, user_id, config = {} } = req.body;

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

    // Step 1: Fetch workflow from database
    if (!supabase) {
      return res.status(500).json({
        success: false,
        error: 'Database not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
      });
    }

    const { data: automationData, error: automationError } = await supabase
      .from('automations')
      .select('workflow, developer_keys')
      .eq('id', automation_id)
      .single();

    if (automationError || !automationData) {
      console.error('[Orchestration] Failed to fetch automation:', automationError);
      return res.status(404).json({
        success: false,
        error: `Automation not found: ${automation_id}`
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

    // Step 2: Fetch developer keys from automation
    const developerKeys = automationData.developer_keys || {};
    
    // Step 2.5: Resolve credential placeholders in workflow
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

    // Step 4: Fetch user OAuth tokens from user_integrations
    const { data: integrations, error: integrationsError } = await supabase
      .from('user_integrations')
      .select('*')
      .eq('user_id', user_id);

    if (integrationsError) {
      console.warn('[Orchestration] Failed to fetch user integrations:', integrationsError);
    } else if (integrations && integrations.length > 0) {
      // Process each integration (Google, Slack, etc.)
      integrations.forEach(integration => {
        const provider = integration.provider?.toLowerCase();
        
        if (provider === 'google') {
          if (integration.access_token) tokens.googleAccessToken = integration.access_token;
          if (integration.refresh_token) tokens.googleRefreshToken = integration.refresh_token;
        } else if (provider === 'slack') {
          if (integration.access_token) tokens.slackToken = integration.access_token;
        }
        // Add more providers as needed
      });
      
      console.log(`[Orchestration] Loaded ${integrations.length} user integrations: ${integrations.map(i => i.provider).join(', ')}`);
    } else {
      console.warn('[Orchestration] No user integrations found for user:', user_id);
    }
    
    const tokenKeys = Object.keys(tokens);
    console.log(`[Orchestration] Total tokens available: ${tokenKeys.length} (${tokenKeys.join(', ')})`)

    // Step 5: Do placeholder replacement with config
    // The TokenInjector in WorkflowRunner will handle {{PARAM_NAME}} replacements
    // We'll pass config as parameters for placeholder replacement
    
    // Step 6: Nest config under body for webhook structure
    // This creates the initial data that webhook nodes expect
    // Also add tokens to body so workflow can access them (e.g., access_token)
    const initialData = {
      body: {
        ...config,
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

    console.log(`[Orchestration] Executing workflow with config keys: ${Object.keys(config).join(', ')}`);
    console.log(`[Orchestration] Added ${Object.keys(tokens).length} tokens to webhook body`);

    // Step 7: Execute workflow
    const runner = new WorkflowRunner();
    const result = await runner.execute(
      workflow,
      initialData,
      tokens,
      {} // No custom token mapping needed
    );

    // Step 8: Return lightweight summary (no outputs, no binary data)
    console.log(`[Orchestration] Execution complete. Success: ${result.success}`);

    res.json({
      success: result.success,
      automation_id,
      user_id,
      errors: result.errors || [],
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
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'automation-runner' });
});

app.listen(PORT, () => {
  console.log(`🚀 Automation Runner listening on port ${PORT}`);
  console.log(`📡 Endpoints:`);
  console.log(`   POST /api/automations/run - Full orchestration (automation_id, user_id, config)`);
  console.log(`   POST /execute - Execute workflow immediately`);
  console.log(`   POST /queue - Queue workflow for async execution`);
  console.log(`   GET /status/:jobId - Get job status`);
  console.log(`   GET /health - Health check`);
});

