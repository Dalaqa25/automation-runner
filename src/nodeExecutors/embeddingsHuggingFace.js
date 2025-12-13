const axios = require('axios');
const { evaluateExpression } = require('../utils/expressions');

/**
 * HuggingFace Embeddings Node Executor
 * Handles HuggingFace embeddings generation
 */
async function execute(node, inputData, executionContext) {
  const nodeType = node.type;

  if (nodeType === '@n8n/n8n-nodes-langchain.embeddingsHuggingFace') {
    return await executeHuggingFaceEmbeddings(node, inputData, executionContext);
  }

  throw new Error(`Unsupported embeddings node type: ${nodeType}`);
}

async function executeHuggingFaceEmbeddings(node, inputData, executionContext) {
  const params = node.parameters || {};
  const model = params.model || 'sentence-transformers/all-MiniLM-L6-v2'; // Default HuggingFace embedding model

  // Get API key from tokens or environment
  const apiKey = executionContext.tokens?.huggingFaceApiKey ||
                 executionContext.tokenInjector?.getToken('huggingFaceApiKey') ||
                 process.env.HUGGINGFACE_API_KEY;

  if (!apiKey) {
    throw new Error('HUGGINGFACE_API_KEY not provided. Set it in tokens.huggingFaceApiKey or HUGGINGFACE_API_KEY environment variable');
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
    // Call HuggingFace Inference API for embeddings
    const response = await axios.post(
      `https://api-inference.huggingface.co/pipeline/feature-extraction/${model}`,
      {
        inputs: texts,
        options: {
          wait_for_model: true
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // HuggingFace returns embeddings as array of arrays
    const embeddings = Array.isArray(response.data) ? response.data : [response.data];
    const results = [];

    for (let i = 0; i < texts.length; i++) {
      results.push({
        json: {
          embedding: embeddings[i] || [],
          text: texts[i],
          model: model
        }
      });
    }

    return results;
  } catch (error) {
    if (error.response) {
      throw new Error(`HuggingFace API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

module.exports = {
  execute
};

