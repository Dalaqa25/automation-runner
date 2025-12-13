const { evaluateExpression } = require('../utils/expressions');

/**
 * Set Node Executor
 * Mimics n8n "Set" node: assigns fields on each input item.
 * - Respects includeOtherFields: when true, keep existing fields; otherwise start fresh.
 * - Supports expressions in assignment values.
 * - Coerces values by the configured type when provided.
 */
async function execute(node, inputData = [], executionContext) {
  const params = node.parameters || {};
  const includeOtherFields = params.includeOtherFields !== false;
  const assignments = params.assignments?.assignments || [];

  // If no input, produce a single empty item (n8n behavior)
  const items = (inputData && inputData.length > 0) ? inputData : [{ json: {} }];

  return items.map((item) => {
    const baseJson = includeOtherFields
      ? { ...(item.json || item) }
      : {};

    const exprContext = {
      currentInput: [item],
      executionContext,
    };

    for (const assignment of assignments) {
      if (!assignment || !assignment.name) continue;

      const rawValue = assignment.value;
      const evaluated = evaluateExpression(rawValue, exprContext);
      const typedValue = coerceValue(evaluated, assignment.type);

      baseJson[assignment.name] = typedValue;
    }

    return { json: baseJson };
  });
}

function coerceValue(value, type) {
  switch (type) {
    case 'number': {
      const num = Number(value);
      return Number.isNaN(num) ? value : num;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        const lower = value.toLowerCase();
        if (lower === 'true') return true;
        if (lower === 'false') return false;
      }
      return Boolean(value);
    case 'string':
      return value !== undefined && value !== null ? String(value) : '';
    default:
      return value;
  }
}

module.exports = { execute };
