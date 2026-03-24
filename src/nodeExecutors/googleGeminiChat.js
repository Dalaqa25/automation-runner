/**
 * Google Gemini (PaLM) Chat Model Node Executor
 * Handles Google Gemini chat model configuration
 * Used as a language model provider for Agent nodes
 */
async function execute(node, inputData, executionContext) {
  const nodeType = node.type;

  if (nodeType === '@n8n/n8n-nodes-langchain.lmChatGoogleGemini') {
    return await executeGoogleGeminiChat(node, inputData, executionContext);
  }

  throw new Error(`Unsupported Google Gemini chat node type: ${nodeType}`);
}

async function executeGoogleGeminiChat(node, inputData, executionContext) {
  const params = node.parameters || {};
  const model = params.modelName || params.model || 'gemini-1.5-flash-latest';

  // This node returns model configuration for the Agent executor to use.
  // The Agent node will look up the connected language model and use its
  // provider/model info to choose the right API.
  return [{
    json: {
      model: model,
      provider: 'google-gemini'
    }
  }];
}

module.exports = {
  execute
};
