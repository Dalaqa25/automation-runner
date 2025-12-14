/**
 * Limit Node Executor
 * Limits the number of items that pass through
 */
async function execute(node, inputData, executionContext) {
  const params = node.parameters || {};
  const maxItems = params.maxItems || 1;
  const keepMissing = params.keepMissing !== false; // Default true

  if (!inputData || inputData.length === 0) {
    return keepMissing ? [] : inputData;
  }

  // Limit items to maxItems
  const limitedData = inputData.slice(0, maxItems);

  console.log(`[Limit] Limited ${inputData.length} items to ${limitedData.length} items`);

  return limitedData;
}

module.exports = {
  execute
};
