/**
 * Split In Batches Node Executor
 * Loops through items in batches, processing them iteratively
 */
async function execute(node, inputData, executionContext) {
  const params = node.parameters || {};
  const batchSize = params.batchSize || 10;
  const options = params.options || {};
  
  // Get the current batch state from execution context
  const nodeId = node.id || node.name;
  const batchState = executionContext.batchStates?.[nodeId] || {
    currentBatch: 0,
    totalBatches: 0,
    allItems: []
  };

  // Initialize batch states in execution context if not exists
  if (!executionContext.batchStates) {
    executionContext.batchStates = {};
  }

  // First execution - store all items and calculate batches
  if (batchState.currentBatch === 0) {
    batchState.allItems = inputData || [];
    batchState.totalBatches = Math.ceil(batchState.allItems.length / batchSize);
    batchState.currentBatch = 1;
  }

  // Get current batch items
  const startIndex = (batchState.currentBatch - 1) * batchSize;
  const endIndex = Math.min(startIndex + batchSize, batchState.allItems.length);
  const batchItems = batchState.allItems.slice(startIndex, endIndex);

  // Check if there are more batches
  const hasMoreBatches = batchState.currentBatch < batchState.totalBatches;

  // Store updated state
  executionContext.batchStates[nodeId] = batchState;

  // Return batch items with metadata
  // Output 0 (main): Current batch items (continues to next nodes)
  // Output 1 (loop): Items to loop back (only if more batches exist)
  const output = batchItems.map(item => ({
    ...item,
    json: {
      ...(item.json || {}),
      _batchInfo: {
        currentBatch: batchState.currentBatch,
        totalBatches: batchState.totalBatches,
        batchSize: batchItems.length
      }
    }
  }));

  // Increment batch counter for next iteration
  if (hasMoreBatches) {
    batchState.currentBatch++;
  } else {
    // Reset state after last batch
    delete executionContext.batchStates[nodeId];
  }

  return output;
}

module.exports = {
  execute
};
