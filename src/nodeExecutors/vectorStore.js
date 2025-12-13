const { Pinecone } = require('@pinecone-database/pinecone');
const { evaluateExpression } = require('../utils/expressions');

/**
 * Vector Store Node Executor
 * Handles Pinecone vector store operations (insert and query)
 */
async function execute(node, inputData, executionContext) {
  const nodeType = node.type;

  if (nodeType === '@n8n/n8n-nodes-langchain.vectorStorePinecone') {
    return await executePineconeVectorStore(node, inputData, executionContext);
  }

  throw new Error(`Unsupported vector store node type: ${nodeType}`);
}

async function executePineconeVectorStore(node, inputData, executionContext) {
  const params = node.parameters || {};
  const mode = params.mode || 'query'; // 'insert' or 'query'
  
  // Handle n8n parameter format - can be direct value or object with __rl structure
  let indexName = params.indexName || params.pineconeIndex;
  if (indexName && typeof indexName === 'object') {
    // Handle n8n's __rl format: {__rl: true, value: "...", mode: "list"}
    indexName = indexName.value || indexName;
  }
  
  // Evaluate expression if needed
  if (indexName && (typeof indexName === 'string' && (indexName.includes('{{') || indexName.includes('$')))) {
    indexName = evaluateExpression(indexName, { executionContext, inputData });
  }

  if (!indexName) {
    throw new Error('indexName is required for Pinecone vector store');
  }

  // Get API key from tokens or environment
  const apiKey = executionContext.tokens?.pineconeApiKey ||
                 executionContext.tokenInjector?.getToken('pineconeApiKey') ||
                 process.env.PINECONE_API_KEY;

  if (!apiKey) {
    throw new Error('PINECONE_API_KEY not provided. Set it in tokens.pineconeApiKey or PINECONE_API_KEY environment variable');
  }

  // Get environment (optional, defaults to us-east-1)
  const environment = executionContext.tokens?.pineconeEnvironment ||
                     process.env.PINECONE_ENVIRONMENT ||
                     'us-east-1';

  try {
    // Initialize Pinecone client
    const pinecone = new Pinecone({
      apiKey: apiKey
    });

    const index = pinecone.index(indexName);

    if (mode === 'insert') {
      return await executeInsert(index, inputData, executionContext, node);
    } else {
      return await executeQuery(index, inputData, executionContext, node);
    }
  } catch (error) {
    throw new Error(`Pinecone error: ${error.message}`);
  }
}

async function executeInsert(index, inputData, executionContext) {
  // Get text chunks from textSplitter (connected via ai_textSplitter)
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
  const vectors = [];
  for (let i = 0; i < Math.max(textChunks.length, embeddings.length); i++) {
    const text = textChunks[i] || '';
    const embedding = embeddings[i]?.json?.embedding || embeddings[i]?.embedding || [];

    if (embedding.length > 0) {
      vectors.push({
        id: `doc_${Date.now()}_${i}`,
        values: embedding,
        metadata: {
          text: text
        }
      });
    }
  }

  if (vectors.length === 0) {
    return [];
  }

  // Upsert vectors to Pinecone
  await index.upsert(vectors);

  return [{
    json: {
      inserted: vectors.length,
      message: `Successfully inserted ${vectors.length} vectors`
    }
  }];
}

async function executeQuery(index, inputData, executionContext, node) {
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

  const topK = 5; // Default top K results

  // Query Pinecone
  const queryResponse = await index.query({
    vector: queryEmbedding,
    topK: topK,
    includeMetadata: true
  });

  // Format results
  const results = [];
  for (const match of queryResponse.matches || []) {
    results.push({
      json: {
        text: match.metadata?.text || '',
        score: match.score,
        id: match.id,
        metadata: match.metadata
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

