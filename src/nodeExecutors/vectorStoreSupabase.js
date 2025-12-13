// Supabase package is optional - only needed if using Supabase vector store
let createClient;
try {
  const supabase = require('@supabase/supabase-js');
  createClient = supabase.createClient;
} catch (error) {
  // Supabase package not installed - will throw error when trying to use it
  createClient = null;
}

const { evaluateExpression } = require('../utils/expressions');

/**
 * Supabase Vector Store Node Executor
 * Handles Supabase vector store operations (insert and query)
 */
async function execute(node, inputData, executionContext) {
  const nodeType = node.type;

  if (nodeType === '@n8n/n8n-nodes-langchain.vectorStoreSupabase') {
    return await executeSupabaseVectorStore(node, inputData, executionContext);
  }

  throw new Error(`Unsupported vector store node type: ${nodeType}`);
}

async function executeSupabaseVectorStore(node, inputData, executionContext) {
  const params = node.parameters || {};
  const mode = params.mode || 'query'; // 'insert' or 'query'
  const indexName = params.indexName || 'documents';

  // Get Supabase connection details from tokens or environment
  const supabaseUrl = executionContext.tokens?.supabaseUrl ||
                      executionContext.tokenInjector?.getToken('supabaseUrl') ||
                      process.env.SUPABASE_URL;

  const supabaseKey = executionContext.tokens?.supabaseKey ||
                      executionContext.tokenInjector?.getToken('supabaseKey') ||
                      process.env.SUPABASE_KEY ||
                      process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!createClient) {
    // Return error output instead of throwing - allows execution to continue for structural testing
    return [{
      json: {
        error: '@supabase/supabase-js package not installed. Install it with: npm install @supabase/supabase-js'
      }
    }];
  }

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_KEY not provided. Set them in tokens or environment variables');
  }

  try {
    // Initialize Supabase client
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (mode === 'insert') {
      return await executeInsert(supabase, indexName, inputData, executionContext, node);
    } else {
      return await executeQuery(supabase, indexName, inputData, executionContext, node);
    }
  } catch (error) {
    throw new Error(`Supabase error: ${error.message}`);
  }
}

async function executeInsert(supabase, tableName, inputData, executionContext, node) {
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

  // Match text chunks with embeddings and insert into Supabase
  const records = [];
  for (let i = 0; i < Math.max(textChunks.length, embeddings.length); i++) {
    const text = textChunks[i] || '';
    const embedding = embeddings[i]?.json?.embedding || embeddings[i]?.embedding || [];

    if (embedding.length > 0) {
      records.push({
        content: text,
        embedding: embedding,
        metadata: {
          index: i,
          timestamp: new Date().toISOString()
        }
      });
    }
  }

  if (records.length === 0) {
    return [];
  }

  // Insert records into Supabase
  const { data, error } = await supabase
    .from(tableName)
    .insert(records)
    .select();

  if (error) {
    throw new Error(`Supabase insert error: ${error.message}`);
  }

  return [{
    json: {
      inserted: records.length,
      message: `Successfully inserted ${records.length} objects`,
      data: data
    }
  }];
}

async function executeQuery(supabase, tableName, inputData, executionContext, node) {
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

  try {
    // Query Supabase using vector similarity search
    // Supabase uses pgvector extension for vector similarity
    const { data, error } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.7,
      match_count: limit,
      table_name: tableName
    });

    if (error) {
      // If the RPC function doesn't exist, try a simpler approach
      // For now, return empty results as vector search requires proper setup
      return [{
        json: {
          results: [],
          message: 'Supabase vector search requires pgvector extension and match_documents function. Returning empty results.',
          score: 0
        }
      }];
    }

    // Format results
    const results = [];
    for (const item of data || []) {
      results.push({
        json: {
          text: item.content || '',
          score: item.similarity || 0,
          id: item.id,
          metadata: item.metadata
        }
      });
    }

    return results;
  } catch (error) {
    // Return empty results on error to allow execution to continue
    return [{
      json: {
        results: [],
        message: `Supabase query error: ${error.message}`,
        score: 0
      }
    }];
  }
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

