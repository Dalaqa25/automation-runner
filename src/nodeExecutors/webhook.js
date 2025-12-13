/**
 * Webhook Node Executor
 * Webhook nodes are entry points - they just pass through initial data
 */
async function execute(node, inputData, executionContext) {
  // Webhook nodes receive initial data and pass it through
  return inputData || [];
}

module.exports = {
  execute
};

