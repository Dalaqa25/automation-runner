const axios = require('axios');
const { evaluateExpression } = require('../utils/expressions');

/**
 * Anthropic Chat Model Node Executor
 * Handles Anthropic (Claude) chat model configuration
 */
async function execute(node, inputData, executionContext) {
  const nodeType = node.type;

  if (nodeType === '@n8n/n8n-nodes-langchain.lmChatAnthropic') {
    return await executeAnthropicChat(node, inputData, executionContext);
  }

  throw new Error(`Unsupported Anthropic chat node type: ${nodeType}`);
}

async function executeAnthropicChat(node, inputData, executionContext) {
  const params = node.parameters || {};
  const model = params.model || 'claude-3-sonnet-20240229';

  // This node just returns the model configuration
  // The actual API calls are made by the agent node
  // We don't need to check for API key here - the Agent will handle that
  return [{
    json: {
      model: model,
      provider: 'anthropic'
    }
  }];
}

module.exports = {
  execute
};

