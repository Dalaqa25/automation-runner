const { google } = require('googleapis');
const { evaluateExpression } = require('../utils/expressions');

/**
 * Google Drive Trigger Executor
 * Watches for new files in a specific folder
 */
async function execute(node, inputData, executionContext) {
  const params = node.parameters || {};
  const event = params.event || 'fileCreated';

  // Handle nested folderToWatch structure (n8n format with __rl and value)
  let folderId = params.folderToWatch;
  if (folderId && typeof folderId === 'object' && folderId.value) {
    folderId = folderId.value;
  }

  // Evaluate expression if it contains placeholders
  if (typeof folderId === 'string' && (folderId.includes('{{') || folderId.startsWith('='))) {
    folderId = evaluateExpression(folderId, {
      currentInput: inputData || [],
      executionContext
    });
  }

  if (!folderId) {
    throw new Error('folderToWatch is required for Google Drive Trigger');
  }

  console.log(`[GoogleDriveTrigger] Checking folder ${folderId} for ${event} events`);

  // Get credentials from tokens or environment
  const accessToken = executionContext.tokens?.googleAccessToken ||
    executionContext.tokenInjector?.getToken('googleAccessToken') ||
    process.env.GOOGLE_ACCESS_TOKEN;

  if (!accessToken) {
    throw new Error('Google access token not provided. Set it in tokens.googleAccessToken or GOOGLE_ACCESS_TOKEN environment variable');
  }

  try {
    // Initialize Google Drive API client
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });

    const drive = google.drive({ version: 'v3', auth });

    // Get the last check time from execution context
    const lastCheckTime = executionContext.lastPollTime || new Date(Date.now() - 60000).toISOString();
    const processedFiles = executionContext.processedFiles || new Set();

    // Query for files created/modified after last check
    // IMPORTANT: Only look for PDF files to avoid processing spreadsheets, docs, etc.
    let query = `'${folderId}' in parents and trashed = false and mimeType = 'application/pdf'`;

    if (event === 'fileCreated') {
      query += ` and createdTime > '${lastCheckTime}'`;
    } else if (event === 'fileUpdated') {
      query += ` and modifiedTime > '${lastCheckTime}'`;
    }

    const response = await drive.files.list({
      q: query,
      fields: 'files(id, name, mimeType, createdTime, modifiedTime, size, webViewLink)',
      orderBy: 'createdTime desc',
      pageSize: 100
    });

    const files = response.data.files || [];

    console.log(`[GoogleDriveTrigger] Found ${files.length} files in folder since ${lastCheckTime}`);

    if (files.length === 0) {
      console.log(`[GoogleDriveTrigger] No new files found`);
      return [];
    }

    // Filter out already processed files
    const newFiles = files.filter(file => !processedFiles.has(file.id));

    if (newFiles.length === 0) {
      console.log(`[GoogleDriveTrigger] No new files found (${files.length} already processed)`);
      return [];
    }

    console.log(`[GoogleDriveTrigger] Found ${newFiles.length} new files (filtered ${files.length - newFiles.length} already processed)`);

    // Return each file as a separate item
    return newFiles.map(file => ({
      json: {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        createdTime: file.createdTime,
        modifiedTime: file.modifiedTime,
        size: file.size,
        webViewLink: file.webViewLink,
        event: event
      }
    }));

  } catch (error) {
    if (error.response) {
      throw new Error(`Google Drive API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    }
    throw new Error(`Google Drive Trigger error: ${error.message}`);
  }
}

module.exports = {
  execute
};
