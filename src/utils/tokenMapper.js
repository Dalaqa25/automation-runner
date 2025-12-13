/**
 * Token Mapper
 * Maps token names from external sources (e.g., Next.js) to standardized names
 * that workflows expect
 */

class TokenMapper {
  constructor(customMapping = {}) {
    // Default mappings from common external token names to standardized names
    this.defaultMapping = {
      // Google tokens
      'google_oauth_token': 'googleAccessToken',
      'google_access_token': 'googleAccessToken',
      'google_token': 'googleAccessToken',
      'google_refresh_token': 'googleRefreshToken',
      
      // OpenAI tokens
      'openai_api_key': 'openAiApiKey',
      'openai_key': 'openAiApiKey',
      'openai_token': 'openAiApiKey',
      
      // OpenRouter tokens
      'openrouter_api_key': 'openRouterApiKey',
      'openrouter_key': 'openRouterApiKey',
      'openrouter_token': 'openRouterApiKey',
      
      // Anthropic tokens
      'anthropic_api_key': 'anthropicApiKey',
      'anthropic_key': 'anthropicApiKey',
      'claude_api_key': 'anthropicApiKey',
      
      // HuggingFace tokens
      'huggingface_api_key': 'huggingFaceApiKey',
      'huggingface_key': 'huggingFaceApiKey',
      'hf_api_key': 'huggingFaceApiKey',
      
      // Slack tokens
      'slack_bot_token': 'slackBotToken',
      'slack_token': 'slackBotToken',
      'slack_api_token': 'slackBotToken',
      
      // Pinecone tokens
      'pinecone_api_key': 'pineconeApiKey',
      'pinecone_key': 'pineconeApiKey',
      
      // Weaviate tokens
      'weaviate_api_key': 'weaviateApiKey',
      'weaviate_key': 'weaviateApiKey',
      
      // Supabase tokens
      'supabase_api_key': 'supabaseApiKey',
      'supabase_key': 'supabaseApiKey',
      'supabase_anon_key': 'supabaseAnonKey',
      'supabase_service_key': 'supabaseServiceKey',
    };
    
    // Merge custom mappings (custom takes precedence)
    this.mapping = {
      ...this.defaultMapping,
      ...customMapping
    };
  }

  /**
   * Map a token name to its standardized form
   * @param {string} externalTokenName - Token name from external source
   * @returns {string} Standardized token name
   */
  mapTokenName(externalTokenName) {
    if (!externalTokenName) return externalTokenName;
    
    // Normalize the key (lowercase, replace spaces/underscores)
    const normalized = externalTokenName.toLowerCase().trim();
    
    // Check if there's a mapping
    if (this.mapping[normalized]) {
      return this.mapping[normalized];
    }
    
    // If no mapping found, check if it already matches a standardized name
    // (case-insensitive)
    const standardizedNames = Object.values(this.defaultMapping);
    const matchingStandard = standardizedNames.find(
      name => name.toLowerCase() === normalized
    );
    
    if (matchingStandard) {
      return matchingStandard;
    }
    
    // Return original if no mapping found (preserve custom token names)
    return externalTokenName;
  }

  /**
   * Map an entire tokens object
   * @param {Object} externalTokens - Tokens object from external source
   * @returns {Object} Mapped tokens object with standardized names
   */
  mapTokens(externalTokens) {
    if (!externalTokens || typeof externalTokens !== 'object') {
      return {};
    }
    
    const mappedTokens = {};
    
    for (const [key, value] of Object.entries(externalTokens)) {
      const mappedKey = this.mapTokenName(key);
      mappedTokens[mappedKey] = value;
    }
    
    return mappedTokens;
  }

  /**
   * Get reverse mapping (standardized name -> possible external names)
   * Useful for documentation or debugging
   * @returns {Object} Reverse mapping object
   */
  getReverseMapping() {
    const reverse = {};
    
    for (const [external, standardized] of Object.entries(this.mapping)) {
      if (!reverse[standardized]) {
        reverse[standardized] = [];
      }
      reverse[standardized].push(external);
    }
    
    return reverse;
  }
}

module.exports = TokenMapper;

