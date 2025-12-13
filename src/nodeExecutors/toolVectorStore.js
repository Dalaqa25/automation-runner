/**
 * Vector Store Tool Node Executor
 * Wraps a vector store as a tool for agents
 */
async function execute(node, inputData, executionContext) {
  const nodeType = node.type;

  if (nodeType === '@n8n/n8n-nodes-langchain.toolVectorStore') {
    return await executeVectorStoreTool(node, inputData, executionContext);
  }

  throw new Error(`Unsupported tool node type: ${nodeType}`);
}

async function executeVectorStoreTool(node, inputData, executionContext) {
  const params = node.parameters || {};
  const toolName = params.name || 'VectorStore';

  // Get the vector store results from connected node
  // The vector store query results should be in the input
  const vectorStoreResults = [];
  for (const item of inputData || []) {
    if (item.json?.text || item.json?.score) {
      vectorStoreResults.push(item.json);
    }
  }

  // Return tool configuration
  // The actual tool execution happens in the agent
  return [{
    json: {
      toolName: toolName,
      type: 'vectorStore',
      results: vectorStoreResults,
      description: `Vector store tool: ${toolName}`
    }
  }];
}

module.exports = {
  execute
};

