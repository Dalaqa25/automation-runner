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

  // Evaluate expression if it contains placeholders
  if (typeof documentId === 'string' && (documentId.includes('{{') || documentId.startsWith('='))) {
    documentId = evaluateExpression(documentId, {
      currentInput: inputData || [],
      executionContext
    });
  }

  // Handle nested sheetName structure (n8n format with __rl and value)
  let sheetName = params.sheetName || 'Sheet1';
  if (sheetName && typeof sheetName === 'object' && sheetName.value) {
    sheetName = sheetName.value;
  }

  // Handle gid= format (URL parameter style) - convert to sheet name
  // gid=0 means the first sheet, which is typically "Sheet1"
  if (typeof sheetName === 'string' && sheetName.startsWith('gid=')) {
    const gid = sheetName.replace('gid=', '');
    console.log(`[GoogleSheets] Sheet specified as gid=${gid}, will fetch actual sheet name`);
    // For gid=0, default to Sheet1. For other gids, we'll need to look it up.
    // Setting to null so we can fetch it after auth is set up
    sheetName = gid === '0' ? null : null; // Will be resolved below
  }

  if (!documentId) {
    throw new Error('documentId is required for Google Sheets operation');
  }

  console.log(`[GoogleSheets] Operation: ${operation}, Spreadsheet: ${documentId}, Sheet: ${sheetName}`);

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

    // If sheetName is null (from gid= format), look up the actual sheet name
    if (!sheetName) {
      try {
        const spreadsheet = await sheets.spreadsheets.get({
          spreadsheetId: documentId,
          fields: 'sheets.properties'
        });
        const sheetsList = spreadsheet.data.sheets || [];
        if (sheetsList.length > 0) {
          // Use the first sheet's title
          sheetName = sheetsList[0].properties?.title || 'Sheet1';
          console.log(`[GoogleSheets] Resolved sheet name to: ${sheetName}`);
        } else {
          sheetName = 'Sheet1';
        }
      } catch (lookupError) {
        console.log(`[GoogleSheets] Could not look up sheet name, defaulting to Sheet1`);
        sheetName = 'Sheet1';
      }
    }

    if (operation === 'append' || operation === 'appendOrUpdate') {
      // appendOrUpdate in n8n either appends new rows or updates existing ones
      // For now, we'll treat it as append - this handles the invoice use case
      return await executeAppend(sheets, documentId, sheetName, inputData, params, executionContext);
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

async function executeAppend(sheets, documentId, sheetName, inputData, params, executionContext) {
  // Get column schema from params if available (defines the column order)
  const columnSchema = params.columns?.schema || [];
  const columnMapping = params.columns?.value || {};

  // Build the ordered list of column names
  const orderedColumns = columnSchema.length > 0
    ? columnSchema.map(col => col.id || col.displayName)
    : Object.keys(columnMapping);

  console.log(`[GoogleSheets] Using column order: ${orderedColumns.join(', ')}`);

  // Convert input data to rows using the defined column order
  const rows = [];

  for (const item of inputData || []) {
    const json = item.json || {};

    // If we have column schema, use it to order the values
    if (orderedColumns.length > 0) {
      const values = orderedColumns.map(colName => {
        const val = json[colName];
        return String(val !== undefined && val !== null ? val : '');
      });
      if (values.some(v => v !== '')) {
        rows.push(values);
      }
    } else {
      // Fallback: Convert object to array of values (original behavior)
      const values = Object.values(json);
      if (values.length > 0) {
        rows.push(values.map(v => String(v !== undefined && v !== null ? v : '')));
      }
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

  // IMPORTANT: Pass through ALL input items so downstream nodes (like Agent/Email) 
  // can process each item separately. Just add success info to each item.
  return inputData.map(item => ({
    json: {
      ...item.json,
      _sheetsAppended: true,
      _sheetsResult: {
        message: `Successfully appended ${rows.length} row(s)`,
        appended: rows.length,
        updatedRange: response.data.updatedRange
      }
    }
  }));
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

