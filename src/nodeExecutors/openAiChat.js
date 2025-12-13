const axios = require('axios');
const { evaluateExpression } = require('../utils/expressions');

/**
 * OpenAI Chat Model Node Executor
 * Handles OpenAI chat model configuration
 */
async function execute(node, inputData, executionContext) {
  const nodeType = node.type;

  if (nodeType === '@n8n/n8n-nodes-langchain.lmChatOpenAi') {
    return await executeOpenAIChat(node, inputData, executionContext);
  }

  throw new Error(`Unsupported OpenAI chat node type: ${nodeType}`);
}

async function executeOpenAIChat(node, inputData, executionContext) {
  const params = node.parameters || {};
  const model = params.model || 'gpt-3.5-turbo';

  // This node just returns the model configuration
  // The actual API calls are made by the agent node
  // We don't need to check for API key here - the Agent will handle that
  return [{
    json: {
      model: model,
      provider: 'openai'
    }
  }];
}

module.exports = {
  execute
};

