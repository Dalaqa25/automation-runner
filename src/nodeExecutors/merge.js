/**
 * Merge Node Executor
 * Combines data from multiple input sources
 */
async function execute(node, inputData, executionContext) {
  const params = node.parameters || {};
  const mode = params.mode || 'combine';

  if (!inputData || inputData.length === 0) {
    if (params.alwaysOutputData) {
      return [{ json: {} }];
    }
    return [];
  }

  switch (mode) {
    case 'combine':
    case 'combineByPosition':
      // Combine items by position
      return combineByPosition(inputData, node, executionContext);
    
    case 'append':
      // Append all items
      return inputData;
    
    case 'merge':
      // Merge objects
      return mergeObjects(inputData);
    
    default:
      return inputData;
  }
}

function combineByPosition(inputData, node, executionContext) {
  // Get all input branches
  const branches = [];
  
  // Find all nodes that connect to this merge node
  const { workflow } = executionContext;
  const { connections } = workflow;
  
  if (connections) {
    for (const [sourceNodeName, nodeConnections] of Object.entries(connections)) {
      if (nodeConnections.main) {
        for (const outputArray of nodeConnections.main) {
          for (const connection of outputArray) {
            if (
              (node?.name && connection.node === node.name) ||
              (node?.id && connection.node === node.id)
            ) {
              const sourceOutput = executionContext.nodes[sourceNodeName];
              if (sourceOutput) {
                branches.push(sourceOutput);
              }
            }
          }
        }
      }
    }
  }

  // Combine by position (first item from each branch, second item from each branch, etc.)
  const maxLength = Math.max(...branches.map(b => b.length), 0);
  const result = [];

  for (let i = 0; i < maxLength; i++) {
    const combined = {};
    let binaryData = null;
    
    branches.forEach(branch => {
      if (branch[i]) {
        const branchData = branch[i].json || branch[i];
        
        // Preserve binary data separately
        if (branch[i].data) {
          binaryData = branch[i].data;
        }
        
        // Merge JSON data, but skip httpStatus to avoid conflicts
        Object.keys(branchData).forEach(key => {
          // Skip httpStatus from HTTP responses to avoid conflicts with workflow data
          if (key !== 'httpStatus') {
            combined[key] = branchData[key];
          }
        });
      }
    });
    
    const resultItem = { json: combined };
    if (binaryData) {
      resultItem.data = binaryData;
    }
    result.push(resultItem);
  }

  return result.length > 0 ? result : inputData;
}

function mergeObjects(inputData) {
  // Merge all objects into one
  const merged = {};
  inputData.forEach(item => {
    Object.assign(merged, item.json || item);
  });
  return [{ json: merged }];
}

module.exports = {
  execute
};

