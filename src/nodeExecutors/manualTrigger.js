/**
 * Manual Trigger Node Executor
 * Entry point for manually triggered workflows
 */
async function execute(node, inputData, executionContext) {
  // Manual trigger just passes through the initial data
  // If no input data, return empty object
  if (!inputData || inputData.length === 0) {
    return [{ json: {} }];
  }

  return inputData;
}

module.exports = {
  execute
};
