const axios = require('axios');
const { evaluateExpression } = require('../utils/expressions');

/**
 * Embeddings Node Executor
 * Handles Cohere embeddings generation
 */
async function execute(node, inputData, executionContext) {
  const nodeType = node.type;

  if (nodeType === '@n8n/n8n-nodes-langchain.embeddingsCohere') {
    return await executeCohereEmbeddings(node, inputData, executionContext);
  }

  if (nodeType === '@n8n/n8n-nodes-langchain.embeddingsOpenAi') {
    return await executeOpenAIEmbeddings(node, inputData, executionContext);
  }

  throw new Error(`Unsupported embeddings node type: ${nodeType}`);
}

async function executeCohereEmbeddings(node, inputData, executionContext) {
  // Get API key from tokens or environment
  const apiKey = executionContext.tokens?.cohereApiKey ||
                 executionContext.tokenInjector?.getToken('cohereApiKey') ||
                 process.env.COHERE_API_KEY;

  if (!apiKey) {
    throw new Error('COHERE_API_KEY not provided. Set it in tokens.cohereApiKey or COHERE_API_KEY environment variable');
  }

  // Extract text from input data
  const texts = [];
  for (const item of inputData || []) {
    const text = item.json?.text || item.json?.content || JSON.stringify(item.json);
    if (text) {
      texts.push(String(text));
    }
  }

  if (texts.length === 0) {
    return [];
  }

  try {
    // Call Cohere Embed API
    const response = await axios.post(
      'https://api.cohere.ai/v1/embed',
      {
        texts: texts,
        model: 'embed-english-v3.0', // Default Cohere embedding model
        input_type: 'search_document' // Can be 'search_document' or 'search_query'
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Map embeddings to output format
    const embeddings = response.data.embeddings || [];
    const results = [];

    for (let i = 0; i < texts.length; i++) {
      results.push({
        json: {
          embedding: embeddings[i] || [],
          text: texts[i],
          model: 'embed-english-v3.0'
        }
      });
    }

    return results;
  } catch (error) {
    if (error.response) {
      throw new Error(`Cohere API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

async function executeOpenAIEmbeddings(node, inputData, executionContext) {
  // Get API key from tokens or environment
  const apiKey = executionContext.tokens?.openAiApiKey ||
                 executionContext.tokenInjector?.getToken('openAiApiKey') ||
                 process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not provided. Set it in tokens.openAiApiKey or OPENAI_API_KEY environment variable');
  }

  // Extract text from input data
  const texts = [];
  for (const item of inputData || []) {
    const text = item.json?.text || item.json?.content || JSON.stringify(item.json);
    if (text) {
      texts.push(String(text));
    }
  }

  if (texts.length === 0) {
    return [];
  }

  try {
    // Call OpenAI Embeddings API
    const response = await axios.post(
      'https://api.openai.com/v1/embeddings',
      {
        input: texts,
        model: 'text-embedding-3-small' // Default OpenAI embedding model
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Map embeddings to output format
    const embeddings = response.data.data || [];
    const results = [];

    for (let i = 0; i < texts.length; i++) {
      results.push({
        json: {
          embedding: embeddings[i]?.embedding || [],
          text: texts[i],
          model: 'text-embedding-3-small'
        }
      });
    }

    return results;
  } catch (error) {
    if (error.response) {
      throw new Error(`OpenAI API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

module.exports = {
  execute
};

