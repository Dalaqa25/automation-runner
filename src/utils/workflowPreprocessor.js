/**
 * Workflow Preprocessor
 * Pre-processes workflow JSON to inject tokens into node parameters
 * before execution
 */

const { evaluateExpression } = require('./expressions');

class WorkflowPreprocessor {
  constructor(tokens = {}) {
    this.tokens = tokens;
  }

  /**
   * Pre-process a workflow to inject tokens
   * @param {Object} workflow - Workflow JSON object
   * @returns {Object} Pre-processed workflow
   */
  preprocess(workflow) {
    if (!workflow || !workflow.nodes) {
      return workflow;
    }

    // Deep clone workflow to avoid mutating original
    const processedWorkflow = JSON.parse(JSON.stringify(workflow));

    // Process each node
    if (processedWorkflow.nodes) {
      processedWorkflow.nodes = processedWorkflow.nodes.map(node =>
        this.processNode(node)
      );
    }

    return processedWorkflow;
  }

  /**
   * Process a single node to inject tokens
   * @param {Object} node - Node object
   * @returns {Object} Processed node
   */
  processNode(node) {
    if (!node.parameters) {
      return node;
    }

    // Don't inject credentials into trigger nodes — they don't need them
    // and injecting pollutes their output data (tokens leak into rule.interval etc.)
    if (node.type && (
      node.type.includes('scheduleTrigger') ||
      node.type.includes('manualTrigger') ||
      node.type.includes('webhookTrigger')
    )) {
      return node;
    }

    const processedNode = { ...node };
    processedNode.parameters = this.processParameters(node.parameters, node);

    // Also process credentials if they exist
    if (node.credentials) {
      processedNode.credentials = this.processCredentials(node.credentials, node);
    }

    return processedNode;
  }

  /**
   * Recursively process parameters to inject tokens
   * @param {Object} params - Parameters object
   * @param {Object} node - Node object (for context)
   * @returns {Object} Processed parameters
   */
  processParameters(params, node) {
    if (!params || typeof params !== 'object') {
      return params;
    }

    let processed = { ...params };

    // Process each parameter
    for (const [key, value] of Object.entries(processed)) {
      // Handle nested objects
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        processed[key] = this.processParameters(value, node);
      }
      // Handle arrays
      else if (Array.isArray(value)) {
        processed[key] = value.map(item => {
          if (item && typeof item === 'object') {
            return this.processParameters(item, node);
          }
          return this.processValue(item, node);
        });
      }
      // Handle primitive values
      else {
        processed[key] = this.processValue(value, node);
      }
    }

    // Special handling for common credential parameter patterns
    processed = this.injectCredentialParameters(processed, node);

    return processed;
  }

  /**
   * Process a single value to inject tokens
   * @param {*} value - Value to process
   * @param {Object} node - Node object (for context)
   * @returns {*} Processed value
   */
  processValue(value, node) {
    if (typeof value !== 'string') {
      return value;
    }

    // Check if value contains token expression
    if (value.includes('{{') && value.includes('$tokens')) {
      // Create a mock execution context for expression evaluation
      const mockContext = {
        executionContext: {
          tokens: this.tokens
        },
        currentInput: []
      };

      try {
        return evaluateExpression(value, mockContext);
      } catch (error) {
        // If evaluation fails, return original value
        console.warn(`[Preprocessor] Failed to evaluate expression: ${value}`, error.message);
        return value;
      }
    }

    // Check for direct token references (without {{ }})
    // Pattern: $tokens.tokenName
    const directTokenMatch = value.match(/^\$tokens\.(\w+)$/);
    if (directTokenMatch) {
      const tokenName = directTokenMatch[1];
      return this.tokens[tokenName] || value;
    }

    return value;
  }

  /**
   * Inject tokens into common credential parameter patterns
   * @param {Object} params - Parameters object
   * @param {Object} node - Node object
   * @returns {Object} Parameters with injected credentials
   */
  injectCredentialParameters(params, node) {
    const processed = { ...params };

    // Common credential parameter patterns
    const credentialPatterns = [
      // API keys
      { pattern: 'apiKey', tokens: ['openAiApiKey', 'openRouterApiKey', 'anthropicApiKey', 'huggingFaceApiKey'] },
      { pattern: 'api_key', tokens: ['openAiApiKey', 'openRouterApiKey', 'anthropicApiKey', 'huggingFaceApiKey'] },
      { pattern: 'accessToken', tokens: ['googleAccessToken', 'slackBotToken'] },
      { pattern: 'access_token', tokens: ['googleAccessToken', 'slackBotToken'] },
      { pattern: 'token', tokens: ['googleAccessToken', 'slackBotToken', 'openAiApiKey'] },

      // Node-specific patterns
      { pattern: 'openRouterApiKey', tokens: ['openRouterApiKey'] },
      { pattern: 'openAiApiKey', tokens: ['openAiApiKey'] },
      { pattern: 'googleAccessToken', tokens: ['googleAccessToken'] },
      { pattern: 'slackBotToken', tokens: ['slackBotToken'] },
      { pattern: 'anthropicApiKey', tokens: ['anthropicApiKey'] },
      { pattern: 'huggingFaceApiKey', tokens: ['huggingFaceApiKey'] },
    ];

    // Check each pattern
    for (const { pattern, tokens } of credentialPatterns) {
      // Check direct parameter match
      if (processed[pattern] === undefined || processed[pattern] === null || processed[pattern] === '') {
        // Try to inject from tokens
        for (const tokenName of tokens) {
          if (this.tokens[tokenName]) {
            processed[pattern] = this.tokens[tokenName];
            break;
          }
        }
      }

      // Check nested patterns (e.g., authentication.apiKey)
      if (processed.authentication && typeof processed.authentication === 'object') {
        if (!processed.authentication[pattern] || processed.authentication[pattern] === '') {
          for (const tokenName of tokens) {
            if (this.tokens[tokenName]) {
              processed.authentication[pattern] = this.tokens[tokenName];
              break;
            }
          }
        }
      }

      if (processed.credentials && typeof processed.credentials === 'object') {
        if (!processed.credentials[pattern] || processed.credentials[pattern] === '') {
          for (const tokenName of tokens) {
            if (this.tokens[tokenName]) {
              processed.credentials[pattern] = this.tokens[tokenName];
              break;
            }
          }
        }
      }
    }

    return processed;
  }

  /**
   * Process credentials object
   * @param {Object} credentials - Credentials object
   * @param {Object} node - Node object
   * @returns {Object} Processed credentials
   */
  processCredentials(credentials, node) {
    if (!credentials || typeof credentials !== 'object') {
      return credentials;
    }

    const processed = { ...credentials };

    // Handle OAuth2 credentials
    if (processed.oauth2) {
      if (!processed.oauth2.accessToken && this.tokens.googleAccessToken) {
        processed.oauth2.accessToken = this.tokens.googleAccessToken;
      }
      if (!processed.oauth2.refreshToken && this.tokens.googleRefreshToken) {
        processed.oauth2.refreshToken = this.tokens.googleRefreshToken;
      }
    }

    // Handle API key credentials
    if (processed.apiKey) {
      // Try common API key tokens
      const apiKeyTokens = ['openAiApiKey', 'openRouterApiKey', 'anthropicApiKey'];
      for (const tokenName of apiKeyTokens) {
        if (this.tokens[tokenName] && (!processed.apiKey || processed.apiKey === '')) {
          processed.apiKey = this.tokens[tokenName];
          break;
        }
      }
    }

    return processed;
  }
}

module.exports = WorkflowPreprocessor;

