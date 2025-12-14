const { google } = require('googleapis');
const { evaluateExpression } = require('../utils/expressions');

/**
 * Email Send Node Executor
 * Sends emails via Gmail API (OAuth - no password needed!)
 */
async function execute(node, inputData, executionContext) {
  // Get Google OAuth token
  const googleAccessToken = executionContext.tokens?.googleAccessToken ||
                           executionContext.tokenInjector?.getToken('googleAccessToken') ||
                           process.env.GOOGLE_ACCESS_TOKEN;
  
  if (!googleAccessToken) {
    throw new Error('Google OAuth token not provided. User must connect their Google account to send emails.');
  }
  
  console.log('[Email] Using Gmail API with OAuth token');
  return await executeWithGmailAPI(node, inputData, executionContext, googleAccessToken);
}

/**
 * Send email using Gmail API (OAuth - no password needed!)
 */
async function executeWithGmailAPI(node, inputData, executionContext, accessToken) {
  const params = node.parameters || {};
  
  // Initialize Gmail API client
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: 'v1', auth });
  
  const results = [];
  
  // Process each input item
  for (const item of inputData || []) {
    const expressionContext = {
      currentInput: [item],
      executionContext
    };
    
    // Evaluate email parameters
    const fromEmail = evaluateExpression(params.fromEmail || '', expressionContext);
    const toEmail = evaluateExpression(params.toEmail || '', expressionContext);
    const subject = evaluateExpression(params.subject || '', expressionContext);
    const message = evaluateExpression(params.message || params.text || '', expressionContext);
    
    // Build email in RFC 2822 format
    const emailLines = [
      `From: ${fromEmail}`,
      `To: ${toEmail}`,
      `Subject: ${subject}`,
      '',
      message
    ];
    
    const email = emailLines.join('\r\n');
    
    // Encode email in base64url format
    const encodedEmail = Buffer.from(email)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    
    try {
      console.log(`[Email] Sending via Gmail API to: ${toEmail}`);
      
      // Send email via Gmail API
      const response = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedEmail
        }
      });
      
      console.log(`[Email] Email sent successfully via Gmail API. Message ID: ${response.data.id}`);
      
      results.push({
        json: {
          success: true,
          messageId: response.data.id,
          to: toEmail,
          from: fromEmail,
          subject: subject,
          method: 'gmail-api'
        }
      });
      
    } catch (error) {
      console.error(`[Email] Failed to send via Gmail API:`, error.message);
      
      results.push({
        json: {
          success: false,
          error: error.message,
          to: toEmail,
          from: fromEmail,
          subject: subject,
          method: 'gmail-api'
        }
      });
    }
  }
  
  return results;
}

module.exports = {
  execute
};
