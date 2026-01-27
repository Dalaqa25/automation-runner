const { createClient } = require('@supabase/supabase-js');
const WorkflowRunner = require('./runner');

/**
 * Background Service for Polling Triggers
 * Handles workflows with polling triggers (Google Drive, Schedule, etc.)
 */
class BackgroundService {
  constructor() {
    this.pollingIntervals = new Map(); // workflowId -> intervalId
    this.lastPollTimes = new Map(); // workflowId -> timestamp
    
    // Initialize Supabase client
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      this.supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      console.log('[BackgroundService] Supabase client initialized');
    } else {
      console.warn('[BackgroundService] Supabase not configured - polling triggers will not work');
    }
  }

  /**
   * Start polling for a workflow with trigger
   * @param {string} automationId - Automation ID from automations table
   * @param {string} userId - User ID who owns the automation
   * @param {Object} config - User configuration (optional, will use parameters from user_automations if not provided)
   */
  async startPolling(automationId, userId, config = null) {
    const userAutomationKey = `${userId}_${automationId}`;
    
    if (this.pollingIntervals.has(userAutomationKey)) {
      console.log(`[BackgroundService] User automation ${userAutomationKey} is already being polled`);
      return;
    }

    try {
      console.log(`[BackgroundService] Looking for user_automation with user_id=${userId}, automation_id=${automationId}`);
      
      // Load user_automation record (contains user-specific config, state, AND tokens)
      const { data: userAutomation, error: userAutomationError } = await this.supabase
        .from('user_automations')
        .select('id, parameters, automation_data, automation_id, user_id, access_token, refresh_token, token_expiry')
        .eq('user_id', userId)
        .eq('automation_id', automationId)
        .single();

      console.log(`[BackgroundService] Query result:`, { 
        found: !!userAutomation, 
        error: userAutomationError?.message,
        hasTokens: !!(userAutomation?.access_token && userAutomation?.refresh_token)
      });

      if (userAutomationError || !userAutomation) {
        throw new Error(`User automation not found for user ${userId} and automation ${automationId}: ${userAutomationError?.message}`);
      }

      // Use provided config or fall back to stored parameters
      const userConfig = config || userAutomation.parameters || {};
      
      console.log(`[BackgroundService] User config keys: ${Object.keys(userConfig).join(', ')}`);

      // Check if we have OAuth tokens
      if (!userAutomation.access_token || !userAutomation.refresh_token) {
        throw new Error(`User ${userId} has not connected their Google account for this automation. Missing OAuth tokens.`);
      }

      // Check if token is expired and refresh if needed
      let accessToken = userAutomation.access_token;
      const tokenExpiry = userAutomation.token_expiry ? new Date(userAutomation.token_expiry) : null;
      const isExpired = tokenExpiry && tokenExpiry < new Date();

      if (isExpired) {
        console.log(`[BackgroundService] Access token expired, refreshing...`);
        accessToken = await this.refreshGoogleToken(userAutomation.id, userAutomation.refresh_token);
      }

      // Load workflow template from automations table
      const { data: automationData, error: automationError } = await this.supabase
        .from('automations')
        .select('workflow, developer_keys')
        .eq('id', automationId)
        .single();

      if (automationError || !automationData) {
        throw new Error(`Failed to load automation ${automationId}: ${automationError?.message}`);
      }

      let workflow = automationData.workflow;
      if (typeof workflow === 'string') {
        workflow = JSON.parse(workflow);
      }

      // Find trigger node
      const triggerNode = workflow.nodes.find(node => 
        node.type === 'n8n-nodes-base.googleDriveTrigger' ||
        node.type === 'n8n-nodes-base.scheduleTrigger'
      );

      if (!triggerNode) {
        throw new Error(`No polling trigger found in workflow ${automationId}`);
      }

      // Get polling interval from trigger parameters (default: 1 minute)
      const pollTimes = triggerNode.parameters?.pollTimes?.item?.[0];
      let intervalMs = 60000; // Default 1 minute

      if (pollTimes?.mode === 'everyMinute') {
        intervalMs = 60000;
      } else if (pollTimes?.mode === 'everyX') {
        intervalMs = (pollTimes.value || 1) * 60000;
      }

      console.log(`[BackgroundService] Starting polling for user automation ${userAutomationKey} every ${intervalMs / 1000}s`);

      // Build tokens object
      const tokens = {
        googleAccessToken: accessToken,
        googleRefreshToken: userAutomation.refresh_token,
        groqApiKey: process.env.GROQ_API_KEY || automationData.developer_keys?.GROQ_API_KEY
      };

      // Add any developer keys from automation
      if (automationData.developer_keys) {
        Object.assign(tokens, automationData.developer_keys);
      }

      console.log(`[BackgroundService] Tokens available: ${Object.keys(tokens).join(', ')}`);

      // Load automation_data from user_automations (contains processed files list)
      const automationDataState = userAutomation.automation_data || {};
      const lastPollTime = automationDataState.lastPollTime || new Date().toISOString();
      const processedFiles = new Set(automationDataState.processedFiles || []);

      // Store in memory
      this.lastPollTimes.set(userAutomationKey, lastPollTime);
      this.processedFiles = this.processedFiles || new Map();
      this.processedFiles.set(userAutomationKey, processedFiles);

      // Mark user_automation as active in database
      await this.supabase
        .from('user_automations')
        .update({ is_active: true })
        .eq('id', userAutomation.id);

      console.log(`[BackgroundService] Running initial test poll...`);

      // Do initial test poll to validate everything works
      try {
        await this.pollWorkflow(userAutomationKey, userAutomation.id, workflow, tokens, userConfig);
        console.log(`[BackgroundService] ✅ Initial test poll successful!`);
      } catch (testError) {
        // Test failed - clean up and throw error
        console.error(`[BackgroundService] ❌ Initial test poll failed:`, testError);
        
        await this.supabase
          .from('user_automations')
          .update({ is_active: false })
          .eq('id', userAutomation.id);
        
        throw new Error(`Test run failed: ${testError.message}`);
      }

      // Test passed! Start polling interval
      const intervalId = setInterval(async () => {
        await this.pollWorkflow(userAutomationKey, userAutomation.id, workflow, tokens, userConfig);
      }, intervalMs);

      this.pollingIntervals.set(userAutomationKey, intervalId);

      console.log(`[BackgroundService] Successfully started polling for ${userAutomationKey}`);

    } catch (error) {
      console.error(`[BackgroundService] Failed to start polling for ${userAutomationKey}:`, error);
      throw error;
    }
  }

  /**
   * Stop polling for a user automation
   * @param {string} automationId - Automation ID
   * @param {string} userId - User ID
   */
  async stopPolling(automationId, userId) {
    const userAutomationKey = `${userId}_${automationId}`;
    const intervalId = this.pollingIntervals.get(userAutomationKey);
    
    if (intervalId) {
      clearInterval(intervalId);
      this.pollingIntervals.delete(userAutomationKey);
      this.lastPollTimes.delete(userAutomationKey);
      
      if (this.processedFiles) {
        this.processedFiles.delete(userAutomationKey);
      }

      // Mark user_automation as inactive in database
      if (this.supabase) {
        await this.supabase
          .from('user_automations')
          .update({ is_active: false })
          .eq('user_id', userId)
          .eq('automation_id', automationId);
      }

      console.log(`[BackgroundService] Stopped polling for user automation ${userAutomationKey}`);
    }
  }

  /**
   * Poll a workflow (check trigger and execute if triggered)
   */
  async pollWorkflow(userAutomationKey, userAutomationId, workflow, tokens, config) {
    try {
      const lastPollTime = this.lastPollTimes.get(userAutomationKey);
      const processedFiles = this.processedFiles?.get(userAutomationKey) || new Set();
      
      // Create execution context with last poll time and processed files
      const runner = new WorkflowRunner();
      runner.executionContext = {
        nodes: {},
        currentNode: null,
        errors: [],
        workflow: workflow,
        tokens: tokens,
        tokenInjector: { getToken: (key) => tokens[key] },
        lastPollTime: lastPollTime,
        processedFiles: processedFiles
      };

      // Execute workflow
      const result = await runner.execute(
        workflow,
        { body: config },
        tokens,
        {}
      );

      const newPollTime = new Date().toISOString();
      this.lastPollTimes.set(userAutomationKey, newPollTime);

      // Check if trigger found new items
      const triggerNode = workflow.nodes.find(node => 
        node.type === 'n8n-nodes-base.googleDriveTrigger' ||
        node.type === 'n8n-nodes-base.scheduleTrigger'
      );

      if (triggerNode) {
        const triggerOutput = result.outputs[triggerNode.name] || result.outputs[triggerNode.id];
        if (triggerOutput && triggerOutput.length > 0) {
          console.log(`[BackgroundService] User automation ${userAutomationKey} triggered with ${triggerOutput.length} items`);
          
          // Track processed files
          triggerOutput.forEach(item => {
            if (item.json?.id) {
              processedFiles.add(item.json.id);
            }
          });

          // Update automation_data in user_automations table
          const automationDataUpdate = {
            lastPollTime: newPollTime,
            processedFiles: Array.from(processedFiles),
            lastProcessedFile: triggerOutput[triggerOutput.length - 1]?.json?.id,
            totalProcessed: processedFiles.size
          };

          if (this.supabase) {
            await this.supabase
              .from('user_automations')
              .update({ 
                automation_data: automationDataUpdate,
                last_run_at: newPollTime,
                run_count: this.supabase.raw('COALESCE(run_count, 0) + 1')
              })
              .eq('id', userAutomationId);
          }
        }
      }

      if (!result.success && result.errors.length > 0) {
        console.error(`[BackgroundService] User automation ${userAutomationKey} execution errors:`, result.errors);
      }

    } catch (error) {
      console.error(`[BackgroundService] Error polling user automation ${userAutomationKey}:`, error);
    }
  }

  /**
   * Refresh Google access token using refresh token
   */
  async refreshGoogleToken(userAutomationId, refreshToken) {
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: 'refresh_token'
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(`Token refresh failed: ${data.error_description || data.error}`);
      }

      // Update user_automations with new access token
      const newExpiry = new Date(Date.now() + (data.expires_in * 1000));
      
      await this.supabase
        .from('user_automations')
        .update({
          access_token: data.access_token,
          token_expiry: newExpiry.toISOString()
        })
        .eq('id', userAutomationId);

      console.log(`[BackgroundService] Token refreshed successfully, expires at ${newExpiry.toISOString()}`);

      return data.access_token;
    } catch (error) {
      console.error('[BackgroundService] Token refresh error:', error);
      throw new Error(`Failed to refresh Google token: ${error.message}`);
    }
  }

  /**
   * Load user tokens from database (DEPRECATED - now using tokens from user_automations directly)
   */
  async loadUserTokens(userId, developerKeys = {}) {
    const tokens = { ...developerKeys };

    if (!this.supabase) {
      return tokens;
    }

    try {
      const { data: integrations, error } = await this.supabase
        .from('user_integrations')
        .select('*')
        .eq('user_id', userId);

      if (!error && integrations) {
        integrations.forEach(integration => {
          const provider = integration.provider?.toLowerCase();
          
          if (provider === 'google') {
            if (integration.access_token) tokens.googleAccessToken = integration.access_token;
            if (integration.refresh_token) tokens.googleRefreshToken = integration.refresh_token;
          } else if (provider === 'slack') {
            if (integration.access_token) tokens.slackToken = integration.access_token;
          }
        });
      }
    } catch (error) {
      console.error('[BackgroundService] Failed to load user tokens:', error);
    }

    return tokens;
  }

  /**
   * Get list of active polling workflows
   */
  getActivePolls() {
    return Array.from(this.pollingIntervals.keys());
  }

  /**
   * Stop all polling
   */
  stopAll() {
    for (const workflowId of this.pollingIntervals.keys()) {
      this.stopPolling(workflowId);
    }
    console.log('[BackgroundService] Stopped all polling');
  }
}

// Singleton instance
let backgroundServiceInstance = null;

function getBackgroundService() {
  if (!backgroundServiceInstance) {
    backgroundServiceInstance = new BackgroundService();
  }
  return backgroundServiceInstance;
}

module.exports = {
  BackgroundService,
  getBackgroundService
};
