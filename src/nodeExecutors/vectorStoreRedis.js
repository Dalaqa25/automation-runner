const redis = require('redis');
const { evaluateExpression } = require('../utils/expressions');

/**
 * Redis Vector Store Node Executor
 * Handles Redis vector store operations (insert and query)
 */
async function execute(node, inputData, executionContext) {
  const nodeType = node.type;

  if (nodeType === '@n8n/n8n-nodes-langchain.vectorStoreRedis') {
    return await executeRedisVectorStore(node, inputData, executionContext);
  }

  throw new Error(`Unsupported vector store node type: ${nodeType}`);
}

async function executeRedisVectorStore(node, inputData, executionContext) {
  const params = node.parameters || {};
  const mode = params.mode || 'query'; // 'insert' or 'query'
  const indexName = params.indexName || 'vector_index';

  // Get Redis connection details from tokens or environment
  const host = executionContext.tokens?.redisHost ||
               executionContext.tokenInjector?.getToken('redisHost') ||
               process.env.REDIS_HOST ||
               'localhost';
  
  const port = executionContext.tokens?.redisPort ||
               executionContext.tokenInjector?.getToken('redisPort') ||
               process.env.REDIS_PORT ||
               6379;

  const password = executionContext.tokens?.redisPassword ||
                   executionContext.tokenInjector?.getToken('redisPassword') ||
                   process.env.REDIS_PASSWORD ||
                   null;

  try {
    // Initialize Redis client
    const client = redis.createClient({
      socket: {
        host: host,
        port: port
      },
      password: password
    });

    await client.connect();

    if (mode === 'insert') {
      return await executeInsert(client, indexName, inputData, executionContext, node);
    } else {
      return await executeQuery(client, indexName, inputData, executionContext, node);
    }
  } catch (error) {
    throw new Error(`Redis error: ${error.message}`);
  }
}

async function executeInsert(client, indexName, inputData, executionContext, node) {
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

  // Match text chunks with embeddings and insert into Redis
  let inserted = 0;
  for (let i = 0; i < Math.max(textChunks.length, embeddings.length); i++) {
    const text = textChunks[i] || '';
    const embedding = embeddings[i]?.json?.embedding || embeddings[i]?.embedding || [];

    if (embedding.length > 0) {
      const key = `${indexName}:${Date.now()}_${i}`;
      await client.hSet(key, {
        text: text,
        embedding: JSON.stringify(embedding)
      });
      inserted++;
    }
  }

  await client.quit();

  return [{
    json: {
      inserted: inserted,
      message: `Successfully inserted ${inserted} objects`
    }
  }];
}

async function executeQuery(client, indexName, inputData, executionContext, node) {
  // Get query embedding from connected embeddings node
  const embeddings = getEmbeddingsFromContext(executionContext, node);
  
  if (embeddings.length === 0) {
    await client.quit();
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
    await client.quit();
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

  // Simple vector similarity search (Redis doesn't have built-in vector search in basic version)
  // For production, you'd use Redis with RediSearch module
  // For now, we'll return empty results as Redis vector search requires RediSearch
  await client.quit();

  return [{
    json: {
      results: [],
      message: 'Redis vector search requires RediSearch module. Returning empty results.',
      score: 0
    }
  }];
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

