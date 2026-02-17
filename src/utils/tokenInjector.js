/**
 * Token Injector
 * Manages and injects authentication tokens into workflow execution
 */

const TokenMapper = require('./tokenMapper');
const WorkflowPreprocessor = require('./workflowPreprocessor');

class TokenInjector {
  constructor(tokens = {}, tokenMapping = {}) {
    // Map external token names to standardized names
    this.tokenMapper = new TokenMapper(tokenMapping);
    const mappedTokens = this.tokenMapper.mapTokens(tokens);
    
    this.tokens = {
      // Generic OAuth tokens (for TikTok, etc.)
      accessToken: mappedTokens.accessToken || null,
      refreshToken: mappedTokens.refreshToken || null,
      
      // Google OAuth tokens
      googleAccessToken: mappedTokens.googleAccessToken || null,
      googleRefreshToken: mappedTokens.googleRefreshToken || null,
      
      // OpenRouter API key
      openRouterApiKey: mappedTokens.openRouterApiKey || null,
      
      // Other API keys
      openAiApiKey: mappedTokens.openAiApiKey || null,
      anthropicApiKey: mappedTokens.anthropicApiKey || null,
      huggingFaceApiKey: mappedTokens.huggingFaceApiKey || null,
      
      // Slack tokens
      slackBotToken: mappedTokens.slackBotToken || null,
      
      // Vector store tokens
      pineconeApiKey: mappedTokens.pineconeApiKey || null,
      weaviateApiKey: mappedTokens.weaviateApiKey || null,
      supabaseApiKey: mappedTokens.supabaseApiKey || null,
      supabaseAnonKey: mappedTokens.supabaseAnonKey || null,
      supabaseServiceKey: mappedTokens.supabaseServiceKey || null,
      
      // Custom tokens (preserve any unmapped tokens)
      ...mappedTokens
    };
    
    // Initialize workflow preprocessor
    this.preprocessor = new WorkflowPreprocessor(this.tokens);
  }

  /**
   * Inject tokens into execution context
   * @param {Object} executionContext - The execution context to inject into
   */
  injectIntoContext(executionContext) {
    if (!executionContext.tokens) {
      executionContext.tokens = {};
    }
    
    // Make tokens available in execution context
    Object.assign(executionContext.tokens, this.tokens);
    
    // Also make them available as a top-level property for easy access
    executionContext.tokens = {
      ...executionContext.tokens,
      ...this.tokens
    };
  }

  /**
   * Inject tokens into environment variables (for nodes that read from process.env)
   * This is a temporary injection that doesn't modify the actual process.env
   * but makes tokens available during execution
   */
  getEnvironmentOverrides() {
    const overrides = {};
    
    if (this.tokens.openRouterApiKey) {
      overrides.OPENROUTER_API_KEY = this.tokens.openRouterApiKey;
    }
    
    if (this.tokens.openAiApiKey) {
      overrides.OPENAI_API_KEY = this.tokens.openAiApiKey;
    }
    
    return overrides;
  }

  /**
   * Get a specific token by key
   * @param {string} key - Token key (e.g., 'googleAccessToken')
   * @returns {string|null} Token value or null
   */
  getToken(key) {
    return this.tokens[key] || null;
  }

  /**
   * Get all tokens (for debugging/logging - be careful with sensitive data)
   * @returns {Object} All tokens (keys only, not values for security)
   */
  getTokenKeys() {
    return Object.keys(this.tokens).filter(key => this.tokens[key] !== null);
  }

  /**
   * Pre-process and inject tokens into workflow
   * @param {Object} workflow - Workflow JSON object
   * @returns {Object} Pre-processed workflow with tokens injected
   */
  injectIntoWorkflow(workflow) {
    if (!workflow) {
      return workflow;
    }
    
    return this.preprocessor.preprocess(workflow);
  }

  /**
   * Get token mapper instance (for custom mappings)
   * @returns {TokenMapper} Token mapper instance
   */
  getTokenMapper() {
    return this.tokenMapper;
  }
}

module.exports = TokenInjector;

