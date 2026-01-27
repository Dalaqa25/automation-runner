const axios = require('axios');
const { evaluateExpression } = require('../utils/expressions');

/**
 * AI/LLM Node Executor
 * Handles LLM chain and model nodes (OpenRouter, OpenAI, etc.)
 */
async function execute(node, inputData, executionContext) {
  const nodeType = node.type;

  // LLM Chain node
  if (nodeType === '@n8n/n8n-nodes-langchain.chainLlm') {
    return await executeLLMChain(node, inputData, executionContext);
  }

  // Model node (just returns config, doesn't execute)
  if (nodeType === '@n8n/n8n-nodes-langchain.lmChatOpenRouter') {
    return [{ json: { model: node.parameters?.model || 'default' } }];
  }

  throw new Error(`Unsupported AI node type: ${nodeType}`);
}

async function executeLLMChain(node, inputData, executionContext) {
  const params = node.parameters || {};
  
  // Get the model node (connected via ai_languageModel connection)
  const modelNode = findConnectedModelNode(node, executionContext.workflow);
  
  if (!modelNode) {
    throw new Error('No model node connected to LLM Chain');
  }

  // Check if we should use Groq instead of OpenRouter
  const useGroq = process.env.GROQ_API_KEY && !process.env.PREFER_OPENROUTER;
  const model = modelNode.parameters?.model || (useGroq ? 'llama-3.3-70b-versatile' : 'deepseek/deepseek-chat-v3.1:free');
  
  // Build messages
  const messages = [];
  
  if (params.messages?.messageValues) {
    for (const msg of params.messages.messageValues) {
      const messageText = evaluateExpression(msg.message || '', {
        currentInput: inputData,
        executionContext
      });
      messages.push({
        role: 'user',
        content: messageText
      });
    }
  } else if (params.text) {
    const text = evaluateExpression(params.text || '', {
      currentInput: inputData,
      executionContext
    });
    messages.push({
      role: 'user',
      content: text
    });
  }

  // Prefer Groq if available, otherwise use OpenRouter
  let apiKey, apiUrl, headers;
  
  if (useGroq) {
    apiKey = executionContext.tokens?.groqApiKey || 
             executionContext.tokenInjector?.getToken('groqApiKey') ||
             process.env.GROQ_API_KEY;
    apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
    headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };
    
    if (!apiKey) {
      throw new Error('GROQ_API_KEY not provided. Set it in tokens.groqApiKey or GROQ_API_KEY environment variable');
    }
  } else {
    apiKey = executionContext.tokens?.openRouterApiKey || 
             executionContext.tokenInjector?.getToken('openRouterApiKey') ||
             process.env.OPENROUTER_API_KEY;
    apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
    headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://automation-runner.local',
      'X-Title': 'Automation Runner'
    };
    
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY not provided. Set it in tokens.openRouterApiKey or OPENROUTER_API_KEY environment variable');
    }
  }

  try {
    // Call API (Groq or OpenRouter)
    const response = await axios.post(
      apiUrl,
      {
        model: model,
        messages: messages
      },
      { headers }
    );

    const content = response.data.choices[0]?.message?.content || '';
    
    return [{
      json: {
        text: content,
        model: model,
        provider: useGroq ? 'groq' : 'openrouter',
        usage: response.data.usage
      }
    }];
  } catch (error) {
    if (error.response) {
      const provider = useGroq ? 'Groq' : 'OpenRouter';
      throw new Error(`${provider} API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

function findConnectedModelNode(chainNode, workflow) {
  const { connections } = workflow;
  if (!connections) return null;

  // Find model node connected via ai_languageModel connection
  for (const [nodeName, nodeConnections] of Object.entries(connections)) {
    if (nodeConnections.ai_languageModel) {
      for (const outputArray of nodeConnections.ai_languageModel) {
        for (const connection of outputArray) {
          if (connection.node === chainNode.name) {
            // Found the model node
            return workflow.nodes.find(n => n.name === nodeName);
          }
        }
      }
    }
  }

  return null;
}

module.exports = {
  execute
};

