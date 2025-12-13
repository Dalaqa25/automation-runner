const axios = require('axios');
const { evaluateExpression, evaluateExpressionValue } = require('../utils/expressions');

/**
 * HTTP Request Node Executor
 * Handles GET, POST, PUT, DELETE, etc. with headers, body, and binary data
 */
async function execute(node, inputData, executionContext) {
  const params = node.parameters || {};
  
  // Evaluate dynamic expressions in parameters
  const url = evaluateExpression(params.url || '', {
    currentInput: inputData,
    executionContext
  });

  // Debug: log URL evaluation
  if (!url || url === '') {
    console.log('[HTTP] Warning: Empty URL after evaluation');
    console.log('[HTTP] Original URL param:', params.url);
    // Don't log binary data
    const safeInputData = inputData.map(item => {
      const safe = { ...item };
      if (safe.data && Buffer.isBuffer(safe.data)) {
        safe.data = `[Binary data: ${safe.data.length} bytes]`;
      }
      if (safe.json?.data && Buffer.isBuffer(safe.json.data)) {
        safe.json = { ...safe.json, data: `[Binary data: ${safe.json.data.length} bytes]` };
      }
      return safe;
    });
    console.log('[HTTP] Input data:', JSON.stringify(safeInputData, null, 2));
  }

  const method = (params.method || params.httpMethod || 'GET').toUpperCase();
  
  // Build headers
  const headers = {};
  if (params.sendHeaders && params.headerParameters?.parameters) {
    for (const header of params.headerParameters.parameters) {
      const headerValue = evaluateExpression(header.value || '', {
        currentInput: inputData,
        executionContext
      });
      headers[header.name] = headerValue;
    }
  }

  // Handle JSON headers
  if (params.specifyHeaders === 'json' && params.jsonHeaders) {
    try {
      const jsonHeaders = JSON.parse(params.jsonHeaders);
      Object.assign(headers, jsonHeaders);
    } catch (e) {
      // Ignore parse errors
    }
  }

  // Build request config
  const config = {
    method,
    url,
    headers,
    timeout: 30000,
    maxRedirects: 5
  };

  // Handle body
  if (params.sendBody) {
    if (params.contentType === 'binaryData') {
      // Binary data - get from input
      if (inputData && inputData.length > 0) {
        const inputField = params.inputDataFieldName || 'data';
        const binaryData = inputData[0][inputField] || inputData[0].data;
        config.data = binaryData;
      }
    } else if (params.bodyParameters?.parameters) {
      // Form/JSON body parameters
      const body = {};
      const expressionContext = {
        currentInput: inputData,
        executionContext
      };

      for (const param of params.bodyParameters.parameters) {
        const expr = (param.value || '').trim();
        let paramValue;

        // Detect simple expressions like ={{ $json.snippet }}
        const simpleExpressionMatch = expr.match(/^=\s*\{\{\s*([^}]+)\s*\}\}\s*$/);
        if (simpleExpressionMatch) {
          paramValue = evaluateExpressionValue(simpleExpressionMatch[1], expressionContext);
        }

        // Fall back to full expression evaluation (handles string interpolation)
        if (paramValue === undefined) {
          paramValue = evaluateExpression(expr, expressionContext);
        }

        // If the value is a string that looks like JSON (starts with { or [), try to parse it
        if (typeof paramValue === 'string' && (paramValue.trim().startsWith('{') || paramValue.trim().startsWith('['))) {
          try {
            paramValue = JSON.parse(paramValue);
          } catch (e) {
            // Not valid JSON, keep as string
          }
        }

        // Debug logging for status field issues
        if (param.name === 'status') {
          console.log(`[HTTP] Status parameter evaluation:`);
          console.log(`  - Expression: ${expr}`);
          console.log(`  - Evaluated to:`, typeof paramValue === 'object' ? JSON.stringify(paramValue) : paramValue);
          console.log(`  - Type:`, typeof paramValue);
          if (typeof paramValue !== 'object' || paramValue === null) {
            console.log(`[HTTP] ERROR: status should be an object, but got:`, paramValue);
            // Log the input data to debug
            const safeInput = inputData.map(item => {
              const safe = { json: { ...item.json } };
              if (safe.json.data && Buffer.isBuffer(safe.json.data)) {
                safe.json.data = '[Binary]';
              }
              return safe;
            });
            console.log(`[HTTP] Input data for debugging:`, JSON.stringify(safeInput, null, 2));
          }
        }

        body[param.name] = paramValue;
      }

      // Ensure Content-Type is set for JSON if not already set
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }

      config.data = body;
    } else if (params.jsonBody) {
      // Raw JSON body
      try {
        config.data = JSON.parse(params.jsonBody);
      } catch (e) {
        config.data = params.jsonBody;
      }
    }
  }

  // Handle response format
  const responseFormat = params.options?.response?.response?.responseFormat || 'json';
  const fullResponse = params.options?.response?.response?.fullResponse || false;

  if (responseFormat === 'file') {
    config.responseType = 'arraybuffer';
  } else if (responseFormat === 'text') {
    config.responseType = 'text';
  }

  // Allow unauthorized certs if specified
  if (params.options?.allowUnauthorizedCerts) {
    config.httpsAgent = new (require('https').Agent)({
      rejectUnauthorized: false
    });
  }

  try {
    if (!url || typeof url !== 'string' || url.trim() === '') {
      throw new Error(`Invalid URL: "${url}" (evaluated from: "${params.url}")`);
    }

    const response = await axios(config);

    // Format output based on response format
    if (responseFormat === 'file') {
      // Return binary data
      // Use 'httpStatus' instead of 'status' to avoid conflicts with workflow data
      return [{
        json: {
          data: response.data,
          headers: response.headers,
          httpStatus: response.status  // Renamed to prevent field conflicts
        },
        data: response.data // Binary data
      }];
    } else if (fullResponse) {
      // Return full response object
      // Use 'httpStatus' instead of 'status' to avoid conflicts with workflow data
      return [{
        json: {
          data: response.data,
          headers: response.headers,
          httpStatus: response.status,  // Renamed to prevent field conflicts
          statusText: response.statusText
        }
      }];
    } else {
      // Return just the data
      return [{
        json: response.data
      }];
    }
  } catch (error) {
    if (error.response) {
      // HTTP error response
      // Use 'httpStatus' instead of 'status' to avoid conflicts
      return [{
        json: {
          error: error.message,
          httpStatus: error.response.status,  // Renamed to prevent field conflicts
          data: error.response.data,
          headers: error.response.headers
        }
      }];
    } else {
      // Network or other errors
      const errorMsg = error.message || 'Unknown error';
      throw new Error(`HTTP Request failed: ${errorMsg}. URL: "${url}", Original: "${params.url}"`);
    }
  }
}

module.exports = {
  execute
};

