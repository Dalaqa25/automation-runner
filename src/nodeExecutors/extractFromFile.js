/**
 * Extract From File Executor
 * Minimal support for n8n "Extract from File" (PDF/text):
 * - Expects file content in the first input item's json.
 * - Tries several common fields to find the content (base64 or plain text).
 * - If the content is base64 (optionally data URI), decodes to UTF-8 text.
 * - Returns { text } so downstream nodes (LLM/structured parser) can consume it.
 *
 * Note: This is a lightweight extractor; it does not perform full PDF parsing.
 * If the PDF is binary and not text-friendly, the decoded output may be noisy.
 */

function decodeBase64ToText(value) {
  if (typeof value !== 'string') return null;

  // Strip data URI prefix if present
  const dataUriMatch = value.match(/^data:.*;base64,(.*)$/i);
  const b64 = dataUriMatch ? dataUriMatch[1] : value;

  try {
    return Buffer.from(b64, 'base64').toString('utf8');
  } catch (err) {
    return null;
  }
}

async function execute(node, inputData = [], executionContext) {
  const item = inputData[0];
  if (!item || !item.json) {
    return [{ json: { error: 'No input to extract from' } }];
  }

  const source =
    item.json.fileData ||
    item.json.file ||
    item.json.cvBase64 ||
    item.json.cv ||
    item.json.data ||
    item.json.text ||
    item.text;

  if (!source) {
    return [{ json: { error: 'No file content found to extract' } }];
  }

  // If it's already text, return as-is
  if (typeof source === 'string' && !source.trim().startsWith('JVBERi0')) { // crude PDF magic number check
    // Try base64 first; if decode fails, fall back to raw string
    const decoded = decodeBase64ToText(source);
    const text = decoded || source;
    return [{ json: { text } }];
  }

  // Attempt base64 decode (common for PDF uploads)
  const decoded = decodeBase64ToText(source);
  if (decoded) {
    return [{ json: { text: decoded } }];
  }

  return [{ json: { error: 'Unable to extract text from file content' } }];
}

module.exports = { execute };
