/**
 * Memory Node Executor
 * Handles buffer window memory for agents
 */
async function execute(node, inputData, executionContext) {
  const nodeType = node.type;

  if (nodeType === '@n8n/n8n-nodes-langchain.memoryBufferWindow') {
    return await executeBufferWindowMemory(node, inputData, executionContext);
  }

  throw new Error(`Unsupported memory node type: ${nodeType}`);
}

async function executeBufferWindowMemory(node, inputData, executionContext) {
  const params = node.parameters || {};
  const windowSize = params.windowSize || 10; // Default window size

  // Initialize memory in execution context if not exists
  const nodeKey = node.name || node.id;
  if (!executionContext.memory) {
    executionContext.memory = {};
  }

  if (!executionContext.memory[nodeKey]) {
    executionContext.memory[nodeKey] = {
      messages: [],
      windowSize: windowSize
    };
  }

  const memory = executionContext.memory[nodeKey];

  // Add new messages from input
  for (const item of inputData || []) {
    const message = item.json?.message || item.json?.text || item.json?.content || JSON.stringify(item.json);
    if (message) {
      memory.messages.push({
        role: 'user',
        content: String(message),
        timestamp: Date.now()
      });
    }
  }

  // Keep only the last windowSize messages
  if (memory.messages.length > windowSize) {
    memory.messages = memory.messages.slice(-windowSize);
  }

  // Return memory state
  return [{
    json: {
      messages: memory.messages,
      windowSize: windowSize,
      count: memory.messages.length
    }
  }];
}

module.exports = {
  execute
};

