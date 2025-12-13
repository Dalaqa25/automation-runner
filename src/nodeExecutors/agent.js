const axios = require('axios');
const { evaluateExpression } = require('../utils/expressions');

/**
 * LangChain Agent Node Executor
 * Orchestrates AI agent with tools, memory, and language model
 */
async function execute(node, inputData, executionContext) {
  const nodeType = node.type;

  if (nodeType === '@n8n/n8n-nodes-langchain.agent') {
    return await executeAgent(node, inputData, executionContext);
  }

  throw new Error(`Unsupported agent node type: ${nodeType}`);
}

async function executeAgent(node, inputData, executionContext) {
  const params = node.parameters || {};
  
  // Get connected components
  const languageModel = getConnectedLanguageModel(node, executionContext);
  const memory = getConnectedMemory(node, executionContext);
  const tools = getConnectedTools(node, executionContext);

  if (!languageModel) {
    throw new Error('No language model connected to agent');
  }

  // Get prompt from input or parameters
  let prompt = '';
  if (params.text) {
    prompt = evaluateExpression(params.text, {
      currentInput: inputData,
      executionContext
    });
  } else if (inputData && inputData.length > 0) {
    prompt = inputData[0].json?.message || 
             inputData[0].json?.text || 
             inputData[0].json?.content ||
             JSON.stringify(inputData[0].json);
  }

  if (!prompt) {
    throw new Error('No prompt provided to agent');
  }

  // Get model configuration
  const model = languageModel.json?.model || 'gpt-3.5-turbo';
  const provider = languageModel.json?.provider || 'openai';
  
  // Support OpenAI, Anthropic, and HuggingFace
  let apiKey;
  let apiUrl;
  
  if (provider === 'anthropic') {
    apiKey = executionContext.tokens?.anthropicApiKey ||
             executionContext.tokenInjector?.getToken('anthropicApiKey') ||
             process.env.ANTHROPIC_API_KEY;
    apiUrl = 'https://api.anthropic.com/v1/messages';
    
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY not provided');
    }
  } else if (provider === 'huggingface') {
    apiKey = executionContext.tokens?.huggingFaceApiKey ||
             executionContext.tokenInjector?.getToken('huggingFaceApiKey') ||
             process.env.HUGGINGFACE_API_KEY;
    apiUrl = null; // HuggingFace uses different API structure
    
    if (!apiKey) {
      throw new Error('HUGGINGFACE_API_KEY not provided');
    }
  } else {
    apiKey = executionContext.tokens?.openAiApiKey ||
             executionContext.tokenInjector?.getToken('openAiApiKey') ||
             process.env.OPENAI_API_KEY;
    apiUrl = 'https://api.openai.com/v1/chat/completions';
    
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not provided');
    }
  }

  // Get memory messages
  const memoryMessages = memory?.json?.messages || [];
  const conversationHistory = memoryMessages.map(msg => ({
    role: msg.role || 'user',
    content: msg.content || msg.text || ''
  }));

  // Build messages for OpenAI API
  const messages = [
    ...conversationHistory,
    {
      role: 'user',
      content: prompt
    }
  ];

  // If tools are available, use function calling
  let functions = null;
  if (tools && tools.length > 0) {
    // Build function definitions for vector store tool
    functions = tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.json?.toolName || 'search_vector_store',
        description: tool.json?.description || 'Search the vector store for relevant information',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query'
            }
          },
          required: ['query']
        }
      }
    }));
  }

  try {
    let response;
    
    if (provider === 'anthropic') {
      // Call Anthropic API
      const requestBody = {
        model: model,
        max_tokens: 1024,
        messages: messages
      };

      response = await axios.post(
        apiUrl,
        requestBody,
        {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
          }
        }
      );
      
      const content = response.data.content?.[0]?.text || '';
      
      return [{
        json: {
          text: content,
          model: model,
          usage: response.data.usage
        }
      }];
    } else if (provider === 'huggingface') {
      // Call HuggingFace Inference API
      const { HfInference } = require('@huggingface/inference');
      const hf = new HfInference(apiKey);
      
      // Get the last user message as input
      const lastMessage = messages[messages.length - 1]?.content || '';
      
      // Use text generation for chat
      const result = await hf.textGeneration({
        model: model,
        inputs: lastMessage,
        parameters: {
          max_new_tokens: 1024,
          return_full_text: false
        }
      });
      
      const content = typeof result === 'string' ? result : result.generated_text || '';
      
      return [{
        json: {
          text: content,
          model: model,
          provider: 'huggingface'
        }
      }];
    } else {
      // Call OpenAI API
      const requestBody = {
        model: model,
        messages: messages
      };

      if (functions && functions.length > 0) {
        requestBody.tools = functions;
        requestBody.tool_choice = 'auto';
      }

      response = await axios.post(
        apiUrl,
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      const message = response.data.choices[0]?.message;
      const content = message?.content || '';

      // Handle tool calls if any
      if (message?.tool_calls && message.tool_calls.length > 0) {
        // For now, return the tool call information
        // In a full implementation, we'd execute the tools and continue the conversation
        return [{
          json: {
            text: content,
            tool_calls: message.tool_calls,
            model: model,
            usage: response.data.usage
          }
        }];
      }

      return [{
        json: {
          text: content,
          model: model,
          usage: response.data.usage
        }
      }];
    }
  } catch (error) {
    if (error.response) {
      throw new Error(`OpenAI API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

function getConnectedLanguageModel(node, executionContext) {
  return getConnectedNodeByType(node, executionContext, 'ai_languageModel');
}

function getConnectedMemory(node, executionContext) {
  return getConnectedNodeByType(node, executionContext, 'ai_memory');
}

function getConnectedTools(node, executionContext) {
  return getConnectedNodesByType(node, executionContext, 'ai_tool');
}

function getConnectedNodeByType(targetNode, executionContext, connectionType) {
  const { workflow } = executionContext;
  const { connections } = workflow;

  if (!connections) return null;

  for (const [nodeName, nodeConnections] of Object.entries(connections)) {
    if (nodeConnections[connectionType]) {
      for (const outputArray of nodeConnections[connectionType]) {
        for (const connection of outputArray) {
          if (connection.node === targetNode.name || connection.node === targetNode.id) {
            const sourceNode = workflow.nodes.find(n => n.name === nodeName || n.id === nodeName);
            if (sourceNode) {
              const output = executionContext.nodes[nodeName];
              if (output && output.length > 0) {
                return output[0];
              }
            }
          }
        }
      }
    }
  }

  return null;
}

function getConnectedNodesByType(targetNode, executionContext, connectionType) {
  const { workflow } = executionContext;
  const { connections } = workflow;
  const results = [];

  if (!connections) return results;

  for (const [nodeName, nodeConnections] of Object.entries(connections)) {
    if (nodeConnections[connectionType]) {
      for (const outputArray of nodeConnections[connectionType]) {
        for (const connection of outputArray) {
          if (connection.node === targetNode.name || connection.node === targetNode.id) {
            const sourceNode = workflow.nodes.find(n => n.name === nodeName || n.id === nodeName);
            if (sourceNode) {
              const output = executionContext.nodes[nodeName];
              if (output && output.length > 0) {
                results.push(...output);
              }
            }
          }
        }
      }
    }
  }

  return results;
}

module.exports = {
  execute
};

