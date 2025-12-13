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

module.exports = {
  addWorkflowJob,
  getJobStatus,
  workflowQueue,
  worker
};

