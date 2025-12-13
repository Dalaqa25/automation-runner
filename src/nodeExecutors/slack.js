const axios = require('axios');
const { evaluateExpression } = require('../utils/expressions');

/**
 * Slack Node Executor
 * Handles Slack operations (sending messages to channels)
 */
async function execute(node, inputData, executionContext) {
  const nodeType = node.type;

  if (nodeType === 'n8n-nodes-base.slack') {
    return await executeSlack(node, inputData, executionContext);
  }

  throw new Error(`Unsupported Slack node type: ${nodeType}`);
}

async function executeSlack(node, inputData, executionContext) {
  const params = node.parameters || {};
  const resource = params.resource || 'message';
  const operation = params.operation || 'postMessage';
  
  // Get Slack API token from tokens or environment
  const accessToken = executionContext.tokens?.slackAccessToken ||
                      executionContext.tokenInjector?.getToken('slackAccessToken') ||
                      process.env.SLACK_ACCESS_TOKEN ||
                      process.env.SLACK_BOT_TOKEN;

  if (!accessToken) {
    throw new Error('SLACK_ACCESS_TOKEN or SLACK_BOT_TOKEN not provided. Set it in tokens.slackAccessToken or SLACK_ACCESS_TOKEN environment variable');
  }

  if (resource === 'message' && operation === 'postMessage') {
    return await executePostMessage(node, inputData, executionContext, accessToken);
  }

  // For other operations, return a placeholder
  return [{
    json: {
      success: false,
      message: `Slack operation '${operation}' for resource '${resource}' not yet implemented`,
      input: inputData
    }
  }];
}

async function executePostMessage(node, inputData, executionContext, accessToken) {
  const params = node.parameters || {};
  
  // Get channel - can be from parameters or evaluated expression
  let channel = params.channel;
  if (channel && (channel.includes('{{') || channel.includes('$'))) {
    channel = evaluateExpression(channel, { executionContext, inputData });
  }
  
  // Get text - can be from parameters or input data
  let text = params.text;
  if (!text) {
    // Try to get text from input data
    if (inputData && inputData.length > 0) {
      text = inputData[0].json?.text || 
             inputData[0].json?.message || 
             inputData[0].json?.content ||
             JSON.stringify(inputData[0].json);
    }
  }
  
  if (text && (text.includes('{{') || text.includes('$'))) {
    text = evaluateExpression(text, { executionContext, inputData });
  }

  if (!channel) {
    throw new Error('Slack channel not specified');
  }

  if (!text) {
    text = 'No message content provided';
  }

  try {
    // Call Slack Web API to post message
    const response = await axios.post(
      'https://slack.com/api/chat.postMessage',
      {
        channel: channel,
        text: String(text)
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.data.ok) {
      throw new Error(`Slack API error: ${response.data.error || 'Unknown error'}`);
    }

    return [{
      json: {
        success: true,
        channel: response.data.channel,
        ts: response.data.ts,
        message: {
          text: text,
          channel: channel
        },
        slackResponse: response.data
      }
    }];
  } catch (error) {
    if (error.response) {
      throw new Error(`Slack API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

module.exports = {
  execute
};

