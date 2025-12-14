/**
 * Schedule Trigger Node Executor
 * Entry point for scheduled workflows
 * Note: Actual scheduling should be handled externally (cron, etc.)
 * This executor just passes through data when the workflow is triggered
 */
async function execute(node, inputData, executionContext) {
  const params = node.parameters || {};
  
  // Log schedule info for debugging
  if (params.rule?.interval) {
    console.log(`[Schedule Trigger] Workflow triggered (schedule: ${JSON.stringify(params.rule.interval)})`);
  }

  // Schedule trigger just passes through the initial data
  // If no input data, return empty object with timestamp
  if (!inputData || inputData.length === 0) {
    return [{
      json: {
        timestamp: new Date().toISOString(),
        triggered: true
      }
    }];
  }

  return inputData;
}

module.exports = {
  execute
};
