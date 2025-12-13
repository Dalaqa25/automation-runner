/**
 * Sticky Note Node Executor
 * Sticky notes are UI elements only - they don't execute
 */
async function execute(node, inputData, executionContext) {
  // Sticky notes are just UI elements, pass through input data
  return inputData || [];
}

module.exports = {
  execute
};

