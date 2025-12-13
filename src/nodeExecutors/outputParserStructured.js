/**
 * Structured Output Parser Executor
 * Mimics n8n outputParserStructured:
 * - Takes LLM text output and attempts to parse JSON according to a schema.
 * - If parsing fails and autoFix is enabled, tries a lightweight repair.
 * - Returns parsed object on success; otherwise returns an error payload.
 */
function tryJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

function attemptRepair(text) {
  // Simple repair heuristics: trim code fences and whitespace.
  const stripped = text
    .replace(/^\s*```[a-zA-Z]*\s*/, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  return tryJsonParse(stripped);
}

async function execute(node, inputData = [], executionContext) {
  const params = node.parameters || {};
  const autoFix = !!params.autoFix;

  // Use first input item; if none, return empty.
  const item = inputData[0];
  if (!item || !item.json) {
    return [{ json: { error: 'No input to parse' } }];
  }

  // n8n typically passes the LLM text under $json.text (from previous node)
  const text = item.json.text || item.text || '';
  if (typeof text !== 'string' || !text.trim()) {
    return [{ json: { error: 'No text content to parse' } }];
  }

  let parsed = tryJsonParse(text);
  if (!parsed && autoFix) {
    parsed = attemptRepair(text);
  }

  if (!parsed) {
    return [{
      json: {
        error: 'Failed to parse structured output',
        raw: text
      }
    }];
  }

  return [{
    json: parsed
  }];
}

module.exports = { execute };
