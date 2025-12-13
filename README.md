# Automation Runner

A Node.js microservice that executes user-created workflows independently from your main application. This keeps your main app fast and stable while handling complex automation tasks.

## Architecture

```
Next.js Backend → Automation Runner → External APIs
```

The Automation Runner:
- Receives workflow execution requests
- Loads workflow definitions (JSON)
- Executes nodes sequentially
- Handles data passing between nodes
- Returns results or errors

## Features

- ✅ **HTTP Node Executor** - Make GET, POST, PUT, DELETE requests
- ✅ **Code Node Executor** - Execute JavaScript with access to previous nodes
- ✅ **AI Node Executor** - LLM/AI API calls (OpenRouter)
- ✅ **If Node Executor** - Conditional routing
- ✅ **Merge Node Executor** - Combine data from multiple sources
- ✅ **Expression Evaluator** - Dynamic values like `{{ $json.field }}`
- ✅ **Queue System** - Async job processing with BullMQ
- ✅ **Error Handling** - Graceful error handling with continue options

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file:

```env
PORT=3001
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
OPENROUTER_API_KEY=your-api-key-here
OPENROUTER_REFERER=https://your-app.com
```

## Usage

### Start the server

```bash
npm start
```

### Execute a workflow (synchronous)

```bash
POST http://localhost:3001/execute
Content-Type: application/json

{
  "workflow": {
    "name": "My Workflow",
    "nodes": [...],
    "connections": {...}
  },
  "initialData": {
    "tiktok_url": "https://..."
  }
}
```

### Queue a workflow (asynchronous)

```bash
POST http://localhost:3001/queue
Content-Type: application/json

{
  "workflow": {...},
  "initialData": {...}
}

# Response: { "jobId": "123", ... }
```

### Check job status

```bash
GET http://localhost:3001/status/:jobId
```

## Workflow Structure

A workflow consists of:

- **nodes**: Array of node definitions
- **connections**: Object mapping node connections
- **settings**: Workflow settings (optional)

### Node Structure

```json
{
  "id": "unique-id",
  "name": "Node Name",
  "type": "n8n-nodes-base.httpRequest",
  "parameters": {
    "url": "={{ $json.url }}",
    "method": "GET"
  },
  "position": [x, y]
}
```

### Connections Structure

```json
{
  "Source Node": {
    "main": [
      [
        {
          "node": "Target Node",
          "type": "main",
          "index": 0
        }
      ]
    ]
  }
}
```

## Supported Node Types

### HTTP Request (`n8n-nodes-base.httpRequest`)
- Methods: GET, POST, PUT, DELETE, etc.
- Headers, body, query parameters
- Binary data support
- Response format options

### Code (`n8n-nodes-base.code`)
- Execute JavaScript
- Access to `$input`, `$json`, `$('NodeName')`
- Sandboxed execution (vm2)

### AI/LLM (`@n8n/n8n-nodes-langchain.*`)
- OpenRouter API integration
- LLM Chain nodes
- Model configuration

### If (`n8n-nodes-base.if`)
- Conditional routing
- Multiple conditions (AND/OR)
- Operators: equals, contains, greaterThan, etc.

### Merge (`n8n-nodes-base.merge`)
- Combine data from multiple inputs
- Multiple merge modes

## Expression System

The runner supports dynamic expressions:

- `{{ $json.field }}` - Current node's output
- `{{ $('NodeName').item.json.field }}` - Reference previous node
- `{{ $input.first().json.field }}` - Access input data

## Queue System

Uses BullMQ with Redis for:
- Async job processing
- Job retries (3 attempts)
- Job status tracking
- Concurrent execution (5 jobs)

## Error Handling

Nodes can specify error handling:
- `onError: "stop"` - Stop execution (default)
- `onError: "continueErrorOutput"` - Continue with error in output

## Development

The codebase is organized as:

```
src/
  ├── index.js              # HTTP server
  ├── runner.js             # Core execution engine
  ├── queue.js              # Job queue system
  ├── nodeExecutors/        # Node type executors
  │   ├── http.js
  │   ├── code.js
  │   ├── ai.js
  │   ├── if.js
  │   └── merge.js
  └── utils/
      └── expressions.js    # Expression evaluator
```

## Adding New Node Types

1. Create a new executor in `nodeExecutors/`
2. Export an `execute(node, inputData, executionContext)` function
3. Register it in `runner.js`:

```javascript
this.nodeExecutors = {
  'your-node-type': require('./nodeExecutors/your-node'),
  // ...
};
```

## Future Enhancements

- [ ] Parallel node execution
- [ ] More node types (database, file operations, etc.)
- [ ] Workflow versioning
- [ ] Execution logs and monitoring
- [ ] Webhook support
- [ ] Scheduled workflows

## License

ISC

# automation-runner
# automation-runner
# automation-runner
