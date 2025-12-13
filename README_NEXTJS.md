# Next.js Integration Guide

## Quick Start

Your Next.js application needs to send:

1. **Workflow JSON** - The simplified workflow file (`test-survey-simplified-workflow.json`)
2. **Google Access Token** - For Google Sheets operations
3. **OpenAI API Key** - For AI/LLM operations

## Request Format

```typescript
POST http://localhost:3001/execute

{
  "workflow": { /* workflow JSON object */ },
  "initialData": { /* optional: data for entry nodes */ },
  "tokens": {
    "googleAccessToken": "ya29...",
    "openAiApiKey": "sk-..."
  }
}
```

## Example: Next.js API Route

Create `app/api/execute-workflow/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const { workflow, initialData, tokens } = await request.json();

  const response = await fetch('http://localhost:3001/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflow,
      initialData: initialData || {},
      tokens: {
        googleAccessToken: tokens.googleAccessToken,
        openAiApiKey: tokens.openAiApiKey,
      },
    }),
  });

  return NextResponse.json(await response.json());
}
```

## Example: Client Component

```typescript
'use client';

import surveyWorkflow from '@/data/test-survey-simplified-workflow.json';

export default function WorkflowPage() {
  const executeWorkflow = async () => {
    const tokens = {
      googleAccessToken: 'your-google-token',
      openAiApiKey: 'your-openai-key',
    };

    const response = await fetch('/api/execute-workflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflow: surveyWorkflow,
        initialData: {
          body: {
            survey_data: "What is your favorite language?"
          }
        },
        tokens,
      }),
    });

    const result = await response.json();
    console.log(result);
  };

  return <button onClick={executeWorkflow}>Execute Workflow</button>;
}
```

## Important Notes

1. **Workflow File**: Import or load `test-survey-simplified-workflow.json` in your Next.js app
2. **Tokens**: Always send tokens separately, never hardcode in workflow JSON
3. **CORS**: Automation Runner accepts requests from `http://localhost:3000` by default
4. **Security**: In production, handle tokens server-side only

## Response Format

```typescript
{
  success: boolean,
  outputs: {
    "Node Name": [{ json: { ... } }]
  },
  errors: [
    { node: "Node Name", error: "Error message" }
  ]
}
```

