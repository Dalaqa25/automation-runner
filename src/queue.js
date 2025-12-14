const { Queue, Worker } = require('bullmq');
const WorkflowRunner = require('./runner');

// Redis connection (can be configured via environment variables)
const redisConnection = {
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
worker.on('completed', (job) => {
  console.log(`[Queue] Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[Queue] Job ${job.id} failed:`, err.message);
});

/**
 * Add a workflow execution job to the queue
 * @param {Object} workflow - Workflow JSON
 * @param {Object} initialData - Initial data for the workflow
 * @param {Object} tokens - Authentication tokens
 * @param {Object} tokenMapping - Optional custom token name mapping
 * @returns {Promise<string>} Job ID
 */
async function addWorkflowJob(workflow, initialData = {}, tokens = {}, tokenMapping = {}) {
  const job = await workflowQueue.add('execute-workflow', {
    workflow,
    initialData,
    tokens,
    tokenMapping
  }, {
    attempts: 3, // Retry up to 3 times
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  });

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
 * @returns {Promise<Object>} Schedule info with job key
 */
async function scheduleWorkflow(workflow, initialData = {}, tokens = {}, tokenMapping = {}, cronExpression) {
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
      tokenMapping
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

  console.log(`[Queue] Scheduled workflow "${workflowName}" with pattern: ${cronExpression}`);

  // Get repeat key for managing this scheduled job
  const repeatableJobs = await workflowQueue.getRepeatableJobs();
  const thisJob = repeatableJobs.find(j => j.name === `scheduled-${workflowName}`);

  return {
    jobId: job.id,
    jobKey: thisJob?.key,
    name: workflowName,
    schedule: cronExpression,
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

