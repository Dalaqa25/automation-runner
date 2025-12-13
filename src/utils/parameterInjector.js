/**
 * Generic parameter injection utilities for workflow templates.
 *
 * Supports placeholders of the form {{PARAM_NAME}} where PARAM_NAME matches
 * the regex [A-Z0-9_]+. This is intentionally distinct from n8n-style
 * expressions like {{ $json.field }}, which contain spaces or dots and
 * should NOT be touched here.
 */

const PLACEHOLDER_REGEX = /{{\s*([A-Z0-9_]+)\s*}}/g;

/**
 * Deep-clone a plain JSON-compatible value.
 * We assume workflow templates are JSON-serializable.
 */
function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

/**
 * Recursively walk a template and inject parameters.
 *
 * - Objects and arrays are traversed recursively.
 * - String values have all {{PARAM_NAME}} occurrences replaced with
 *   values from the `params` object, if present.
 * - Non-string primitives are returned unchanged.
 *
 * @param {any} template - Workflow JSON template (object/array/value)
 * @param {Object} params - Parameter values keyed by placeholder name
 * @returns {any} New object with parameters injected
 */
function injectParameters(template, params = {}) {
  const cloned = cloneJson(template);
  return injectIntoValue(cloned, params);
}

/**
 * Internal recursive helper to inject into a single value.
 */
function injectIntoValue(value, params) {
  if (value == null) {
    return value;
  }

  if (typeof value === 'string') {
    // Only replace placeholders that match the uppercase/underscore pattern.
    return value.replace(PLACEHOLDER_REGEX, (match, name) => {
      if (!Object.prototype.hasOwnProperty.call(params, name)) {
        // Leave unresolved placeholders as-is so callers can decide
        // how to handle missing values.
        return match;
      }

      const paramValue = params[name];

      // If the entire string is just the placeholder and the paramValue
      // is not a string, we can return it as-is so numbers/booleans/objects
      // are preserved.
      if (match === value && typeof paramValue !== 'string') {
        return paramValue;
      }

      // Otherwise, coerce to string for interpolation within a larger string.
      return String(paramValue);
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => injectIntoValue(item, params));
  }

  if (typeof value === 'object') {
    const result = {};
    for (const [key, v] of Object.entries(value)) {
      result[key] = injectIntoValue(v, params);
    }
    return result;
  }

  // numbers, booleans, etc.
  return value;
}

/**
 * Recursively extract all placeholder names from a workflow template.
 *
 * @param {any} template - Workflow JSON template
 * @returns {Set<string>} Set of unique parameter names
 */
function extractParameterNames(template) {
  const found = new Set();
  walkForParameters(template, found);
  return found;
}

function walkForParameters(value, found) {
  if (value == null) {
    return;
  }

  if (typeof value === 'string') {
    let match;
    while ((match = PLACEHOLDER_REGEX.exec(value)) !== null) {
      // match[1] is the parameter name
      found.add(match[1]);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => walkForParameters(item, found));
    return;
  }

  if (typeof value === 'object') {
    Object.values(value).forEach((v) => walkForParameters(v, found));
  }
}

module.exports = {
  injectParameters,
  extractParameterNames,
};


