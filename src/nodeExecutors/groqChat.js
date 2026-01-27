/**
 * Groq Chat Model Node Executor
 * Handles Groq chat model configuration
 * Default model: llama-3.3-70b-versatile (free tier)
 */
async function execute(node, inputData, executionContext) {
  const nodeType = node.type;

  if (nodeType === '@n8n/n8n-nodes-langchain.lmChatGroq' || 
      nodeType === 'n8n-nodes-base.groqChat') {
    return await executeGroqChat(node, inputData, executionContext);
  }

  throw new Error(`Unsupported Groq chat node type: ${nodeType}`);
}

async function executeGroqChat(node, inputData, executionContext) {
  const params = node.parameters || {};
  const model = params.model || 'llama-3.3-70b-versatile';

  // This node just returns the model configuration
  // The actual API calls are made by the agent node
  return [{
    json: {
      model: model,
      provider: 'groq'
    }
  }];
}

module.exports = {
  execute
};
