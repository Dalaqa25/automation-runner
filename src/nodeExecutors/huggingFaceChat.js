const { evaluateExpression } = require('../utils/expressions');

/**
 * HuggingFace Chat Model Node Executor
 * Handles HuggingFace chat model configuration
 */
async function execute(node, inputData, executionContext) {
  const nodeType = node.type;

  if (nodeType === '@n8n/n8n-nodes-langchain.lmChatHf') {
    return await executeHuggingFaceChat(node, inputData, executionContext);
  }

  throw new Error(`Unsupported HuggingFace chat node type: ${nodeType}`);
}

async function executeHuggingFaceChat(node, inputData, executionContext) {
  const params = node.parameters || {};
  const model = params.model || 'microsoft/DialoGPT-medium'; // Default HuggingFace chat model

  // This node just returns the model configuration
  // The actual API calls are made by the agent node
  // We don't need to check for API key here - the Agent will handle that
  return [{
    json: {
      model: model,
      provider: 'huggingface'
    }
  }];
}

module.exports = {
  execute
};

