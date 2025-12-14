require('dotenv').config();
const WorkflowRunner = require('./src/runner');
const fs = require('fs');

async function testWorkflow() {
  console.log('=== Testing Cold Email Workflow ===\n');

  // Load the workflow
  const workflowJson = fs.readFileSync('Zero-Cost Cold Email Machine (300 Leads_Day).json', 'utf8');
  const workflow = JSON.parse(workflowJson);

  console.log(`Workflow: ${workflow.nodes.length} nodes, ${Object.keys(workflow.connections).length} connections\n`);

  // List all node types
  const nodeTypes = [...new Set(workflow.nodes.map(n => n.type))];
  console.log('Node types used:');
  nodeTypes.forEach(type => {
    const count = workflow.nodes.filter(n => n.type === type).length;
    console.log(`  - ${type} (${count}x)`);
  });

  // Check if runner supports all node types
  const runner = new WorkflowRunner();
  const unsupportedTypes = nodeTypes.filter(type => !runner.nodeExecutors[type]);
  
  console.log('\n=== Executor Support ===');
  if (unsupportedTypes.length === 0) {
    console.log('✅ All node types are supported!');
  } else {
    console.log('❌ Unsupported node types:');
    unsupportedTypes.forEach(type => console.log(`  - ${type}`));
  }

  // Find entry nodes
  const entryNodes = runner.findEntryNodes(workflow);
  console.log(`\n=== Entry Nodes ===`);
  entryNodes.forEach(node => {
    console.log(`  - ${node.name} (${node.type})`);
  });

  console.log('\n=== Workflow Structure Test Complete ===');
  console.log('\nNote: To actually run this workflow, you need to:');
  console.log('1. Set up SMTP credentials (SMTP_USER, SMTP_PASSWORD)');
  console.log('2. Set up Google OAuth token (GOOGLE_ACCESS_TOKEN)');
  console.log('3. Replace hardcoded API keys in the workflow JSON');
  console.log('4. Use POST /execute endpoint with the workflow');
}

testWorkflow().catch(console.error);
