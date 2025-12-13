# Token Injector System

The Automation Runner supports injecting authentication tokens from your frontend application (e.g., Next.js) into workflow executions. This allows workflows to use user-specific credentials without hardcoding them.

## How It Works

1. **Token Mapping**: External token names (e.g., from Next.js) are automatically mapped to standardized names
2. **Workflow Preprocessing**: Tokens are automatically injected into node parameters before execution
3. **Runtime Access**: Tokens are available in the execution context for node executors and expressions
4. **Automatic Injection**: Common credential parameter patterns are automatically filled with matching tokens

## API Usage

### POST /execute

```json
{
  "workflow": { ... },
  "initialData": {
    "body": {
      "tiktok_url": "https://..."
    }
  },
  "tokens": {
    "googleAccessToken": "ya29.a0ATi6K2ud7kwTfHBKIeIoBS2mxVQq-...",
    "openRouterApiKey": "sk-or-v1-...",
    "openAiApiKey": "sk-..."
  },
  "tokenMapping": {
    "google_oauth_token": "googleAccessToken",
    "openai_key": "openAiApiKey"
  }
}
```

**Parameters:**
- `workflow` (required): Workflow JSON object
- `initialData` (optional): Initial data for entry nodes
- `tokens` (optional): Authentication tokens object
- `tokenMapping` (optional): Custom mapping from external token names to standardized names

### POST /queue

Same structure as `/execute` - tokens and mappings are stored with the job and injected when the workflow executes.

## Token Name Mapping

The system automatically maps common external token names to standardized names. For example:

- `google_oauth_token` → `googleAccessToken`
- `openai_api_key` → `openAiApiKey`
- `openrouter_key` → `openRouterApiKey`
- `slack_bot_token` → `slackBotToken`

You can provide custom mappings via the `tokenMapping` parameter to override or extend the default mappings.

## Supported Tokens

### Standardized Token Names

- **googleAccessToken** - Google OAuth access token (for YouTube API, Google Sheets, etc.)
- **googleRefreshToken** - Google OAuth refresh token
- **openRouterApiKey** - OpenRouter API key (for AI/LLM nodes)
- **openAiApiKey** - OpenAI API key
- **anthropicApiKey** - Anthropic/Claude API key
- **huggingFaceApiKey** - HuggingFace API key
- **slackBotToken** - Slack bot token
- **pineconeApiKey** - Pinecone API key (for vector stores)
- **weaviateApiKey** - Weaviate API key
- **supabaseApiKey** - Supabase API key
- **supabaseAnonKey** - Supabase anonymous key
- **supabaseServiceKey** - Supabase service role key
- **Custom tokens** - Any additional tokens you need (preserved as-is)

## Accessing Tokens in Workflows

### In Expressions

Tokens can be accessed in node expressions using `$tokens`:

```
{{ $tokens.googleAccessToken }}
{{ $tokens.openRouterApiKey }}
```

### In Code Nodes

Tokens are available in the execution context:

```javascript
const googleToken = $executionContext.tokens.googleAccessToken;
const openRouterKey = $executionContext.tokens.openRouterApiKey;
```

### In HTTP Nodes

Use expressions in headers or URLs:

```
Authorization: Bearer {{ $tokens.googleAccessToken }}
```

## Automatic Token Injection

The system automatically injects tokens into node parameters in several ways:

### 1. Expression Evaluation
Tokens referenced in expressions are automatically resolved:
```
{{ $tokens.googleAccessToken }}
{{ $tokens.openRouterApiKey }}
```

### 2. Parameter Pattern Matching
Common credential parameter patterns are automatically filled:
- `apiKey` or `api_key` → Tries: `openAiApiKey`, `openRouterApiKey`, `anthropicApiKey`, `huggingFaceApiKey`
- `accessToken` or `access_token` → Tries: `googleAccessToken`, `slackBotToken`
- `token` → Tries: `googleAccessToken`, `slackBotToken`, `openAiApiKey`

### 3. Node-Specific Injection
Node executors automatically use injected tokens:
- **AI/LLM Nodes**: Use `tokens.openRouterApiKey`, `tokens.openAiApiKey`, etc.
- **Google Sheets**: Uses `tokens.googleAccessToken`
- **Slack**: Uses `tokens.slackBotToken`
- **HTTP Nodes**: Can reference tokens via expressions in headers
- **Vector Stores**: Use respective API keys from tokens

### 4. Credential Objects
Tokens are injected into credential objects:
- `credentials.oauth2.accessToken` → `tokens.googleAccessToken`
- `credentials.apiKey` → Matching API key tokens

## Examples

### Example 1: YouTube Upload with Token Expression

```json
{
  "workflow": {
    "nodes": [
      {
        "name": "Upload to YouTube",
        "type": "n8n-nodes-base.httpRequest",
        "parameters": {
          "method": "POST",
          "url": "https://www.googleapis.com/upload/youtube/v3/videos",
          "headerParameters": {
            "parameters": [
              {
                "name": "Authorization",
                "value": "Bearer {{ $tokens.googleAccessToken }}"
              }
            ]
          }
        }
      }
    ]
  },
  "tokens": {
    "googleAccessToken": "ya29.a0ATi6K2ud7kwTfHBKIeIoBS2mxVQq-..."
  }
}
```

### Example 2: Automatic Parameter Injection

If your workflow has a node with an empty `apiKey` parameter, it will be automatically filled:

```json
{
  "workflow": {
    "nodes": [
      {
        "name": "AI Chat",
        "type": "@n8n/n8n-nodes-langchain.chainLlm",
        "parameters": {
          "apiKey": "",  // Will be auto-filled from tokens
          "model": "gpt-4"
        }
      }
    ]
  },
  "tokens": {
    "openAiApiKey": "sk-..."
  }
}
```

### Example 3: Next.js Integration with Token Mapping

```javascript
// Next.js API route
const response = await fetch('http://localhost:3001/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    workflow: workflowJson,
    initialData: { body: { url: 'https://example.com' } },
    tokens: {
      google_oauth_token: userGoogleToken,  // External name
      openai_key: userOpenAIKey,             // External name
    },
    tokenMapping: {
      // Optional: custom mapping if needed
      'custom_token_name': 'googleAccessToken'
    }
  })
});
```

The system will automatically map:
- `google_oauth_token` → `googleAccessToken`
- `openai_key` → `openAiApiKey`

## Security Notes

- Tokens are stored in memory only during workflow execution
- Tokens are not logged (only token keys are logged for debugging)
- For production, ensure your API uses HTTPS
- Consider token expiration and refresh logic in your frontend

## Fallback Behavior

The system uses a three-tier fallback strategy:

1. **Injected Tokens** (highest priority)
   - From `tokens` parameter in API request
   - Automatically injected into node parameters
   - Available via `$tokens` expressions

2. **Environment Variables** (fallback)
   - `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_ACCESS_TOKEN`, etc.
   - Used when tokens are not provided

3. **Error** (if neither available)
   - Node will error if required credentials are missing
   - Allows for flexible deployment (dev uses env vars, production uses injected tokens)

## Workflow Preprocessing

Before execution, the workflow is preprocessed to:
- Evaluate token expressions (`{{ $tokens.tokenName }}`)
- Inject tokens into empty credential parameters
- Map external token names to standardized names
- Process nested parameter objects and arrays

This happens automatically - you don't need to modify your workflow JSON.

