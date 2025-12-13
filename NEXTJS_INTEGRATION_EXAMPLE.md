# Next.js Integration Example

This guide shows how to call the Automation Runner API from your Next.js application.

## API Endpoint

The Automation Runner exposes a POST endpoint at:
```
http://localhost:3001/execute
```

## Request Format

```typescript
{
  workflow: { ... },           // The workflow JSON object
  initialData: { ... },        // Optional: initial data for entry nodes
  tokens: { ... },            // Required: API keys and tokens
  tokenMapping: { ... }       // Optional: custom token name mapping
}
```

## Example: Next.js API Route

Create a file `app/api/execute-workflow/route.ts` (or `pages/api/execute-workflow.ts` for Pages Router):

```typescript
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { workflow, initialData, tokens } = body;

    // Call the Automation Runner
    const response = await fetch('http://localhost:3001/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workflow,
        initialData: initialData || {},
        tokens: {
          googleAccessToken: tokens.googleAccessToken,
          openAiApiKey: tokens.openAiApiKey,
        },
        // Optional: if your Next.js app uses different token names
        tokenMapping: {
          // 'google_oauth_token': 'googleAccessToken',
          // 'openai_key': 'openAiApiKey',
        }
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: result.error || 'Workflow execution failed' },
        { status: response.status }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error executing workflow:', error);
    return NextResponse.json(
      { error: 'Failed to execute workflow', details: error.message },
      { status: 500 }
    );
  }
}
```

## Example: Client-Side Call

```typescript
// In your Next.js component or client-side code
async function executeWorkflow() {
  // Load the workflow JSON (you can import it or fetch it)
  const workflow = await import('./survey-simplified-workflow.json');
  
  // Get tokens from your auth system or user input
  const tokens = {
    googleAccessToken: 'ya29.a0ATi6K2ud7kwTfHBKIeIoBS2mxVQq-...',
    openAiApiKey: 'sk-...',
  };

  // Initial data (optional)
  const initialData = {
    body: {
      survey_data: "What is your favorite programming language? JavaScript, Python, Java"
    }
  };

  try {
    const response = await fetch('/api/execute-workflow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workflow: workflow.default || workflow,
        initialData,
        tokens,
      }),
    });

    const result = await response.json();

    if (result.success) {
      console.log('✅ Workflow executed successfully!');
      console.log('Outputs:', result.outputs);
    } else {
      console.error('❌ Workflow execution failed');
      console.error('Errors:', result.errors);
    }

    return result;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}
```

## Example: Server-Side (Server Component or API Route)

```typescript
// app/workflow/page.tsx or similar
import { workflow } from '@/data/survey-simplified-workflow.json';

export default async function WorkflowPage() {
  // Get tokens from your auth system
  const tokens = {
    googleAccessToken: process.env.GOOGLE_ACCESS_TOKEN || '',
    openAiApiKey: process.env.OPENAI_API_KEY || '',
  };

  const initialData = {
    body: {
      survey_data: "Test survey data"
    }
  };

  // Call Automation Runner directly
  const response = await fetch('http://localhost:3001/execute', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      workflow,
      initialData,
      tokens,
    }),
  });

  const result = await response.json();

  return (
    <div>
      <h1>Workflow Execution Result</h1>
      <pre>{JSON.stringify(result, null, 2)}</pre>
    </div>
  );
}
```

## Token Mapping

If your Next.js app uses different token names, you can map them:

```typescript
const tokens = {
  google_oauth_token: 'ya29...',  // Your Next.js token name
  openai_key: 'sk-...',           // Your Next.js token name
};

const tokenMapping = {
  'google_oauth_token': 'googleAccessToken',
  'openai_key': 'openAiApiKey',
};

// The Automation Runner will automatically map these
fetch('http://localhost:3001/execute', {
  method: 'POST',
  body: JSON.stringify({
    workflow,
    tokens,
    tokenMapping,  // Optional: helps with mapping
  }),
});
```

## Response Format

```typescript
{
  success: boolean,
  outputs: {
    "Node Name": [
      {
        json: { ... }  // Node output data
      }
    ]
  },
  errors: [
    {
      node: "Node Name",
      error: "Error message"
    }
  ]
}
```

## Important Notes

1. **Workflow JSON**: Make sure to send the complete workflow JSON object (the one from `test-survey-simplified-workflow.json`)

2. **Tokens**: Always send tokens in the `tokens` object, never in the workflow JSON itself

3. **CORS**: The Automation Runner is configured to accept requests from `http://localhost:3000` by default. Update `ALLOWED_ORIGIN` in `.env` if needed

4. **Security**: In production, never expose tokens to the client. Always call the Automation Runner from your Next.js API routes (server-side)

5. **Error Handling**: The workflow will continue execution even if some nodes fail (depending on error handling settings)

## Testing

1. Start the Automation Runner:
   ```bash
   cd automation-runner
   npm start
   ```

2. In your Next.js app, call the API with your workflow JSON and tokens

3. Check the Automation Runner console for execution logs

