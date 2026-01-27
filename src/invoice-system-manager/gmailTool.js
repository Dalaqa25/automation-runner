const { google } = require('googleapis');
const { evaluateExpression } = require('../utils/expressions');

/**
 * Gmail Tool Node Executor
 * Sends emails via Gmail API
 */
async function execute(node, inputData, executionContext) {
  const params = node.parameters || {};
  const emailType = params.emailType || 'text';

  // If no input data, skip execution (workflow was stopped upstream)
  if (!inputData || inputData.length === 0) {
    console.log(`[GmailTool] No input data - skipping email send for node '${node.name}'`);
    return [];
  }

  // Also check if input data is empty or has null items
  const hasValidData = inputData.some(item => {
    return item && typeof item === 'object' && item.json && Object.keys(item.json).length > 0;
  });

  if (!hasValidData) {
    console.log(`[GmailTool] Input data is empty or invalid - skipping email send for node '${node.name}'`);
    return [];
  }

  const results = [];

  for (const item of inputData || []) {
    // Skip null or invalid items
    if (!item || !item.json) {
      console.log(`[GmailTool] Skipping invalid item`);
      continue;
    }

    try {
      // Evaluate sendTo parameter
      let sendTo = evaluateExpression(params.sendTo || '', {
        currentInput: [item],
        executionContext
      });

      // Evaluate subject - if it contains $fromAI, build from invoice data
      let subject = evaluateExpression(params.subject || '', {
        currentInput: [item],
        executionContext
      });

      // Evaluate message - if it contains $fromAI, build from invoice data
      let message = evaluateExpression(params.message || '', {
        currentInput: [item],
        executionContext
      });

      // If subject/message are empty or contain $fromAI (unsupported), build from invoice data
      // Get invoice data from Invoice Data Extractor node output (the structured data)
      // Fall back to Update the database output, then current item
      const extractorOutput = executionContext.nodes['Invoice Data Extractor'];
      const sheetsOutput = executionContext.nodes['Update the database'];

      // Priority: Extractor output > Sheets output > Current item
      let invoiceData = item.json;
      if (extractorOutput && extractorOutput.length > 0 && extractorOutput[0].json) {
        invoiceData = extractorOutput[0].json;
      } else if (sheetsOutput && sheetsOutput.length > 0 && sheetsOutput[0].json) {
        invoiceData = sheetsOutput[0].json;
      }

      console.log(`[GmailTool] Invoice data keys: ${Object.keys(invoiceData).join(', ')}`);

      if (!subject || subject.includes('$fromAI')) {
        subject = `Invoice Received: ${invoiceData['Invoice num:'] || 'N/A'}`;
      }

      // Determine status color for HTML
      const status = invoiceData['Status:'] || 'N/A';
      const statusColor = status.toLowerCase().includes('paid') && !status.toLowerCase().includes('not')
        ? '#28a745' // Green for paid
        : '#dc3545'; // Red for not paid

      if (!message || message.includes('$fromAI')) {
        // Build HTML email message from invoice data
        message = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); overflow: hidden;">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center;">
      <h1 style="margin: 0; font-size: 24px; font-weight: 600;">📄 Invoice Received</h1>
      <p style="margin: 10px 0 0 0; opacity: 0.9; font-size: 14px;">New invoice has been processed and added to the database</p>
    </div>
    
    <!-- Content -->
    <div style="padding: 30px;">
      <p style="color: #333; font-size: 16px; margin-top: 0;">Hi, Dear Billing Team,</p>
      <p style="color: #666; font-size: 14px; line-height: 1.6;">Here's the data of an invoice we just received:</p>
      
      <!-- Invoice Details Table -->
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr style="background-color: #f8f9fa;">
          <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef; color: #495057; font-weight: 600;">Invoice #</td>
          <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef; color: #212529;">${invoiceData['Invoice num:'] || 'N/A'}</td>
        </tr>
        <tr>
          <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef; color: #495057; font-weight: 600;">Invoice Date</td>
          <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef; color: #212529;">${invoiceData['Invoice date:'] || 'N/A'}</td>
        </tr>
        <tr style="background-color: #f8f9fa;">
          <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef; color: #495057; font-weight: 600;">Client Name</td>
          <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef; color: #212529;">${invoiceData['Client name:'] || 'N/A'}</td>
        </tr>
        <tr>
          <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef; color: #495057; font-weight: 600;">Client Email</td>
          <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef; color: #212529;">${invoiceData['Client email'] || 'N/A'}</td>
        </tr>
        <tr style="background-color: #f8f9fa;">
          <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef; color: #495057; font-weight: 600;">Client Address</td>
          <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef; color: #212529;">${invoiceData['Client adress:'] || 'N/A'}</td>
        </tr>
      </table>
      
      <!-- Amount & Status -->
      <div style="display: flex; gap: 15px; margin: 20px 0;">
        <div style="flex: 1; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; padding: 20px; text-align: center;">
          <p style="margin: 0; color: rgba(255,255,255,0.8); font-size: 12px; text-transform: uppercase;">Total Amount</p>
          <p style="margin: 5px 0 0 0; color: white; font-size: 24px; font-weight: 700;">${invoiceData['Amount:'] || 'N/A'}</p>
        </div>
        <div style="flex: 1; background-color: ${statusColor}; border-radius: 8px; padding: 20px; text-align: center;">
          <p style="margin: 0; color: rgba(255,255,255,0.8); font-size: 12px; text-transform: uppercase;">Status</p>
          <p style="margin: 5px 0 0 0; color: white; font-size: 24px; font-weight: 700;">${status}</p>
        </div>
      </div>
      
      <!-- Products Section -->
      <h3 style="color: #333; font-size: 16px; margin: 25px 0 15px 0; border-bottom: 2px solid #667eea; padding-bottom: 8px;">🛒 Products Sold</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr style="background-color: #667eea; color: white;">
          <th style="padding: 10px 15px; text-align: left; font-size: 13px;">Product</th>
          <th style="padding: 10px 15px; text-align: left; font-size: 13px;">Quantity</th>
        </tr>
        <tr style="background-color: #f8f9fa;">
          <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef;">${invoiceData['Product 1 :'] || 'N/A'}</td>
          <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef;" rowspan="2">${invoiceData['Quantity:'] || 'N/A'}</td>
        </tr>
        <tr>
          <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef;">${invoiceData['Product 2:'] || 'N/A'}</td>
        </tr>
      </table>
      
      <!-- Payment Method -->
      <div style="background-color: #f8f9fa; border-radius: 8px; padding: 15px; margin-top: 20px;">
        <p style="margin: 0; color: #495057;"><strong>💳 Payment Method:</strong> ${invoiceData['Payment method'] || 'N/A'}</p>
      </div>
      
      <!-- Footer Message -->
      <p style="color: #666; font-size: 14px; margin-top: 25px; line-height: 1.6;">
        ✅ The data has been successfully saved to the sheets database.
      </p>
      <p style="color: #666; font-size: 14px; margin-bottom: 0;">
        Best regards,<br>
        <strong style="color: #667eea;">Invoice Automation System</strong>
      </p>
    </div>
    
    <!-- Footer -->
    <div style="background-color: #f8f9fa; padding: 20px; text-align: center; border-top: 1px solid #e9ecef;">
      <p style="margin: 0; color: #999; font-size: 12px;">This is an automated email from your Invoice Manager Agent</p>
    </div>
  </div>
</body>
</html>`;
      }

      // Defense in depth: Skip sending if all invoice fields are N/A (no valid data)
      const invoiceFields = [
        invoiceData?.['Invoice num:'], invoiceData?.['Invoice date:'],
        invoiceData?.['Client name:'], invoiceData?.['Client email'],
        invoiceData?.['Amount:'], invoiceData?.['Status:']
      ];
      const allFieldsEmpty = invoiceFields.every(field => !field || field === 'N/A');

      if (allFieldsEmpty) {
        console.log(`[GmailTool] Skipping email - all invoice fields are N/A (no valid data)`);
        continue;
      }

      if (!sendTo) {
        throw new Error('sendTo (recipient email) is required');
      }

      if (!subject) {
        throw new Error('subject is required');
      }

      if (!message) {
        throw new Error('message is required');
      }

      // Get credentials from tokens or environment
      const accessToken = executionContext.tokens?.googleAccessToken ||
        executionContext.tokenInjector?.getToken('googleAccessToken') ||
        process.env.GOOGLE_ACCESS_TOKEN;

      if (!accessToken) {
        throw new Error('Google access token not provided');
      }

      // Initialize Gmail API client
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: accessToken });

      const gmail = google.gmail({ version: 'v1', auth });

      // Build HTML email message
      const emailLines = [
        `To: ${sendTo}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=utf-8',
        '',
        message
      ];

      const email = emailLines.join('\r\n');
      const encodedEmail = Buffer.from(email).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      // Send email
      const response = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedEmail
        }
      });

      results.push({
        json: {
          ...item.json,
          emailSent: true,
          messageId: response.data.id,
          threadId: response.data.threadId,
          sentTo: sendTo,
          subject: subject
        }
      });

    } catch (error) {
      if (error.response) {
        throw new Error(`Gmail API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      }
      throw new Error(`Gmail send error: ${error.message}`);
    }
  }

  return results;
}

module.exports = {
  execute
};
