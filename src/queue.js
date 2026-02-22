const { Queue, Worker } = require('bullmq');
const WorkflowRunner = require('./runner');

// Redis connection (can be configured via environment variables)
// In production (Railway), use REDIS_URL. In local dev, fall back to localhost.
const redisConnection = process.env.REDIS_URL 
  ? { url: process.env.REDIS_URL }
  : {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD
    };

// Create queue
const workflowQueue = new Queue('workflow-execution', {
  connection: redisConnection
});

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
    
    const result = await runner.execute(
      workflow, 
      initialData || {}, 
      tokens || {},
      tokenMapping || {}
    );
    
    return result;
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
  
  // Send webhook notification
  try {
    const webhookUrl = process.env.WEBHOOK_URL || process.env.NEXT_PUBLIC_APP_URL;
    if (webhookUrl) {
      const payload = {
        jobId: job.id,
        automation_id: job.data.workflow?.id || job.data.initialData?.automation_id,
        user_id: job.data.initialData?.user_id,
        status: 'success',
        result: result,
        executedAt: new Date().toISOString()
      };
      
      console.log(`[Queue] Sending webhook to ${webhookUrl}/api/webhook/automation-complete`);
      
      const response = await fetch(`${webhookUrl}/api/webhook/automation-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        console.error(`[Queue] Webhook failed: ${response.status}`);
      } else {
        console.log(`[Queue] Webhook sent successfully`);
      }
    }
  } catch (webhookError) {
    console.error(`[Queue] Webhook error:`, webhookError.message);
  }
});

worker.on('failed', async (job, err) => {
  console.error(`[Queue] Job ${job.id} failed:`, err.message);
  
  // Send webhook notification for failure
  try {
    const webhookUrl = process.env.WEBHOOK_URL || process.env.NEXT_PUBLIC_APP_URL;
    if (webhookUrl) {
      const payload = {
        jobId: job.id,
        automation_id: job.data.workflow?.id || job.data.initialData?.automation_id,
        user_id: job.data.initialData?.user_id,
        status: 'failed',
        error: err.message,
        executedAt: new Date().toISOString()
      };
      
      console.log(`[Queue] Sending failure webhook to ${webhookUrl}/api/webhook/automation-complete`);
      
      const response = await fetch(`${webhookUrl}/api/webhook/automation-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        console.error(`[Queue] Failure webhook failed: ${response.status}`);
      }
    }
  } catch (webhookError) {
    console.error(`[Queue] Failure webhook error:`, webhookError.message);
  }
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

