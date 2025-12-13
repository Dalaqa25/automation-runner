/**
 * Credential Resolver
 * Resolves n8n credential placeholders (e.g., {{OPEN_ROUTER_API_KEY}}) 
 * by mapping them to developer_keys from the database
 */

/**
 * Resolves credential placeholders in a workflow
 * @param {Object} workflow - The workflow object
 * @param {Object} developerKeys - Developer keys from database (e.g., { OPEN_ROUTER_API_KEY: "sk-..." })
 * @returns {Object} - Workflow with resolved credentials + credential map for injection
 */
function resolveCredentials(workflow, developerKeys = {}) {
  const resolvedCredentials = {};
  
  if (!workflow.nodes || !Array.isArray(workflow.nodes)) {
    return { workflow, resolvedCredentials };
  }

  // Process each node
  const processedNodes = workflow.nodes.map(node => {
    if (!node.credentials) {
      return node;
    }

    const newCredentials = {};
    
    // Process each credential type (e.g., openRouterApi, googleOAuth, etc.)
    for (const [credType, credConfig] of Object.entries(node.credentials)) {
      const credId = credConfig.id;
      
      // Check if it's a placeholder pattern: {{PLACEHOLDER_NAME}}
      const placeholderMatch = credId?.match(/^\{\{([A-Z_0-9]+)\}\}$/);
      
      if (placeholderMatch) {
        const placeholderName = placeholderMatch[1];
        const apiKey = developerKeys[placeholderName];
        
        if (apiKey) {
          console.log(`[CredentialResolver] Resolved placeholder {{${placeholderName}}} for node: ${node.name}`);
          
          // Store the resolved API key for injection
          // Map common credential types to token names
          const tokenName = getTokenNameForCredentialType(credType, placeholderName);
          resolvedCredentials[tokenName] = apiKey;
          
          // Keep the credential reference but mark it as resolved
          newCredentials[credType] = {
            ...credConfig,
            id: `resolved_${placeholderName}`,
            resolved: true,
            originalPlaceholder: placeholderName
          };
        } else {
          console.warn(`[CredentialResolver] No API key found for placeholder: {{${placeholderName}}}`);
          // Keep original credential config
          newCredentials[credType] = credConfig;
        }
      } else {
        // Not a placeholder, keep as-is
        newCredentials[credType] = credConfig;
      }
    }
    
    return {
      ...node,
      credentials: newCredentials
    };
  });

  return {
    workflow: {
      ...workflow,
      nodes: processedNodes
    },
    resolvedCredentials
  };
}

/**
 * Maps credential types to token names used by executors
 */
function getTokenNameForCredentialType(credType, placeholderName) {
  // Common mappings
  const mappings = {
    'openRouterApi': 'openRouterApiKey',
    'openAiApi': 'openAiApiKey',
    'anthropicApi': 'anthropicApiKey',
    'huggingFaceApi': 'huggingFaceApiKey',
    'googleOAuth2': 'googleAccessToken',
    'slackApi': 'slackToken'
  };
  
  // Try mapped name first
  if (mappings[credType]) {
    return mappings[credType];
  }
  
  // Fallback: convert placeholder name to camelCase
  // OPEN_ROUTER_API_KEY -> openRouterApiKey
  return placeholderName
    .toLowerCase()
    .split('_')
    .map((word, index) => index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

module.exports = {
  resolveCredentials
};
