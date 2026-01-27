const httpExecutor = require('./nodeExecutors/http');
const codeExecutor = require('./nodeExecutors/code');
const aiExecutor = require('./nodeExecutors/ai');
const ifExecutor = require('./nodeExecutors/if');
const mergeExecutor = require('./nodeExecutors/merge');
const stickyNoteExecutor = require('./nodeExecutors/stickyNote');
const webhookExecutor = require('./nodeExecutors/webhook');
const setExecutor = require('./nodeExecutors/set');
const outputParserStructuredExecutor = require('./nodeExecutors/outputParserStructured');
const extractFromFileExecutor = require('./nodeExecutors/extractFromFile');
const textSplitterExecutor = require('./nodeExecutors/textSplitter');
const embeddingsExecutor = require('./nodeExecutors/embeddings');
const embeddingsHuggingFaceExecutor = require('./nodeExecutors/embeddingsHuggingFace');
const vectorStoreExecutor = require('./nodeExecutors/vectorStore');
const vectorStoreWeaviateExecutor = require('./nodeExecutors/vectorStoreWeaviate');
const vectorStoreRedisExecutor = require('./nodeExecutors/vectorStoreRedis');
const vectorStoreSupabaseExecutor = require('./nodeExecutors/vectorStoreSupabase');
const anthropicChatExecutor = require('./nodeExecutors/anthropicChat');
const huggingFaceChatExecutor = require('./nodeExecutors/huggingFaceChat');
const toolVectorStoreExecutor = require('./nodeExecutors/toolVectorStore');
const memoryExecutor = require('./nodeExecutors/memory');
const openAiChatExecutor = require('./nodeExecutors/openAiChat');
const agentExecutor = require('./nodeExecutors/agent');
const googleSheetsExecutor = require('./nodeExecutors/googleSheets');
const slackExecutor = require('./nodeExecutors/slack');
const manualTriggerExecutor = require('./nodeExecutors/manualTrigger');
const scheduleTriggerExecutor = require('./nodeExecutors/scheduleTrigger');
const limitExecutor = require('./nodeExecutors/limit');
const waitExecutor = require('./nodeExecutors/wait');
const emailSendExecutor = require('./nodeExecutors/emailSend');
const splitInBatchesExecutor = require('./nodeExecutors/splitInBatches');
const groqChatExecutor = require('./nodeExecutors/groqChat');
const { evaluateExpression } = require('./utils/expressions');
const TokenInjector = require('./utils/tokenInjector');

// Invoice System Manager modules
const invoiceSystemManager = require('./invoice-system-manager');

class WorkflowRunner {
  constructor() {
    this.nodeExecutors = {
      'n8n-nodes-base.httpRequest': httpExecutor,
      'n8n-nodes-base.code': codeExecutor,
      'n8n-nodes-base.function': codeExecutor,
      'n8n-nodes-base.functionItem': codeExecutor,
      '@n8n/n8n-nodes-langchain.chainLlm': aiExecutor,
      '@n8n/n8n-nodes-langchain.lmChatOpenRouter': aiExecutor,
      'n8n-nodes-base.if': ifExecutor,
      'n8n-nodes-base.merge': mergeExecutor,
      'n8n-nodes-base.stickyNote': stickyNoteExecutor,
      'n8n-nodes-base.webhook': webhookExecutor,
      // LangChain nodes
      '@n8n/n8n-nodes-langchain.textSplitterCharacterTextSplitter': textSplitterExecutor,
      '@n8n/n8n-nodes-langchain.embeddingsCohere': embeddingsExecutor,
      '@n8n/n8n-nodes-langchain.embeddingsOpenAi': embeddingsExecutor,
      '@n8n/n8n-nodes-langchain.embeddingsHuggingFace': embeddingsHuggingFaceExecutor,
      '@n8n/n8n-nodes-langchain.vectorStorePinecone': vectorStoreExecutor,
      '@n8n/n8n-nodes-langchain.vectorStoreWeaviate': vectorStoreWeaviateExecutor,
      '@n8n/n8n-nodes-langchain.vectorStoreRedis': vectorStoreRedisExecutor,
      '@n8n/n8n-nodes-langchain.vectorStoreSupabase': vectorStoreSupabaseExecutor,
      '@n8n/n8n-nodes-langchain.toolVectorStore': toolVectorStoreExecutor,
      '@n8n/n8n-nodes-langchain.memoryBufferWindow': memoryExecutor,
      '@n8n/n8n-nodes-langchain.lmChatOpenAi': openAiChatExecutor,
      '@n8n/n8n-nodes-langchain.lmChatAnthropic': anthropicChatExecutor,
      '@n8n/n8n-nodes-langchain.lmChatHf': huggingFaceChatExecutor,
      '@n8n/n8n-nodes-langchain.lmChatGroq': groqChatExecutor,
      '@n8n/n8n-nodes-langchain.agent': agentExecutor,
      '@n8n/n8n-nodes-langchain.outputParserStructured': outputParserStructuredExecutor,
      '@n8n/n8n-nodes-langchain.informationExtractor': invoiceSystemManager.informationExtractor,
      // Data manipulation
      'n8n-nodes-base.set': setExecutor,
      'n8n-nodes-base.extractFromFile': extractFromFileExecutor,
      // Google Sheets
      'n8n-nodes-base.googleSheets': googleSheetsExecutor,
      // Google Drive
      'n8n-nodes-base.googleDrive': invoiceSystemManager.googleDrive,
      'n8n-nodes-base.googleDriveTrigger': invoiceSystemManager.googleDriveTrigger,
      // Gmail
      'n8n-nodes-base.gmailTool': invoiceSystemManager.gmailTool,
      // Slack
      'n8n-nodes-base.slack': slackExecutor,
      // Triggers
      'n8n-nodes-base.manualTrigger': manualTriggerExecutor,
      'n8n-nodes-base.scheduleTrigger': scheduleTriggerExecutor,
      // Flow Control
      'n8n-nodes-base.limit': limitExecutor,
      'n8n-nodes-base.wait': waitExecutor,
      'n8n-nodes-base.splitInBatches': splitInBatchesExecutor,
      // Email
      'n8n-nodes-base.emailSend': emailSendExecutor,
    };

    this.executionContext = {
      nodes: {}, // Store outputs from all executed nodes
      currentNode: null,
      errors: []
    };
  }

  /**
   * Execute a workflow
   * @param {Object} workflow - Workflow JSON object
   * @param {Object} initialData - Initial data (e.g., from webhook)
   * @param {Object} tokens - Authentication tokens to inject
   * @param {Object} tokenMapping - Optional custom token name mapping
   * @returns {Promise<Object>} Execution result
   */
  async execute(workflow, initialData = {}, tokens = {}, tokenMapping = {}) {
    // Initialize token injector with optional custom mapping
    const tokenInjector = new TokenInjector(tokens, tokenMapping);

    // Pre-process workflow to inject tokens into node parameters
    const processedWorkflow = tokenInjector.injectIntoWorkflow(workflow);

    this.executionContext = {
      nodes: {},
      currentNode: null,
      errors: [],
      workflow: processedWorkflow,
      tokens: {},
      // Preserve pre-set values from orchestration (for polling triggers)
      lastPollTime: this.lastPollTime || null,
      processedFiles: this.processedFiles || new Set(),
      initialData: this.initialData || initialData
    };

    // Inject tokens into execution context
    tokenInjector.injectIntoContext(this.executionContext);

    // Store token injector for node executors to access
    this.executionContext.tokenInjector = tokenInjector;

    try {
      // Find entry nodes (nodes with no incoming connections)
      const entryNodes = this.findEntryNodes(processedWorkflow);

      if (entryNodes.length === 0) {
        throw new Error('No entry nodes found in workflow');
      }

      // Execute entry nodes with initial data
      // Format initialData as array of items (like node outputs)
      const formattedInitialData = Array.isArray(initialData)
        ? initialData.map(item => typeof item === 'object' && item.json ? item : { json: item })
        : [{ json: initialData }];

      for (const entryNode of entryNodes) {
        await this.executeNode(entryNode, formattedInitialData);
      }

      // Continue execution following connections
      await this.executeWorkflow(processedWorkflow);

      return {
        success: this.executionContext.errors.length === 0,
        outputs: this.executionContext.nodes,
        errors: this.executionContext.errors
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        outputs: this.executionContext.nodes,
        errors: [...this.executionContext.errors, error.message]
      };
    }
  }

  /**
   * Find entry nodes (nodes with no incoming connections)
   */
  findEntryNodes(workflow) {
    const { nodes, connections } = workflow;
    const connectedNodeIds = new Set();
    const connectedNodeNames = new Set();
    const toolSourceNodes = new Set(); // Nodes that provide tools to agents (should not be entry nodes)

    // Collect all nodes that have incoming connections (main or special)
    if (connections) {
      Object.entries(connections).forEach(([sourceNodeName, nodeConnections]) => {
        // Check main connections
        if (nodeConnections.main) {
          nodeConnections.main.forEach(outputArray => {
            outputArray.forEach(connection => {
              connectedNodeIds.add(connection.node);
              // Also check by node name
              const targetNode = nodes.find(n => n.id === connection.node || n.name === connection.node);
              if (targetNode) {
                connectedNodeNames.add(targetNode.name);
                connectedNodeNames.add(targetNode.id);
              }
            });
          });
        }

        // Check special LangChain connection types
        const specialConnectionTypes = [
          'ai_textSplitter', 'ai_embedding', 'ai_vectorStore',
          'ai_tool', 'ai_memory', 'ai_languageModel', 'ai_document'
        ];

        for (const connectionType of specialConnectionTypes) {
          if (nodeConnections[connectionType]) {
            nodeConnections[connectionType].forEach(outputArray => {
              outputArray.forEach(connection => {
                connectedNodeIds.add(connection.node);
                const targetNode = nodes.find(n => n.id === connection.node || n.name === connection.node);
                if (targetNode) {
                  connectedNodeNames.add(targetNode.name);
                  connectedNodeNames.add(targetNode.id);
                }

                // Track source nodes of ai_tool connections - they should NOT be entry nodes
                // These are tool providers that should only run when called by an agent
                if (connectionType === 'ai_tool') {
                  toolSourceNodes.add(sourceNodeName);
                }
              });
            });
          }
        }
      });
    }

    // Return nodes that are not connected (entry points)
    // Filter out UI-only nodes like stickyNote and tool source nodes
    return nodes.filter(node => {
      // Skip UI-only nodes
      if (node.type === 'n8n-nodes-base.stickyNote') {
        return false;
      }

      // Skip nodes that are sources of ai_tool connections (tool providers)
      if (toolSourceNodes.has(node.name) || toolSourceNodes.has(node.id)) {
        return false;
      }

      return !connectedNodeIds.has(node.name) &&
        !connectedNodeIds.has(node.id) &&
        !connectedNodeNames.has(node.name) &&
        !connectedNodeNames.has(node.id);
    });
  }

  /**
   * Execute workflow following connections
   * @param {Object} workflow - Pre-processed workflow
   */
  async executeWorkflow(workflow) {
    const { connections } = workflow;
    if (!connections) return;

    const executedNodes = new Set(Object.keys(this.executionContext.nodes));
    let hasChanges = true;
    let iteration = 0;
    const MAX_ITERATIONS = 1000; // Safety limit to prevent infinite loops

    // Keep executing until no more nodes can be executed
    while (hasChanges) {
      hasChanges = false;
      iteration += 1;

      // Safety check: prevent infinite loops
      if (iteration > MAX_ITERATIONS) {
        const unexecutedNodes = workflow.nodes
          .filter(n => !executedNodes.has(n.name) && !executedNodes.has(n.id))
          .map(n => n.name || n.id);
        throw new Error(
          `Workflow execution exceeded maximum iterations (${MAX_ITERATIONS}). ` +
          `Possible circular dependency or unsatisfiable nodes: ${unexecutedNodes.join(', ')}`
        );
      }

      // First, process nodes that have outgoing connections (sources)
      for (const [nodeName, nodeConnections] of Object.entries(connections)) {
        // Skip if already executed
        if (executedNodes.has(nodeName)) continue;

        // Check if all input nodes have been executed
        const canExecute = this.canExecuteNode(nodeName, workflow, executedNodes);

        if (canExecute) {
          const node = workflow.nodes.find(n => n.name === nodeName);
          if (node) {
            // Get input data from connected nodes
            const inputData = this.getInputData(nodeName, workflow);

            // Skip execution if node has no input data (e.g., trigger returned empty)
            // Exception: trigger nodes and webhook nodes can execute with empty input
            const isTriggerOrWebhook = node.type && (
              node.type.includes('Trigger') ||
              node.type.includes('webhook') ||
              node.type === 'n8n-nodes-base.manualTrigger'
            );

            if (!isTriggerOrWebhook && inputData.length === 0) {
              console.log(`[Runner] Skipping node '${node.name}' - no input data from upstream nodes`);
              // Store empty output to prevent downstream nodes from executing
              this.executionContext.nodes[nodeName] = [];
              if (node.id && node.id !== nodeName) {
                this.executionContext.nodes[node.id] = [];
              }
              executedNodes.add(nodeName); // Mark as executed to prevent infinite loop
              hasChanges = true;
              continue;
            }

            await this.executeNode(node, inputData);
            executedNodes.add(nodeName);
            hasChanges = true;
          }
        }
      }

      // Also check nodes that are targets but don't have outgoing connections (sinks)
      // These nodes won't appear in the connections object as keys
      for (const node of workflow.nodes) {
        const nodeName = node.name || node.id;
        // Skip if already executed or is a UI-only node
        if (executedNodes.has(nodeName) ||
          executedNodes.has(node.id) ||
          node.type === 'n8n-nodes-base.stickyNote') {
          continue;
        }

        // Skip if this node has outgoing connections (already processed above)
        if (connections[nodeName] || connections[node.id]) {
          continue;
        }

        // Check if all input nodes have been executed
        const canExecute = this.canExecuteNode(nodeName, workflow, executedNodes);

        if (canExecute) {
          // Get input data from connected nodes
          const inputData = this.getInputData(nodeName, workflow);

          // Skip execution if node has no input data (propagate empty from upstream)
          // This prevents sink nodes from executing when upstream nodes returned no data
          const isTriggerOrWebhook = node.type && (
            node.type.includes('Trigger') ||
            node.type.includes('webhook') ||
            node.type === 'n8n-nodes-base.manualTrigger'
          );

          if (!isTriggerOrWebhook && inputData.length === 0) {
            console.log(`[Runner] Skipping sink node '${node.name}' - no input data from upstream nodes`);
            // Store empty output to prevent downstream nodes from executing
            this.executionContext.nodes[nodeName] = [];
            if (node.id && nodeName !== node.id) {
              this.executionContext.nodes[node.id] = [];
            }
            executedNodes.add(nodeName);
            if (node.id && nodeName !== node.id) {
              executedNodes.add(node.id);
            }
            hasChanges = true;
            continue;
          }

          await this.executeNode(node, inputData);
          executedNodes.add(nodeName);
          if (node.id && nodeName !== node.id) {
            executedNodes.add(node.id);
          }
          hasChanges = true;
        }
      }
    }
  }

  /**
   * Check if a node can be executed (all dependencies are met)
   */
  canExecuteNode(nodeName, workflow, executedNodes) {
    const { connections } = workflow;
    const node = workflow.nodes.find(n => n.name === nodeName || n.id === nodeName);

    // Find all nodes that connect to this node (via main or special connections)
    for (const [sourceNodeName, nodeConnections] of Object.entries(connections)) {
      // Check main connections
      if (nodeConnections.main) {
        for (const outputArray of nodeConnections.main) {
          for (const connection of outputArray) {
            if (connection.node === nodeName ||
              (node && (connection.node === node.id || connection.node === node.name))) {
              // This node depends on sourceNodeName via main connection
              if (!executedNodes.has(sourceNodeName)) {
                return false;
              }
            }
          }
        }
      }

      // Check special LangChain connection types
      const specialConnectionTypes = [
        'ai_textSplitter', 'ai_embedding', 'ai_vectorStore',
        'ai_tool', 'ai_memory', 'ai_languageModel', 'ai_document'
      ];

      for (const connectionType of specialConnectionTypes) {
        if (nodeConnections[connectionType]) {
          for (const outputArray of nodeConnections[connectionType]) {
            for (const connection of outputArray) {
              if (connection.node === nodeName ||
                (node && (connection.node === node.id || connection.node === node.name))) {
                // This node depends on sourceNodeName via special connection
                if (!executedNodes.has(sourceNodeName)) {
                  return false;
                }
              }
            }
          }
        }
      }
    }

    return true;
  }

  /**
   * Get input data for a node from its connected nodes
   */
  getInputData(nodeName, workflow) {
    const { connections } = workflow;
    const inputData = [];
    const node = workflow.nodes.find(n => n.name === nodeName || n.id === nodeName);

    // Find all nodes that connect to this node
    for (const [sourceNodeName, nodeConnections] of Object.entries(connections)) {
      // Check main connections
      if (nodeConnections.main) {
        // main is an array where each element represents an output branch
        // For If nodes: [0] = true branch, [1] = false branch
        for (let outputIndex = 0; outputIndex < nodeConnections.main.length; outputIndex++) {
          const outputArray = nodeConnections.main[outputIndex];
          for (const connection of outputArray) {
            // Match by name or id
            const matchesNode = connection.node === nodeName ||
              (node && (connection.node === node.id || connection.node === node.name));

            if (matchesNode) {
              const sourceOutput = this.executionContext.nodes[sourceNodeName];
              if (sourceOutput) {
                // For nodes with multiple outputs (like If), check if this connection
                // is for the specific output index
                // If node: outputIndex 0 = true (has data), outputIndex 1 = false (empty)
                // Only add data if the output has data (non-empty array)
                if (sourceOutput.length > 0) {
                  inputData.push(...sourceOutput);
                }
              }
            }
          }
        }
      }

      // Check special LangChain connection types
      // These are used for passing data between LangChain nodes
      const specialConnectionTypes = [
        'ai_textSplitter', 'ai_embedding', 'ai_vectorStore',
        'ai_tool', 'ai_memory', 'ai_languageModel', 'ai_document'
      ];

      for (const connectionType of specialConnectionTypes) {
        if (nodeConnections[connectionType]) {
          for (const outputArray of nodeConnections[connectionType]) {
            for (const connection of outputArray) {
              const matchesNode = connection.node === nodeName ||
                (node && (connection.node === node.id || connection.node === node.name));

              if (matchesNode) {
                const sourceOutput = this.executionContext.nodes[sourceNodeName];
                if (sourceOutput && sourceOutput.length > 0) {
                  // For special connections, we still pass the data through
                  // The executor will handle the connection type appropriately
                  inputData.push(...sourceOutput);
                }
              }
            }
          }
        }
      }
    }

    return inputData.length > 0 ? inputData : [];
  }

  /**
   * Execute a single node
   */
  async executeNode(node, inputData = []) {
    this.executionContext.currentNode = node;

    try {
      // Get executor for this node type
      const executor = this.nodeExecutors[node.type];

      if (!executor) {
        throw new Error(`No executor found for node type: ${node.type}`);
      }

      // Execute the node
      const output = await executor.execute(node, inputData, this.executionContext);

      // Store output in execution context (by both name and id for flexibility)
      const nodeKey = node.name || node.id;
      this.executionContext.nodes[nodeKey] = output || [];
      if (node.name && node.id && node.name !== node.id) {
        this.executionContext.nodes[node.id] = output || [];
      }

      // If this is a trigger node and it returned empty results, log it
      if (node.type && node.type.includes('Trigger') && (!output || output.length === 0)) {
        console.log(`[Runner] Trigger node '${node.name}' returned no results - workflow will stop here`);
      }

      return output;
    } catch (error) {
      // Handle errors based on node's error handling settings
      const onError = node.onError || 'stop';

      // Check if this is an API key error - for structural testing, continue execution
      const isApiKeyError = error.message.includes('API_KEY') ||
        error.message.includes('API key') ||
        error.message.includes('not provided') ||
        error.message.includes('access token');

      if (onError === 'continueErrorOutput' || isApiKeyError) {
        // Continue execution but store error
        this.executionContext.errors.push({
          node: node.name,
          error: error.message
        });
        this.executionContext.nodes[node.name] = [{
          json: { error: error.message }
        }];
        return [{ json: { error: error.message } }];
      } else {
        // Stop execution
        throw error;
      }
    }
  }
}

module.exports = WorkflowRunner;

