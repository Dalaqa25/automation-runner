const { google } = require('googleapis');
const { evaluateExpression } = require('../utils/expressions');

/**
 * Google Drive Node Executor
 * Handles Google Drive operations (download, upload, etc.)
 */
async function execute(node, inputData, executionContext) {
  const params = node.parameters || {};
  const operation = params.operation || 'download';

  if (operation === 'download') {
    return await executeDownload(node, inputData, executionContext);
  } else if (operation === 'upload') {
    return await executeUpload(node, inputData, executionContext);
  } else {
    throw new Error(`Unsupported Google Drive operation: ${operation}`);
  }
}

async function executeDownload(node, inputData, executionContext) {
  const params = node.parameters || {};

  // Handle nested fileId structure (n8n format with __rl and value)
  let fileIdParam = params.fileId;
  if (fileIdParam && typeof fileIdParam === 'object' && fileIdParam.value) {
    fileIdParam = fileIdParam.value;
  }

  // Get credentials from tokens or environment
  const accessToken = executionContext.tokens?.googleAccessToken ||
    executionContext.tokenInjector?.getToken('googleAccessToken') ||
    process.env.GOOGLE_ACCESS_TOKEN;

  if (!accessToken) {
    throw new Error('Google access token not provided');
  }

  const results = [];

  for (const item of inputData || []) {
    try {
      // Resolve fileId: evaluate expression if present, otherwise use from input item
      let resolvedFileId;

      if (typeof fileIdParam === 'string' && (fileIdParam.startsWith('=') || fileIdParam.includes('$json'))) {
        // It's an expression like ={{ $json.id }}, evaluate it against the input item
        resolvedFileId = evaluateExpression(fileIdParam, {
          currentInput: [item],
          executionContext
        });
      } else {
        // Use literal value or fall back to input data
        resolvedFileId = fileIdParam || item.json?.id || item.json?.fileId;
      }

      if (!resolvedFileId) {
        throw new Error('fileId is required for download operation');
      }

      // Initialize Google Drive API client
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: accessToken });

      const drive = google.drive({ version: 'v3', auth });

      // Get file metadata
      const metadata = await drive.files.get({
        fileId: resolvedFileId,
        fields: 'id, name, mimeType, size'
      });

      // Download file content
      const response = await drive.files.get(
        {
          fileId: resolvedFileId,
          alt: 'media'
        },
        { responseType: 'arraybuffer' }
      );

      // Convert to base64
      const base64Data = Buffer.from(response.data).toString('base64');
      const binaryPropertyName = params.options?.binaryPropertyName || 'data';

      results.push({
        json: {
          ...item.json,
          fileId: resolvedFileId,
          fileName: metadata.data.name,
          mimeType: metadata.data.mimeType,
          size: metadata.data.size
        },
        binary: {
          [binaryPropertyName]: {
            data: base64Data,
            mimeType: metadata.data.mimeType,
            fileName: metadata.data.name,
            fileSize: metadata.data.size
          }
        }
      });

    } catch (error) {
      if (error.response) {
        throw new Error(`Google Drive API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      }
      throw new Error(`Google Drive download error: ${error.message}`);
    }
  }

  return results;
}

async function executeUpload(node, inputData, executionContext) {
  // TODO: Implement upload functionality if needed
  throw new Error('Upload operation not yet implemented');
}

module.exports = {
  execute
};
