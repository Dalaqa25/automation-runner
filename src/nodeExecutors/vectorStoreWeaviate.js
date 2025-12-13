const axios = require('axios');
const { evaluateExpression } = require('../utils/expressions');

/**
 * Weaviate Vector Store Node Executor
 * Handles Weaviate vector store operations (insert and query)
 */
async function execute(node, inputData, executionContext) {
  const nodeType = node.type;

  if (nodeType === '@n8n/n8n-nodes-langchain.vectorStoreWeaviate') {
    return await executeWeaviateVectorStore(node, inputData, executionContext);
  }

  throw new Error(`Unsupported vector store node type: ${nodeType}`);
}

async function executeWeaviateVectorStore(node, inputData, executionContext) {
  const params = node.parameters || {};
  const mode = params.mode || 'query'; // 'insert' or 'query'
  const indexName = params.indexName || params.className || 'Document';

  // Get API key and URL from tokens or environment
  const apiKey = executionContext.tokens?.weaviateApiKey ||
                 executionContext.tokenInjector?.getToken('weaviateApiKey') ||
                 process.env.WEAVIATE_API_KEY;

  const weaviateUrl = executionContext.tokens?.weaviateUrl ||
                      executionContext.tokenInjector?.getToken('weaviateUrl') ||
                      process.env.WEAVIATE_URL ||
                      'http://localhost:8080';

  if (!apiKey && weaviateUrl.includes('cloud.weaviate.io')) {
    throw new Error('WEAVIATE_API_KEY not provided. Set it in tokens.weaviateApiKey or WEAVIATE_API_KEY environment variable');
  }

  try {
    if (mode === 'insert') {
      return await executeInsert(weaviateUrl, apiKey, indexName, inputData, executionContext, node);
    } else {
      return await executeQuery(weaviateUrl, apiKey, indexName, inputData, executionContext, node);
    }
  } catch (error) {
    throw new Error(`Weaviate error: ${error.message}`);
  }
}

async function executeInsert(weaviateUrl, apiKey, className, inputData, executionContext, node) {
  // Get text chunks and embeddings from connected nodes
  const textChunks = getTextChunksFromContext(executionContext, node);
  
  // Get embeddings from embeddings node (connected via ai_embedding)
  const embeddings = getEmbeddingsFromContext(executionContext, node);

  // If we have text chunks in main input, use those
  if (textChunks.length === 0) {
    for (const item of inputData || []) {
      const text = item.json?.text;
      if (text) {
        textChunks.push(text);
      }
    }
  }

  if (textChunks.length === 0 && embeddings.length === 0) {
    return [];
  }

  // Match text chunks with embeddings
  const objects = [];
  for (let i = 0; i < Math.max(textChunks.length, embeddings.length); i++) {
    const text = textChunks[i] || '';
    const embedding = embeddings[i]?.json?.embedding || embeddings[i]?.embedding || [];

    if (embedding.length > 0) {
      objects.push({
        class: className,
        properties: {
          text: text
        },
        vector: embedding
      });
    }
  }

  if (objects.length === 0) {
    return [];
  }

  // Prepare headers
  const headers = {
    'Content-Type': 'application/json'
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  // Batch insert objects to Weaviate
  const response = await axios.post(
    `${weaviateUrl}/v1/batch/objects`,
    { objects },
    { headers }
  );

  return [{
    json: {
      inserted: objects.length,
      message: `Successfully inserted ${objects.length} objects`,
      results: response.data
    }
  }];
}

async function executeQuery(weaviateUrl, apiKey, className, inputData, executionContext, node) {
  // Get query embedding from connected embeddings node
  const embeddings = getEmbeddingsFromContext(executionContext, node);
  
  if (embeddings.length === 0) {
    // Return empty results instead of throwing - allows execution to continue
    return [{
      json: {
        results: [],
        message: 'No embeddings found for query. Connect an embeddings node.',
        score: 0
      }
    }];
  }

  // Use the first embedding as the query vector
  const queryEmbedding = embeddings[0]?.json?.embedding || embeddings[0]?.embedding || [];

  if (queryEmbedding.length === 0) {
    // Return empty results instead of throwing
    return [{
      json: {
        results: [],
        message: 'Query embedding is empty',
        score: 0
      }
    }];
  }

  const limit = 5; // Default limit

  // Prepare headers
  const headers = {
    'Content-Type': 'application/json'
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  // Query Weaviate using GraphQL
  const query = {
    query: `
      {
        Get {
          ${className}(
            nearVector: {
              vector: ${JSON.stringify(queryEmbedding)}
            }
            limit: ${limit}
          ) {
            text
            _additional {
              id
              distance
            }
          }
        }
      }
    `
  };

  const response = await axios.post(
    `${weaviateUrl}/v1/graphql`,
    query,
    { headers }
  );

  // Format results
  const results = [];
  const data = response.data?.data?.Get?.[className] || [];
  
  for (const item of data) {
    results.push({
      json: {
        text: item.text || '',
        score: item._additional?.distance ? 1 - item._additional.distance : 0, // Convert distance to similarity score
        id: item._additional?.id,
        metadata: item
      }
    });
  }

  return results;
}

function getTextChunksFromContext(executionContext, targetNode) {
  const { workflow } = executionContext;
  const { connections } = workflow;
  const textChunks = [];

  if (!connections) return textChunks;

  // Find textSplitter node connected via ai_textSplitter
  for (const [nodeName, nodeConnections] of Object.entries(connections)) {
    if (nodeConnections.ai_textSplitter) {
      for (const outputArray of nodeConnections.ai_textSplitter) {
        for (const connection of outputArray) {
          if (connection.node === targetNode.name || connection.node === targetNode.id) {
            const sourceOutput = executionContext.nodes[nodeName];
            if (sourceOutput && Array.isArray(sourceOutput)) {
              for (const item of sourceOutput) {
                const text = item.json?.text;
                if (text) {
                  textChunks.push(text);
                }
              }
            }
          }
        }
      }
    }
  }

  return textChunks;
}

function getEmbeddingsFromContext(executionContext, targetNode) {
  const { workflow } = executionContext;
  const { connections } = workflow;
  const embeddings = [];

  if (!connections) return embeddings;

  // Find embeddings node connected via ai_embedding
  for (const [nodeName, nodeConnections] of Object.entries(connections)) {
    if (nodeConnections.ai_embedding) {
      for (const outputArray of nodeConnections.ai_embedding) {
        for (const connection of outputArray) {
          if (connection.node === targetNode.name || connection.node === targetNode.id) {
            const sourceOutput = executionContext.nodes[nodeName];
            if (sourceOutput && Array.isArray(sourceOutput)) {
              for (const item of sourceOutput) {
                if (item.json?.embedding) {
                  embeddings.push(item);
                }
              }
            }
          }
        }
      }
    }
  }

  // Fallback: look through all node outputs for embeddings
  if (embeddings.length === 0) {
    for (const [nodeName, output] of Object.entries(executionContext.nodes || {})) {
      if (Array.isArray(output)) {
        for (const item of output) {
          if (item.json?.embedding) {
            embeddings.push(item);
          }
        }
      }
    }
  }

  return embeddings;
}

module.exports = {
  execute
};

