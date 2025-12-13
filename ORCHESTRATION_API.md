# Orchestration API - Full Automation Runner

## Overview

The `/api/automations/run` endpoint provides a complete orchestration solution where your Next.js app (localhost:3000) only needs to send three parameters, and the automation-runner handles everything else.

**NEW: n8n Compatibility Layer** - Automatically resolves credential placeholders and prevents field conflicts!

## What the Automation Runner Does

1. ✅ **Fetches workflow from database** using `automation_id`
2. ✅ **Fetches developer keys** from `automations.developer_keys`
3. ✅ **Resolves credential placeholders** - Converts `{{OPEN_ROUTER_API_KEY}}` → actual API key
4. ✅ **Fetches user OAuth tokens** using `user_id` from `user_integrations` table
5. ✅ **Performs placeholder replacement** with config values
6. ✅ **Nests config under body** for webhook structure
7. ✅ **Prevents field conflicts** - Renames HTTP `status` to `httpStatus` to avoid overwrites
8. ✅ **Executes the workflow**
9. ✅ **Returns summary** (filters out binary data)

## API Endpoint

```
POST http://localhost:3001/api/automations/run
```

## Request Format

```json
{
  "automation_id": "uuid-of-automation",
  "user_id": "uuid-of-user",
  "config": {
    "param1": "value1",
    "param2": "value2"
  }
}
```

## Response Format

### Success Response

```json
{
  "success": true,
  "automation_id": "uuid-of-automation",
  "user_id": "uuid-of-user",
  "outputs": {
    "Node Name 1": [
      { "json": { "result": "some data" } }
    ],
    "Node Name 2": [
      { "json": { "output": "more data" } }
    ]
  },
  "errors": [],
  "executed_at": "2024-12-11T10:30:00.000Z"
}
```

### Error Response

```json
{
  "success": false,
  "error": "Error message here",
  "automation_id": "uuid-of-automation",
  "user_id": "uuid-of-user"
}
```

## Next.js Integration Example

### API Route Handler (`app/api/run-automation/route.ts`)

```typescript
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { automation_id, user_id, config } = body;

    // Validate inputs
    if (!automation_id || !user_id) {
      return NextResponse.json(
        { error: 'automation_id and user_id are required' },
        { status: 400 }
      );
    }

    // Call automation runner
    const response = await fetch('http://localhost:3001/api/automations/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        automation_id,
        user_id,
        config: config || {},
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      return NextResponse.json(result, { status: response.status });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Automation execution error:', error);
    return NextResponse.json(
      { error: 'Failed to execute automation' },
      { status: 500 }
    );
  }
}
```

### Client-Side Usage (`components/AutomationRunner.tsx`)

```typescript
'use client';

import { useState } from 'react';

export function AutomationRunner() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const runAutomation = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/run-automation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          automation_id: 'your-automation-id',
          user_id: 'your-user-id',
          config: {
            jobTitle: 'Software Engineer',
            requiredSkills: 'React, TypeScript',
            minimumExperience: '3',
            suitabilityThreshold: 75
          },
        }),
      });

      const data = await response.json();
      setResult(data);
    } catch (error) {
      console.error('Error:', error);
      setResult({ success: false, error: 'Network error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button onClick={runAutomation} disabled={loading}>
        {loading ? 'Running...' : 'Run Automation'}
      </button>
      
      {result && (
        <div>
          <h3>Result:</h3>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
```

## Database Schema Requirements

### Table: `automations`

```sql
CREATE TABLE automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  description TEXT,
  workflow JSONB NOT NULL,
  developer_keys JSONB, -- Stores API keys like {"OPEN_ROUTER_API_KEY": "sk-or-v1-..."}
  required_connectors JSONB,
  author TEXT,
  price DECIMAL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Example `developer_keys` format:**
```json
{
  "OPEN_ROUTER_API_KEY": "sk-or-v1-...",
  "OPENAI_API_KEY": "sk-...",
  "ANTHROPIC_API_KEY": "sk-ant-..."
}
```

### Table: `user_integrations`

```sql
CREATE TABLE user_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  provider TEXT NOT NULL, -- e.g., "google", "slack"
  provider_id TEXT,
  provider_email TEXT,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Environment Variables

Make sure your automation-runner has these configured in `.env`:

```env
SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
PORT=3001
ALLOWED_ORIGIN=http://localhost:3000
```

## How Config/Placeholders Work

The `config` object you send will be:

1. **Nested under `body`** for webhook nodes to access via `{{$json.body.paramName}}`
2. **Used for placeholder replacement** in node parameters (e.g., `{{paramName}}`)

### Example Workflow Configuration

If your workflow has a node with parameter:
```
"Evaluate candidate for: {{jobTitle}}"
```

And you send:
```json
{
  "config": {
    "jobTitle": "Software Engineer"
  }
}
```

It becomes:
```
"Evaluate candidate for: Software Engineer"
```

## Binary Data Handling

The API automatically filters out binary data to keep responses lightweight:

- Fields with `base64`, `binary`, or `Buffer` in the name → `"<binary data omitted>"`
- Strings longer than 1000 characters → truncated with `"... (truncated)"`

## Error Handling

Common error scenarios:

| Error | Status | Meaning |
|-------|--------|---------|
| `automation_id is required` | 400 | Missing automation_id in request |
| `user_id is required` | 400 | Missing user_id in request |
| `Automation not found` | 404 | automation_id doesn't exist in DB |
| `Database not configured` | 500 | Missing Supabase credentials |
| `No language model connected` | 500 | Workflow missing required nodes |

## Testing

### Using cURL

```bash
curl -X POST http://localhost:3001/api/automations/run \
  -H "Content-Type: application/json" \
  -d '{
    "automation_id": "your-uuid-here",
    "user_id": "user-uuid-here",
    "config": {
      "jobTitle": "Software Engineer",
      "requiredSkills": "React, Node.js"
    }
  }'
```

### Using Postman

1. Method: `POST`
2. URL: `http://localhost:3001/api/automations/run`
3. Headers: `Content-Type: application/json`
4. Body (raw JSON):
```json
{
  "automation_id": "your-uuid",
  "user_id": "user-uuid",
  "config": {
    "key": "value"
  }
}
```

## Benefits

✅ **Simplified Next.js Integration** - Only 3 parameters needed  
✅ **Secure** - Tokens stored in database, not sent over wire  
✅ **Automatic Token Injection** - Runner fetches and applies tokens  
✅ **Placeholder Support** - Config values replace workflow placeholders  
✅ **Clean Responses** - Binary data filtered automatically  
✅ **Webhook Compatible** - Config nested under body structure  

## What Your Next.js App Does

❌ Doesn't fetch workflow  
❌ Doesn't fetch tokens  
❌ Doesn't replace placeholders  
❌ Doesn't handle binary data  

✅ Only sends: `automation_id`, `user_id`, `config`  
✅ Receives: Clean summary result
