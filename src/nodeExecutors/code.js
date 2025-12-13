const { VM } = require('vm2');
const { evaluateExpression } = require('../utils/expressions');

/**
 * Code Node Executor
 * Executes JavaScript code with access to previous node outputs
 */
async function execute(node, inputData, executionContext) {
  const params = node.parameters || {};
  const jsCode = params.jsCode || '';

  if (!jsCode) {
    return [{ json: {} }];
  }

  // Create VM context with access to input data and previous nodes
  const vm = new VM({
    timeout: 10000,
    sandbox: {
      // $input - access to input data
      $input: {
        first: () => inputData && inputData.length > 0 ? inputData[0] : null,
        all: () => inputData || [],
        item: inputData && inputData.length > 0 ? inputData[0] : null
      },
      // $json - shortcut to first input's json
      $json: inputData && inputData.length > 0 ? (inputData[0].json || inputData[0]) : {},
      // $() - function to get previous node output by name
      $: (nodeName) => {
        const nodeOutput = executionContext.nodes[nodeName];
        if (nodeOutput && nodeOutput.length > 0) {
          return {
            item: nodeOutput[0],
            first: () => nodeOutput[0],
            all: () => nodeOutput
          };
        }
        return null;
      },
      // Helper functions
      console: {
        log: (...args) => console.log('[Code Node]', ...args),
        error: (...args) => console.error('[Code Node]', ...args)
      }
    }
  });

  try {
    // Always wrap code in a function to allow return statements
    // This is how n8n code nodes work - they're essentially function bodies
    const wrappedCode = `(function() { ${jsCode} })()`;

    // Execute the code
    const result = vm.run(wrappedCode);

    // Handle different return types
    if (Array.isArray(result)) {
      // Array of items
      return result.map(item => {
        if (item && typeof item === 'object' && 'json' in item) {
          return item;
        }
        return { json: item };
      });
    } else if (result && typeof result === 'object') {
      // Single object
      if ('json' in result) {
        return [result];
      }
      return [{ json: result }];
    } else if (result !== undefined) {
      // Primitive value
      return [{ json: { value: result } }];
    } else {
      // No return value, return empty
      return [{ json: {} }];
    }
  } catch (error) {
    throw new Error(`Code execution error: ${error.message}`);
  }
}

module.exports = {
  execute
};

