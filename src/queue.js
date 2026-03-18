const { Queue, Worker } = require('bullmq');
const WorkflowRunner = require('./runner');
const { createClient } = require('@supabase/supabase-js');
const { refreshTokenIfNeeded } = require('./tokenRefresh');

// Initialize Supabase client for notifications
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Redis connection (can be configured via environment variables)
// In production (Railway), use REDIS_URL. In local dev, fall back to localhost.
const redisConnection = process.env.REDIS_URL
  ? { url: process.env.REDIS_URL }
  : {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD
  };

/**
 * Create a notification in the database when automation completes
 */
async function createNotification(job, status, result, error) {
  try {
    const automation_id = job.data.workflow?.id || job.data.initialData?.automation_id;
    const user_id = job.data.initialData?.user_id;

    if (!automation_id || !user_id) {
      console.log('[Queue] Skipping notification - missing automation_id or user_id');
      return;
    }

    // Get automation name
    const { data: automation } = await supabase
      .from('automations')
      .select('name')
      .eq('id', automation_id)
      .single();

    const automationName = automation?.name || 'Automation';

    // Get user email
    const { data: user } = await supabase
      .from('users')
      .select('email')
      .eq('id', user_id)
      .single();

    if (!user?.email) {
      console.error('[Queue] User not found:', user_id);
      return;
    }

    // Create notification message
    let notificationMessage;
    let notificationType;

    if (status === 'success') {
      notificationMessage = `✅ ${automationName} completed successfully`;
      notificationType = 'success';

      if (result && typeof result === 'object') {
        if (result.message) {
          notificationMessage += `: ${result.message}`;
        } else if (result.postsCreated) {
          notificationMessage += ` - ${result.postsCreated} posts created`;
        }
      }
    } else {
      notificationMessage = `❌ ${automationName} failed`;
      notificationType = 'error';

      if (error) {
        notificationMessage += `: ${error}`;
      }
    }

    // Insert notification
    const { error: notifError } = await supabase
      .from('notifications')
      .insert({
        user_email: user.email,
        message: notificationMessage,
        type: notificationType,
        metadata: {
          automation_id,
          jobId: job.id,
          status,
          result,
          error,
          executedAt: new Date().toISOString()
        },
        created_at: new Date().toISOString()
      });

    if (notifError) {
      console.error('[Queue] Failed to create notification:', notifError);
    } else {
      console.log('[Queue] Notification created for user:', user.email);
    }
  } catch (err) {
    console.error('[Queue] Error creating notification:', err.message);
  }
}

// Create queue
const workflowQueue = new Queue('workflow-execution', {
  connection: redisConnection
});

/**
 * Strip binary data from workflow results to prevent BullMQ serialization crashes.
 * Large binary payloads (e.g. downloaded videos) cause JSON.stringify to throw
 * RangeError: Invalid string length.
 */
function sanitizeResult(result) {
  if (!result || typeof result !== 'object') return result;

  try {
    const sanitized = { ...result };

    if (sanitized.outputs && typeof sanitized.outputs === 'object') {
      const cleanOutputs = {};
      for (const [nodeName, nodeOutput] of Object.entries(sanitized.outputs)) {
        if (Array.isArray(nodeOutput)) {
          cleanOutputs[nodeName] = nodeOutput.map(item => {
            if (!item || !item.json) return item;
            const cleanJson = {};
            for (const [key, value] of Object.entries(item.json)) {
              // Strip binary data: Buffer, ArrayBuffer, large strings (>1MB)
              if (Buffer.isBuffer(value) || value instanceof ArrayBuffer) {
                cleanJson[key] = `[Binary data: ${value.byteLength || value.length} bytes]`;
              } else if (typeof value === 'string' && value.length > 1_000_000) {
                cleanJson[key] = `[Large string: ${value.length} chars]`;
              } else {
                cleanJson[key] = value;
              }
            }
            // Also strip top-level binary property if present
            const cleanItem = { json: cleanJson };
            if (item.binary) {
              cleanItem.binary = '[stripped]';
            }
            return cleanItem;
          });
        } else {
          cleanOutputs[nodeName] = nodeOutput;
        }
      }
      sanitized.outputs = cleanOutputs;
    }

    return sanitized;
  } catch (e) {
    console.error('[Queue] Failed to sanitize result:', e.message);
    // Return a minimal safe result
    return {
      success: result.success,
      errors: result.errors,
      message: 'Result sanitized due to serialization issues'
    };
  }
}

/**
 * Re-fetch fresh tokens from the database and refresh if expired.
 * This is needed because scheduled/queued jobs store tokens at schedule-time
 * and they may expire before the job actually runs.
 */
async function refreshJobTokens(tokens, initialData) {
  const userId = initialData?.user_id;
  const automationId = initialData?.automation_id;

  if (!userId || !automationId) {
    // No user/automation context — use tokens as-is (manual /queue calls)
    return tokens;
  }

  try {
    // Fetch the latest token data from the database
    const { data: instanceData, error } = await supabase
      .from('user_automations')
      .select('id, provider, access_token, refresh_token, token_expiry')
      .eq('user_id', userId)
      .eq('automation_id', automationId)
      .single();

    if (error || !instanceData) {
      console.warn(`[Queue] Could not fetch fresh tokens for user=${userId}, automation=${automationId}: ${error?.message || 'not found'}`);
      return tokens;
    }

    // Attempt token refresh if expired
    let validAccessToken = instanceData.access_token;
    let validRefreshToken = instanceData.refresh_token;

    try {
      const refreshResult = await refreshTokenIfNeeded(instanceData, supabase);
      if (refreshResult.refreshed) {
        validAccessToken = refreshResult.accessToken;
        validRefreshToken = refreshResult.refreshToken;
        console.log(`[Queue] Refreshed tokens for provider: ${instanceData.provider}`);
      } else {
        console.log(`[Queue] Tokens still valid for provider: ${instanceData.provider}`);
      }
    } catch (refreshErr) {
      console.error(`[Queue] Token refresh failed: ${refreshErr.message}`);
      // Continue with DB tokens (they might still work)
    }

    // Build updated tokens object
    const updatedTokens = { ...tokens };
    const providerName = (instanceData.provider || '').toLowerCase();

    if (validAccessToken) {
      updatedTokens.accessToken = validAccessToken;
      if (!providerName.includes('tiktok')) {
        updatedTokens.googleAccessToken = validAccessToken;
      }
    }
    if (validRefreshToken) {
      updatedTokens.refreshToken = validRefreshToken;
      if (!providerName.includes('tiktok')) {
        updatedTokens.googleRefreshToken = validRefreshToken;
      }
    }

    return updatedTokens;
  } catch (err) {
    console.error(`[Queue] Error refreshing job tokens:`, err.message);
    return tokens;
  }
}

// Create worker to process jobs
const worker = new Worker(
  'workflow-execution',
  async (job) => {
    const { workflow, initialData, tokens, tokenMapping } = job.data;
    const runner = new WorkflowRunner();

    console.log(`[Queue] Processing workflow: ${workflow.name || 'unnamed'}`);
    if (tokens) {
      const tokenKeys = Object.keys(tokens).filter(key => tokens[key] !== null);
      console.log(`[Queue] Injecting tokens: ${tokenKeys.join(', ')}`);
    }
    if (tokenMapping) {
      console.log(`[Queue] Using custom token mapping: ${Object.keys(tokenMapping).join(', ')}`);
    }

    // Re-fetch and refresh tokens from DB to avoid using stale/expired tokens
    const freshTokens = await refreshJobTokens(tokens || {}, initialData);

    const result = await runner.execute(
      workflow,
      initialData || {},
      freshTokens,
      tokenMapping || {}
    );

    // Sanitize result to strip binary data before BullMQ serializes it
    return sanitizeResult(result);
  },
  {
    connection: redisConnection,
    concurrency: 5 // Process up to 5 workflows concurrently
  }
);

// Worker event handlers
worker.on('completed', async (job, result) => {
  console.log(`[Queue] Job ${job.id} completed`);

  // Check if this is a repeating job that should auto-cleanup
  if (job.opts.repeat) {
    const maxRuns = job.data.maxRuns;
    const runCount = (job.data.runCount || 0) + 1;

    if (maxRuns && runCount >= maxRuns) {
      console.log(`[Queue] Job ${job.id} reached max runs (${runCount}/${maxRuns}). Auto-removing scheduled job...`);

      try {
        // Find and remove the repeatable job
        const repeatableJobs = await workflowQueue.getRepeatableJobs();
        const thisJob = repeatableJobs.find(j => j.key === job.opts.repeat.key);

        if (thisJob) {
          await workflowQueue.removeRepeatableByKey(thisJob.key);
          console.log(`[Queue] Successfully auto-removed scheduled job after ${runCount} runs`);
        }
      } catch (cleanupError) {
        console.error(`[Queue] Failed to auto-remove scheduled job:`, cleanupError.message);
      }
    } else if (maxRuns) {
      console.log(`[Queue] Job run count: ${runCount}/${maxRuns}`);
    }
  }

  // Create notification directly in database
  await createNotification(job, 'success', result, null);
});

worker.on('failed', async (job, err) => {
  console.error(`[Queue] Job ${job.id} failed:`, err.message);

  // Create notification directly in database
  await createNotification(job, 'failed', null, err.message);
});

/**
 * Add a workflow execution job to the queue
 * @param {Object} workflow - Workflow JSON
 * @param {Object} initialData - Initial data for the workflow
 * @param {Object} tokens - Authentication tokens
 * @param {Object} tokenMapping - Optional custom token name mapping
 * @param {number} delay - Optional delay in milliseconds before execution (default: 0)
 * @returns {Promise<string>} Job ID
 */
async function addWorkflowJob(workflow, initialData = {}, tokens = {}, tokenMapping = {}, delay = 0) {
  // Validate delay
  if (typeof delay !== 'number' || delay < 0) {
    throw new Error('Delay must be a non-negative number (milliseconds)');
  }

  const MAX_DELAY = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
  if (delay > MAX_DELAY) {
    throw new Error(`Delay cannot exceed 30 days (${MAX_DELAY}ms)`);
  }

  const jobOptions = {
    attempts: 3, // Retry up to 3 times
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  };

  // Add delay if specified
  if (delay > 0) {
    jobOptions.delay = delay;
  }

  const job = await workflowQueue.add('execute-workflow', {
    workflow,
    initialData,
    tokens,
    tokenMapping
  }, jobOptions);

  return job.id;
}

/**
 * Get job status
 * @param {string} jobId - Job ID
 * @returns {Promise<Object>} Job status
 */
async function getJobStatus(jobId) {
  const job = await workflowQueue.getJob(jobId);

  if (!job) {
    return { status: 'not_found' };
  }

  const state = await job.getState();

  return {
    id: job.id,
    status: state,
    progress: job.progress,
    result: job.returnvalue,
    error: job.failedReason
  };
}

/**
 * Schedule a workflow to run repeatedly
 * @param {Object} workflow - Workflow JSON
 * @param {Object} initialData - Initial data for the workflow
 * @param {Object} tokens - Authentication tokens
 * @param {Object} tokenMapping - Optional custom token name mapping
 * @param {string} cronExpression - Cron expression (e.g., '0 * * * *' for every hour)
 * @param {number} maxRuns - Optional: max number of times to run before auto-removing (default: unlimited)
 * @returns {Promise<Object>} Schedule info with job key
 */
async function scheduleWorkflow(workflow, initialData = {}, tokens = {}, tokenMapping = {}, cronExpression, maxRuns = null) {
  if (!cronExpression) {
    throw new Error('Cron expression is required for scheduling');
  }

  // Validate cron expression (basic check)
  const cronParts = cronExpression.trim().split(' ');
  if (cronParts.length < 5) {
    throw new Error('Invalid cron expression. Expected format: "minute hour day month weekday"');
  }

  const workflowName = workflow.name || 'scheduled-workflow';

  // Add repeatable job
  const job = await workflowQueue.add(
    `scheduled-${workflowName}`,
    {
      workflow,
      initialData,
      tokens,
      tokenMapping,
      maxRuns,
      runCount: 0
    },
    {
      repeat: {
        pattern: cronExpression
      },
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      }
    }
  );

  console.log(`[Queue] Scheduled workflow "${workflowName}" with pattern: ${cronExpression}${maxRuns ? ` (max ${maxRuns} runs)` : ''}`);

  // Get repeat key for managing this scheduled job
  const repeatableJobs = await workflowQueue.getRepeatableJobs();
  const thisJob = repeatableJobs.find(j => j.name === `scheduled-${workflowName}`);

  return {
    jobId: job.id,
    jobKey: thisJob?.key,
    name: workflowName,
    schedule: cronExpression,
    maxRuns: maxRuns || 'unlimited',
    nextRun: thisJob?.next ? new Date(thisJob.next) : null
  };
}

/**
 * Remove a scheduled workflow
 * @param {string} jobKey - Job key from scheduleWorkflow response
 * @returns {Promise<boolean>} Success status
 */
async function removeScheduledWorkflow(jobKey) {
  if (!jobKey) {
    throw new Error('Job key is required to remove scheduled workflow');
  }

  await workflowQueue.removeRepeatableByKey(jobKey);
  console.log(`[Queue] Removed scheduled workflow with key: ${jobKey}`);

  return true;
}

/**
 * List all scheduled workflows
 * @returns {Promise<Array>} List of scheduled workflows
 */
async function listScheduledWorkflows() {
  const repeatableJobs = await workflowQueue.getRepeatableJobs();

  return repeatableJobs.map(job => ({
    key: job.key,
    name: job.name,
    schedule: job.pattern,
    nextRun: job.next ? new Date(job.next) : null,
    endDate: job.endDate ? new Date(job.endDate) : null
  }));
}

module.exports = {
  addWorkflowJob,
  getJobStatus,
  scheduleWorkflow,
  removeScheduledWorkflow,
  listScheduledWorkflows,
  workflowQueue,
  worker
};

