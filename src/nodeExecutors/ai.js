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

  const model = modelNode.parameters?.model || 'deepseek/deepseek-chat-v3.1:free';
  
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

  // Get API key from injected tokens first, then fall back to environment
  const apiKey = executionContext.tokens?.openRouterApiKey || 
                 executionContext.tokenInjector?.getToken('openRouterApiKey') ||
                 process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY not provided. Set it in tokens.openRouterApiKey or OPENROUTER_API_KEY environment variable');
  }

  try {
    // Call OpenRouter API
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: model,
        messages: messages
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://automation-runner.local',
          'X-Title': 'Automation Runner'
        }
      }
    );

    const content = response.data.choices[0]?.message?.content || '';
    
    return [{
      json: {
        text: content,
        model: model,
        usage: response.data.usage
      }
    }];
  } catch (error) {
    if (error.response) {
      throw new Error(`OpenRouter API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
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

