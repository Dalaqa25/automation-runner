/**
 * Expression evaluator for dynamic values
 * Supports:
 * - {{ $json.field }} - current node's output
 * - {{ $('NodeName').item.json.field }} - reference previous node
 * - {{ $input.first().json.field }} - access input data
 */

function evaluateExpression(expression, context) {
  if (typeof expression !== 'string') {
    return expression;
  }

  // Check if it's an expression (starts with = or contains {{ }})
  const isExpression = expression.trim().startsWith('=') || 
                       (expression.includes('{{') && expression.includes('}}'));
  
  if (!isExpression) {
    return expression;
  }

  // Remove leading = if present (n8n style: ={{ ... }})
  let processedExpression = expression.trim();
  if (processedExpression.startsWith('=')) {
    processedExpression = processedExpression.substring(1).trim();
  }

  // Extract all expressions
  const regex = /\{\{([^}]+)\}\}/g;
  const matches = [];
  let match;
  
  // Collect all matches first (need to reset regex)
  const regex2 = /\{\{([^}]+)\}\}/g;
  while ((match = regex2.exec(processedExpression)) !== null) {
    matches.push(match);
  }
  
  // If there's only one expression and it's the entire string, return the value directly
  // This handles cases like ={{$json.snippet}} where we want the object, not a string
  if (matches.length === 1) {
    const singleMatch = matches[0];
    const expr = singleMatch[1].trim();
    const value = evaluateExpressionValue(expr, context);
    
    // If the entire expression is just this one expression (no other text), return the value directly
    // Check if processedExpression (after trimming) equals the match (the {{...}} part)
    const processedTrimmed = processedExpression.trim();
    const matchTrimmed = singleMatch[0].trim();
    const expressionOnly = processedTrimmed === matchTrimmed;
    
    // Return the value directly if it's an object/array and this is a pure expression
    if (expressionOnly) {
      if ((typeof value === 'object' && value !== null) || Array.isArray(value)) {
        return value;
      }
      // For primitives, also return directly (no string interpolation needed)
      return value;
    }
  }
  
  // Otherwise, do string interpolation
  let result = processedExpression;
  for (const match of matches) {
    const expr = match[1].trim();
    const value = evaluateExpressionValue(expr, context);
    result = result.replace(match[0], value !== undefined ? String(value) : '');
  }

  return result;
}

function evaluateExpressionValue(expression, context) {
  const expr = expression.trim();

  // $tokens.tokenName - access injected tokens
  if (expr.startsWith('$tokens')) {
    const tokenPath = expr.replace(/^\$tokens\.?/, '');
    const tokens = context.executionContext?.tokens || {};
    return getJsonValue('$json.' + tokenPath, { json: tokens });
  }

  // $json.field - current node's output
  if (expr.startsWith('$json')) {
    // currentInput is an array, get the first item
    const inputItem = context.currentInput && context.currentInput.length > 0 
      ? context.currentInput[0] 
      : null;
    return getJsonValue(expr, inputItem);
  }

  // $('NodeName').item.json.field - reference previous node by name
  const nodeRefMatch = expr.match(/\$\(['"]([^'"]+)['"]\)/);
  if (nodeRefMatch) {
    const nodeName = nodeRefMatch[1];
    const nodeOutput = context.executionContext?.nodes[nodeName];
    if (nodeOutput && nodeOutput.length > 0) {
      const restOfExpr = expr.substring(nodeRefMatch[0].length);
      if (restOfExpr.startsWith('.item.json')) {
        const fieldPath = restOfExpr.replace('.item.json', '').replace(/^\./, '');
        return getJsonValue('$json.' + fieldPath, nodeOutput[0]);
      }
      return nodeOutput[0];
    }
    return undefined;
  }

  // $input.first().json.field - access first input item
  if (expr.startsWith('$input.first()')) {
    const restOfExpr = expr.replace('$input.first()', '');
    if (context.currentInput && context.currentInput.length > 0) {
      return getJsonValue('$json' + restOfExpr, context.currentInput[0]);
    }
    return undefined;
  }

  // $input.all() - get all input items (used in code nodes)
  if (expr === '$input.all()') {
    return context.currentInput || [];
  }

  // Simple placeholder without $ prefix - look in body first, then currentInput
  // This handles {{billing_email}}, {{folder_id}}, etc.
  if (!expr.startsWith('$')) {
    // Try to find in body (from webhook/trigger initial data)
    const bodyData = context.executionContext?.initialData?.body || 
                     context.currentInput?.[0]?.json?.body;
    if (bodyData && expr in bodyData) {
      return bodyData[expr];
    }
    
    // Try to find in current input json
    const inputItem = context.currentInput && context.currentInput.length > 0 
      ? context.currentInput[0] 
      : null;
    if (inputItem?.json && expr in inputItem.json) {
      return inputItem.json[expr];
    }
  }

  // Fallback: try to evaluate as $json
  if (expr.startsWith('$')) {
    return getJsonValue(expr, context.currentInput);
  }

  return undefined;
}

function getJsonValue(path, data) {
  if (!data || !path) return undefined;

  // Remove $json prefix if present
  path = path.replace(/^\$json\.?/, '');

  if (!path) {
    return data.json || data;
  }

  let value = data.json || data;

  // Parse path - handle both dot notation and bracket notation
  // Examples: "body.tiktok_url", '["body"]["tiktok_url"]', 'body["tiktok_url"]'
  const parts = [];
  
  // Split by brackets first, then by dots
  let current = path;
  while (current.length > 0) {
    // Check for bracket notation ["key"] or ['key']
    const bracketMatch = current.match(/^\[["']([^"']+)["']\]/);
    if (bracketMatch) {
      parts.push(bracketMatch[1]);
      current = current.substring(bracketMatch[0].length);
      continue;
    }
    
    // Check for dot notation
    const dotIndex = current.indexOf('.');
    if (dotIndex === -1) {
      // Last part
      if (current.length > 0) {
        parts.push(current);
      }
      break;
    } else {
      const part = current.substring(0, dotIndex);
      if (part.length > 0) {
        parts.push(part);
      }
      current = current.substring(dotIndex + 1);
    }
  }

  // Navigate through the path
  for (const key of parts) {
    if (value && typeof value === 'object') {
      if (key in value) {
        value = value[key];
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }
  }

  return value;
}

module.exports = {
  evaluateExpression,
  evaluateExpressionValue,
  getJsonValue
};

