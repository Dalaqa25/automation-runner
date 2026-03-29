const { evaluateExpression } = require('../utils/expressions');

/**
 * Respond to Webhook Node Executor
 * In n8n, this sends a response back to the webhook caller.
 * In our runner, the workflow is executed internally (not via HTTP),
 * so this node simply passes through the data as a no-op terminal node.
 */
async function execute(node, inputData, executionContext) {
  const params = node.parameters || {};

  // Evaluate response body if present (for logging purposes)
  let responseBody = null;
  if (params.responseBody) {
    responseBody = evaluateExpression(params.responseBody, {
      currentInput: inputData,
      executionContext
    });
  }

  console.log(`[RespondToWebhook] Node '${node.name}' reached (terminal node).`);
  if (responseBody) {
    console.log(`[RespondToWebhook] Response body available (type: ${typeof responseBody})`);
  }

  // Return the input data as-is (passthrough)
  return inputData.length > 0 ? inputData : [{ json: { responded: true } }];
}

module.exports = {
  execute
};
