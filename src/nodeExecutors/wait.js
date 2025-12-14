/**
 * Wait Node Executor
 * Pauses execution for a specified duration
 */
async function execute(node, inputData, executionContext) {
  const params = node.parameters || {};
  const unit = params.unit || 'seconds';
  const amount = params.amount || 1;

  // Convert to milliseconds
  let waitTime = amount;
  switch (unit) {
    case 'milliseconds':
      waitTime = amount;
      break;
    case 'seconds':
      waitTime = amount * 1000;
      break;
    case 'minutes':
      waitTime = amount * 60 * 1000;
      break;
    case 'hours':
      waitTime = amount * 60 * 60 * 1000;
      break;
    default:
      waitTime = amount * 1000; // Default to seconds
  }

  console.log(`[Wait] Pausing execution for ${amount} ${unit} (${waitTime}ms)`);

  // Wait for the specified duration
  await new Promise(resolve => setTimeout(resolve, waitTime));

  console.log(`[Wait] Resuming execution`);

  // Pass through input data unchanged
  return inputData;
}

module.exports = {
  execute
};
