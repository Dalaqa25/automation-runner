const axios = require('axios');
const { evaluateExpression } = require('../utils/expressions');

/**
 * LinkedIn Node Executor
 * Posts content to LinkedIn via the LinkedIn API v2
 * Supports posting as a person or an organization
 */
async function execute(node, inputData, executionContext) {
  const params = node.parameters || {};

  // Debug: log the raw expression and input data structure
  console.log(`[LinkedIn] Raw params.text expression: ${JSON.stringify(params.text)}`);
  console.log(`[LinkedIn] Input data items: ${inputData?.length || 0}`);
  if (inputData && inputData.length > 0) {
    console.log(`[LinkedIn] Input[0] keys: ${JSON.stringify(Object.keys(inputData[0]?.json || {}))}`);
    console.log(`[LinkedIn] Input[0] json: ${JSON.stringify(inputData[0]?.json)?.substring(0, 500)}`);
  }
  console.log(`[LinkedIn] Available node outputs: ${Object.keys(executionContext.nodes || {}).join(', ')}`);

  // Evaluate the post text (may contain expressions)
  let text = params.text || '';
  if (text.startsWith('=') || text.includes('{{')) {
    text = evaluateExpression(text, {
      currentInput: inputData,
      executionContext
    });
  }

  console.log(`[LinkedIn] Evaluated text (first 200 chars): ${JSON.stringify(text)?.substring(0, 200)}`);
  console.log(`[LinkedIn] Text type: ${typeof text}, truthy: ${!!text}`);

  // Fallback: if expression evaluated to empty/undefined, try to extract text
  // from input data using common field names that agent/code nodes produce
  if (!text && inputData && inputData.length > 0) {
    const inputJson = inputData[0]?.json || {};
    // Try common field names in priority order
    const fallbackFields = ['text', 'output', 'Content', 'content', 'message', 'linkedinText', 'post', 'postContent', 'linkedin_post'];
    for (const field of fallbackFields) {
      if (inputJson[field] && typeof inputJson[field] === 'string' && inputJson[field].trim().length > 0) {
        text = inputJson[field];
        console.log(`[LinkedIn] Fallback: using input field '${field}' (${text.length} chars)`);
        break;
      }
    }

    // If still empty, try stringifying the full input as last resort (only if it looks like post content)
    if (!text && Object.keys(inputJson).length > 0) {
      console.log(`[LinkedIn] WARNING: Could not find text in any known field. Available fields: ${Object.keys(inputJson).join(', ')}`);
    }
  }

  if (!text) {
    throw new Error('LinkedIn post text is required');
  }

  // Get LinkedIn access token from execution context
  const accessToken = executionContext.tokens?.linkedInAccessToken ||
    executionContext.tokens?.linkedinAccessToken ||
    executionContext.tokenInjector?.getToken('linkedInAccessToken') ||
    executionContext.tokenInjector?.getToken('linkedinAccessToken') ||
    process.env.LINKEDIN_ACCESS_TOKEN;

  if (!accessToken) {
    throw new Error('LinkedIn access token not provided. Please connect your LinkedIn account.');
  }

  // Determine author URN (person or organization)
  const postAs = params.postAs || 'person';
  let authorUrn;

  if (postAs === 'organization') {
    const orgId = params.organization || '';
    if (!orgId) {
      throw new Error('LinkedIn Organization ID is required when posting as organization');
    }
    authorUrn = `urn:li:organization:${orgId}`;
  } else {
    // Posting as person — need the person's LinkedIn URN
    // Try to get from context or fetch via /v2/me
    let personId = executionContext.tokens?.linkedInPersonId ||
      executionContext.tokenInjector?.getToken('linkedInPersonId');

    if (!personId) {
      // Fetch person ID from LinkedIn API
      try {
        const meResponse = await axios.get('https://api.linkedin.com/v2/me', {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        personId = meResponse.data.id;
        console.log(`[LinkedIn] Fetched person ID via /v2/me: ${personId}`);
      } catch (err) {
        if (err.response && err.response.status === 403) {
          try {
            console.log(`[LinkedIn] /v2/me returned 403, falling back to /v2/userinfo...`);
            const userInfoResponse = await axios.get('https://api.linkedin.com/v2/userinfo', {
              headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            personId = userInfoResponse.data.sub;
            console.log(`[LinkedIn] Fetched person ID via /v2/userinfo: ${personId}`);
          } catch (userInfoErr) {
            console.error(`[LinkedIn] Failed to fetch person ID from /v2/userinfo:`, userInfoErr.message);
            throw new Error('Could not determine LinkedIn person ID from either endpoint. Ensure the access token has profile permissions.');
          }
        } else {
          console.error(`[LinkedIn] Failed to fetch person ID:`, err.message);
          throw new Error('Could not determine LinkedIn person ID. Ensure the access token has profile permissions.');
        }
      }
    }
    authorUrn = `urn:li:person:${personId}`;
  }

  // Build the LinkedIn share post body (UGC Post API)
  const postBody = {
    author: authorUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: {
          text: text
        },
        shareMediaCategory: 'NONE'
      }
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
    }
  };

  console.log(`[LinkedIn] Posting as ${postAs} (${authorUrn}), text length: ${text.length}`);

  try {
    const response = await axios.post(
      'https://api.linkedin.com/v2/ugcPosts',
      postBody,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0'
        }
      }
    );

    console.log(`[LinkedIn] Post created successfully. ID: ${response.data.id}`);

    return [{
      json: {
        success: true,
        postId: response.data.id,
        postUrl: `https://www.linkedin.com/feed/update/${response.data.id}`,
        author: authorUrn,
        textLength: text.length
      }
    }];
  } catch (error) {
    const errorData = error.response?.data || error.message;
    console.error(`[LinkedIn] Post failed:`, JSON.stringify(errorData));

    if (error.response?.status === 401) {
      throw new Error('LinkedIn access token is expired or invalid. Please reconnect your LinkedIn account.');
    }

    throw new Error(`LinkedIn post failed: ${JSON.stringify(errorData)}`);
  }
}

module.exports = {
  execute
};
