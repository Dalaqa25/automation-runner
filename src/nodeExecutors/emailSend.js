const nodemailer = require('nodemailer');
const { evaluateExpression } = require('../utils/expressions');

/**
 * Email Send Node Executor
 * Sends emails via SMTP
 */
async function execute(node, inputData, executionContext) {
  const params = node.parameters || {};
  const operation = params.operation || 'send';
  
  // Get SMTP credentials from node credentials or environment
  const credentials = node.credentials?.smtp;
  const smtpConfig = {
    host: credentials?.host || process.env.SMTP_HOST || 'smtp.gmail.com',
    port: credentials?.port || process.env.SMTP_PORT || 587,
    secure: credentials?.secure || process.env.SMTP_SECURE === 'true' || false,
    auth: {
      user: credentials?.user || process.env.SMTP_USER,
      pass: credentials?.password || process.env.SMTP_PASSWORD
    }
  };

  // Validate SMTP credentials
  if (!smtpConfig.auth.user || !smtpConfig.auth.pass) {
    throw new Error('SMTP credentials not provided. Set SMTP_USER and SMTP_PASSWORD in environment or node credentials');
  }

  // Create transporter
  const transporter = nodemailer.createTransport(smtpConfig);

  const results = [];

  // Process each input item (send email for each)
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
    
    // Handle email options
    const options = params.options || {};
    const ccEmail = options.ccEmail ? evaluateExpression(options.ccEmail, expressionContext) : undefined;
    const bccEmail = options.bccEmail ? evaluateExpression(options.bccEmail, expressionContext) : undefined;
    const replyTo = options.replyTo ? evaluateExpression(options.replyTo, expressionContext) : undefined;

    // Build email message
    const mailOptions = {
      from: fromEmail,
      to: toEmail,
      subject: subject,
      text: message,
      html: options.allowHtml ? message : undefined
    };

    if (ccEmail) mailOptions.cc = ccEmail;
    if (bccEmail) mailOptions.bcc = bccEmail;
    if (replyTo) mailOptions.replyTo = replyTo;

    // Handle attachments if present
    if (options.attachments && item.binary) {
      mailOptions.attachments = Object.keys(item.binary).map(key => ({
        filename: key,
        content: item.binary[key].data
      }));
    }

    try {
      console.log(`[Email] Sending email to: ${toEmail}`);
      
      // Send email
      const info = await transporter.sendMail(mailOptions);
      
      console.log(`[Email] Email sent successfully. Message ID: ${info.messageId}`);

      results.push({
        json: {
          success: true,
          messageId: info.messageId,
          to: toEmail,
          from: fromEmail,
          subject: subject,
          response: info.response
        }
      });

      // For sendAndWait operation, wait for a response (webhook-based)
      // In this implementation, we just return success immediately
      // Real implementation would need webhook handling
      if (operation === 'sendAndWait') {
        console.log(`[Email] sendAndWait operation - webhook handling not implemented, returning success`);
      }

    } catch (error) {
      console.error(`[Email] Failed to send email:`, error.message);
      
      results.push({
        json: {
          success: false,
          error: error.message,
          to: toEmail,
          from: fromEmail,
          subject: subject
        }
      });
    }
  }

  return results;
}

module.exports = {
  execute
};
