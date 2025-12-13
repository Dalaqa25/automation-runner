const { evaluateExpression } = require('../utils/expressions');

/**
 * If Node Executor
 * Conditional routing based on conditions
 */
async function execute(node, inputData, executionContext) {
  const params = node.parameters || {};
  const conditions = params.conditions || {};

  if (!conditions.conditions || conditions.conditions.length === 0) {
    // No conditions, pass through
    return inputData || [];
  }

  // Evaluate conditions
  const results = conditions.conditions.map(condition => {
    const leftValue = evaluateExpression(condition.leftValue || '', {
      currentInput: inputData,
      executionContext
    });
    const rightValue = evaluateExpression(condition.rightValue || '', {
      currentInput: inputData,
      executionContext
    });
    const operator = condition.operator?.operation || 'equals';

    return evaluateCondition(leftValue, rightValue, operator);
  });

  // Combine results based on combinator
  const combinator = conditions.combinator || 'and';
  let conditionMet = false;

  if (combinator === 'and') {
    conditionMet = results.every(r => r === true);
  } else if (combinator === 'or') {
    conditionMet = results.some(r => r === true);
  }

  // Return input data if condition is met (for true output)
  // Empty array if condition not met (for false output)
  // The runner will route based on this
  return conditionMet ? (inputData || []) : [];
}

function evaluateCondition(left, right, operator) {
  switch (operator) {
    case 'equals':
    case 'filter.operator.equals':
      return String(left) === String(right);
    case 'notEquals':
      return String(left) !== String(right);
    case 'contains':
      return String(left).includes(String(right));
    case 'notContains':
      return !String(left).includes(String(right));
    case 'greaterThan':
      return Number(left) > Number(right);
    case 'lessThan':
      return Number(left) < Number(right);
    case 'greaterEqual':
      return Number(left) >= Number(right);
    case 'lessEqual':
      return Number(left) <= Number(right);
    default:
      return String(left) === String(right);
  }
}

module.exports = {
  execute
};

