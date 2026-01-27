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

  // If no input data, skip execution (workflow was stopped upstream)
  if (!inputData || inputData.length === 0) {
    console.log(`[Agent] No input data - skipping agent execution for node '${node.name}'`);
    return [];
  }

  // Check if input data has valid items
  const hasValidData = inputData.some(item => {
    return item && typeof item === 'object' && item.json && Object.keys(item.json).length > 0;
  });

  if (!hasValidData) {
    console.log(`[Agent] Input data is empty or invalid - skipping agent execution for node '${node.name}'`);
    return [];
  }

  // Get connected components
  const languageModel = getConnectedLanguageModel(node, executionContext);
  const memory = getConnectedMemory(node, executionContext);
  const tools = getConnectedTools(node, executionContext);

  // If no language model connected, use built-in Groq (like InformationExtractor)
  // Check if we have Groq API key available
  const groqApiKey = executionContext.tokens?.groqApiKey ||
    executionContext.tokenInjector?.getToken('groqApiKey') ||
    process.env.GROQ_API_KEY;

  if (!languageModel && !groqApiKey) {
    console.log(`[Agent] No language model connected and no GROQ_API_KEY - skipping agent execution for node '${node.name}'`);
    return inputData; // Pass through input data
  }

  // Use built-in Groq if no LM node connected
  const useBuiltInGroq = !languageModel && groqApiKey;
  if (useBuiltInGroq) {
    console.log(`[Agent] Using built-in Groq (no language model node connected)`);
  }

  // Check if we have tools that need per-item processing (like Gmail)
  // Debug: log what tools we have
  console.log(`[Agent] Tools connected: ${tools?.length || 0}`);
  if (tools && tools.length > 0) {
    tools.forEach((t, i) => {
      console.log(`[Agent] Tool ${i}: nodeName=${t.nodeName}, type=${t.node?.type}`);
    });
  }

  const hasGmailTool = tools && tools.length > 0 && tools.some(t =>
    t.node?.type?.includes('gmail') ||
    t.node?.type?.includes('Gmail') ||
    t.nodeName?.toLowerCase()?.includes('email')
  );

  console.log(`[Agent] Has Gmail tool: ${hasGmailTool}, Input items: ${inputData.length}`);

  // If we have Gmail tool and multiple items, process each item separately
  if (hasGmailTool && inputData.length > 1) {
    console.log(`[Agent] Processing ${inputData.length} items separately for email sending`);
    const allResults = [];

    for (let i = 0; i < inputData.length; i++) {
      const singleItem = [inputData[i]];
      console.log(`[Agent] Processing item ${i + 1}/${inputData.length}`);

      const result = await processAgentItem(node, singleItem, executionContext, params, languageModel, memory, tools, useBuiltInGroq, groqApiKey);
      if (result && result.length > 0) {
        allResults.push(...result);
      }
    }

    return allResults;
  }

  // Single item or no Gmail tool - process normally
  return await processAgentItem(node, inputData, executionContext, params, languageModel, memory, tools, useBuiltInGroq, groqApiKey);
}

async function processAgentItem(node, inputData, executionContext, params, languageModel, memory, tools, useBuiltInGroq, groqApiKey) {

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

  // Get model configuration - default to Groq
  const model = languageModel?.json?.model || 'llama-3.3-70b-versatile';
  const provider = useBuiltInGroq ? 'groq' : (languageModel?.json?.provider || 'groq');

  // Support Groq, OpenAI, Anthropic, and HuggingFace
  let apiKey;
  let apiUrl;

  if (provider === 'groq') {
    apiKey = executionContext.tokens?.groqApiKey ||
      executionContext.tokenInjector?.getToken('groqApiKey') ||
      process.env.GROQ_API_KEY;
    apiUrl = 'https://api.groq.com/openai/v1/chat/completions';

    if (!apiKey) {
      throw new Error('GROQ_API_KEY not provided');
    }
  } else if (provider === 'anthropic') {
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

  // Get system message from node parameters
  let systemMessage = '';
  if (params.options?.systemMessage) {
    systemMessage = evaluateExpression(params.options.systemMessage, {
      currentInput: inputData,
      executionContext
    });
  }

  // If tools are available, add instruction to use them
  if (tools && tools.length > 0) {
    const hasGmailTool = tools.some(t =>
      t.node?.type?.includes('gmail') || t.node?.type?.includes('Gmail')
    );

    if (hasGmailTool) {
      const toolInstruction = '\n\nIMPORTANT: You MUST use the send_email tool to send the email. Call the send_email function with action: "send".';
      systemMessage = systemMessage + toolInstruction;
    }
  }

  // Build messages for OpenAI API
  const messages = [];

  // Add system message if present
  if (systemMessage) {
    messages.push({
      role: 'system',
      content: systemMessage
    });
  }

  // Add conversation history and user prompt
  messages.push(
    ...conversationHistory,
    {
      role: 'user',
      content: prompt
    }
  );

  // If tools are available, use function calling
  let functions = null;
  let toolNodeMap = {}; // Map tool function names to actual executor nodes
  if (tools && tools.length > 0) {
    // Build function definitions based on tool type
    functions = tools.map(tool => {
      const toolName = tool.json?.toolName || tool.node?.name || 'send_email';
      const toolType = tool.node?.type || '';

      // Store reference to tool node for execution
      toolNodeMap[toolName] = tool;

      // For Gmail tool, define email-specific parameters
      if (toolType.includes('gmail') || toolType.includes('Gmail')) {
        return {
          type: 'function',
          function: {
            name: 'send_email',
            description: 'Send an email via Gmail to the billing team with invoice details',
            parameters: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  description: 'The action to perform - should be "send"'
                }
              },
              required: ['action']
            }
          }
        };
      }

      // Default: vector store tool or other
      return {
        type: 'function',
        function: {
          name: toolName,
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
      };
    });
  }

  try {
    let response;

    if (provider === 'groq') {
      // Call Groq API (OpenAI-compatible)
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

      // Handle tool calls if any - ACTUALLY EXECUTE THE TOOLS
      if (message?.tool_calls && message.tool_calls.length > 0) {
        console.log(`[Agent] LLM requested ${message.tool_calls.length} tool call(s)`);

        const toolResults = [];
        for (const toolCall of message.tool_calls) {
          const functionName = toolCall.function?.name;
          const functionArgs = JSON.parse(toolCall.function?.arguments || '{}');

          console.log(`[Agent] Executing tool: ${functionName} with args:`, functionArgs);

          // Find and execute the corresponding tool
          const toolResult = await executeToolCall(
            functionName,
            functionArgs,
            tools,
            inputData,
            executionContext
          );

          if (toolResult) {
            toolResults.push(...toolResult);
          }
        }

        // Return tool execution results if any, otherwise return agent response
        if (toolResults.length > 0) {
          return toolResults;
        }

        return [{
          json: {
            text: content,
            tool_calls: message.tool_calls,
            toolsExecuted: true,
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
    } else if (provider === 'anthropic') {
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

      // Handle tool calls if any - ACTUALLY EXECUTE THE TOOLS
      if (message?.tool_calls && message.tool_calls.length > 0) {
        console.log(`[Agent] LLM (OpenAI) requested ${message.tool_calls.length} tool call(s)`);

        const toolResults = [];
        for (const toolCall of message.tool_calls) {
          const functionName = toolCall.function?.name;
          const functionArgs = JSON.parse(toolCall.function?.arguments || '{}');

          console.log(`[Agent] Executing tool: ${functionName} with args:`, functionArgs);

          // Find and execute the corresponding tool
          const toolResult = await executeToolCall(
            functionName,
            functionArgs,
            tools,
            inputData,
            executionContext
          );

          if (toolResult) {
            toolResults.push(...toolResult);
          }
        }

        // Return tool execution results if any, otherwise return agent response
        if (toolResults.length > 0) {
          return toolResults;
        }

        return [{
          json: {
            text: content,
            tool_calls: message.tool_calls,
            toolsExecuted: true,
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
              // Include both the output (if any) and the node reference for tool execution
              results.push({
                json: output && output.length > 0 ? output[0].json : {},
                node: sourceNode,
                nodeName: nodeName
              });
            }
          }
        }
      }
    }
  }

  return results;
}

/**
 * Execute a tool call requested by the LLM
 * @param {string} functionName - Name of the function to call
 * @param {Object} functionArgs - Arguments passed by the LLM
 * @param {Array} tools - Connected tool nodes
 * @param {Array} inputData - Input data from upstream nodes
 * @param {Object} executionContext - Workflow execution context
 */
async function executeToolCall(functionName, functionArgs, tools, inputData, executionContext) {
  console.log(`[Agent] Looking for tool to execute: ${functionName}`);

  // Find the matching tool node
  for (const tool of tools) {
    const toolNode = tool.node;
    if (!toolNode) {
      console.log(`[Agent] Tool has no node reference, skipping`);
      continue;
    }

    const toolType = toolNode.type || '';
    const toolName = toolNode.name || '';

    console.log(`[Agent] Checking tool: ${toolName} (type: ${toolType})`);

    // Match by function name or tool type
    const isEmailTool = functionName === 'send_email' || functionName === 'sendEmail';
    const isGmailNode = toolType.includes('gmail') || toolType.includes('Gmail');

    if (isEmailTool && isGmailNode) {
      console.log(`[Agent] Found Gmail tool, executing...`);

      // Import the Gmail tool executor
      const gmailTool = require('../invoice-system-manager/gmailTool');

      // Execute the Gmail tool with the current input data
      // The Gmail tool will read invoice data from executionContext.nodes
      const result = await gmailTool.execute(toolNode, inputData, executionContext);

      console.log(`[Agent] Gmail tool execution completed, result:`, result?.length || 0, 'items');
      return result;
    }

    // For other tools (e.g., vector store), try to find matching executor
    if (functionName === tool.json?.toolName) {
      console.log(`[Agent] Found matching tool by name: ${functionName}`);
      // TODO: Implement generic tool execution if needed
    }
  }

  console.log(`[Agent] No matching tool found for: ${functionName}`);
  return null;
}

module.exports = {
  execute
};

