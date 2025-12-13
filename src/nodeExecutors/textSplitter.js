const { evaluateExpression } = require('../utils/expressions');

/**
 * Text Splitter Node Executor
 * Splits text into chunks for vector embeddings
 */
async function execute(node, inputData, executionContext) {
  const params = node.parameters || {};
  const chunkSize = params.chunkSize || 1000;
  const chunkOverlap = params.chunkOverlap || 200;

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

  // Split text into chunks
  const chunks = [];
  for (const text of texts) {
    const textChunks = splitText(text, chunkSize, chunkOverlap);
    for (const chunk of textChunks) {
      chunks.push({
        json: {
          text: chunk,
          metadata: {
            chunkSize: chunk.length,
            originalLength: text.length
          }
        }
      });
    }
  }

  return chunks;
}

/**
 * Split text into chunks with overlap
 */
function splitText(text, chunkSize, chunkOverlap) {
  if (text.length <= chunkSize) {
    return [text];
  }

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.substring(start, end);
    chunks.push(chunk);
    
    // Move start position forward, accounting for overlap
    start = end - chunkOverlap;
    
    // Prevent infinite loop
    if (start >= end) {
      start = end;
    }
  }

  return chunks;
}

module.exports = {
  execute
};

