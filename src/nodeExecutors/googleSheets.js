const { google } = require('googleapis');
const { evaluateExpression } = require('../utils/expressions');

/**
 * Google Sheets Node Executor
 * Handles Google Sheets operations
 */
async function execute(node, inputData, executionContext) {
  const nodeType = node.type;

  if (nodeType === 'n8n-nodes-base.googleSheets') {
    return await executeGoogleSheets(node, inputData, executionContext);
  }

  throw new Error(`Unsupported Google Sheets node type: ${nodeType}`);
}

async function executeGoogleSheets(node, inputData, executionContext) {
  const params = node.parameters || {};
  const operation = params.operation || 'append';
  
  // Handle nested documentId structure (n8n format with __rl and value)
  let documentId = params.documentId;
  if (documentId && typeof documentId === 'object' && documentId.value) {
    documentId = documentId.value;
  }
  
  // Handle nested sheetName structure (n8n format with __rl and value)
  let sheetName = params.sheetName || 'Sheet1';
  if (sheetName && typeof sheetName === 'object' && sheetName.value) {
    sheetName = sheetName.value;
  }

  if (!documentId) {
    throw new Error('documentId is required for Google Sheets operation');
  }

  // Get credentials from tokens or environment
  const accessToken = executionContext.tokens?.googleAccessToken ||
                      executionContext.tokenInjector?.getToken('googleAccessToken') ||
                      process.env.GOOGLE_ACCESS_TOKEN;

  if (!accessToken) {
    throw new Error('Google access token not provided. Set it in tokens.googleAccessToken or GOOGLE_ACCESS_TOKEN environment variable');
  }

  try {
    // Initialize Google Sheets API client
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });

    const sheets = google.sheets({ version: 'v4', auth });

    if (operation === 'append') {
      return await executeAppend(sheets, documentId, sheetName, inputData, executionContext);
    } else if (operation === 'read') {
      return await executeRead(sheets, documentId, sheetName, params, executionContext);
    } else {
      throw new Error(`Unsupported operation: ${operation}`);
    }
  } catch (error) {
    if (error.response) {
      throw new Error(`Google Sheets API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    }
    throw new Error(`Google Sheets error: ${error.message}`);
  }
}

async function executeAppend(sheets, documentId, sheetName, inputData, executionContext) {
  // Convert input data to rows
  const rows = [];
  
  for (const item of inputData || []) {
    const json = item.json || {};
    // Convert object to array of values
    const values = Object.values(json);
    if (values.length > 0) {
      rows.push(values.map(v => String(v !== undefined && v !== null ? v : '')));
    }
  }

  if (rows.length === 0) {
    return [{
      json: {
        message: 'No data to append',
        appended: 0
      }
    }];
  }

  // Append rows to sheet
  const response = await sheets.spreadsheets.values.append({
    spreadsheetId: documentId,
    range: `${sheetName}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    resource: {
      values: rows
    }
  });

  return [{
    json: {
      message: `Successfully appended ${rows.length} row(s)`,
      appended: rows.length,
      updatedRange: response.data.updatedRange
    }
  }];
}

async function executeRead(sheets, documentId, sheetName, params, executionContext) {
  const range = params.range || `${sheetName}!A:Z`;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: documentId,
    range: range
  });

  const rows = response.data.values || [];
  const results = [];

  // If first row contains headers, use them as keys
  const headers = rows.length > 0 ? rows[0] : [];
  const startRow = rows.length > 0 && headers.length > 0 ? 1 : 0;

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    const obj = {};

    if (headers.length > 0) {
      // Use headers as keys
      for (let j = 0; j < headers.length; j++) {
        obj[headers[j]] = row[j] || '';
      }
    } else {
      // Use column letters as keys
      for (let j = 0; j < row.length; j++) {
        obj[String.fromCharCode(65 + j)] = row[j] || ''; // A, B, C, etc.
      }
    }

    results.push({
      json: obj
    });
  }

  return results;
}

module.exports = {
  execute
};

