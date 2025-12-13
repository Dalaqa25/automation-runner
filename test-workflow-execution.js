const fs = require('fs');
const path = require('path');
const WorkflowRunner = require('./src/runner');

async function testWorkflowExecution() {
  // Load the workflow JSON
  const workflowPath = path.join(__dirname, '../n8n-free-templates/Media/ad_campaign_performance_alert.json');
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

  console.log(`\n🧪 Testing Workflow Execution: ${workflow.name}\n`);
  console.log('=' .repeat(60));

  // Prepare initial data (what the webhook would receive)
  const initialData = {
    body: {
      campaign_id: "campaign_123",
      performance_data: "Campaign performance: CTR increased by 15%, conversions up 20%. Budget spent: $5000 of $10000."
    }
  };

  // No tokens provided - we want to see structural errors
  const tokens = {};

  // Create runner and execute
  const runner = new WorkflowRunner();
  
  console.log('🚀 Starting workflow execution...\n');
  
  // Add debug logging to runner
  const originalExecuteNode = runner.executeNode.bind(runner);
  runner.executeNode = async function(node, inputData) {
    console.log(`   🔄 Attempting to execute: ${node.name || node.id} (${node.type})`);
    try {
      const result = await originalExecuteNode(node, inputData);
      console.log(`   ✅ Successfully executed: ${node.name || node.id}`);
      return result;
    } catch (error) {
      console.log(`   ❌ Failed to execute: ${node.name || node.id} - ${error.message}`);
      throw error;
    }
  };
  
  try {
    const result = await runner.execute(workflow, initialData, tokens);

    console.log('\n📊 Execution Results:');
    console.log(`   Success: ${result.success}`);
    console.log(`   Errors: ${result.errors?.length || 0}`);
    
    if (result.errors && result.errors.length > 0) {
      console.log('\n❌ Errors Found:');
      result.errors.forEach((error, i) => {
        const errorStr = typeof error === 'string' ? error : 
                        (error.error || error.message || JSON.stringify(error));
        console.log(`\n   ${i + 1}. ${errorStr}`);
      });
    }

    if (result.outputs) {
      console.log(`\n📤 Node Outputs (${Object.keys(result.outputs).length} nodes executed):`);
      
      // Get all node names from workflow for reference
      const workflowNodeNames = {};
      workflow.nodes.forEach(node => {
        workflowNodeNames[node.name] = node.type;
        if (node.id) {
          workflowNodeNames[node.id] = node.type;
        }
      });
      
      Object.entries(result.outputs).forEach(([nodeName, output]) => {
        const outputCount = Array.isArray(output) ? output.length : 0;
        const hasError = output && output.length > 0 && output[0].json?.error;
        const status = hasError ? '❌' : '✅';
        const nodeType = workflowNodeNames[nodeName] || 'unknown';
        console.log(`   ${status} ${nodeName} (${nodeType}): ${outputCount} item(s)`);
        
        if (hasError) {
          console.log(`      Error: ${output[0].json.error}`);
        } else if (output && output.length > 0 && output[0].json) {
          const preview = JSON.stringify(output[0].json).substring(0, 80);
          console.log(`      Preview: ${preview}...`);
        }
      });
      
      // Check which nodes from workflow didn't execute
      const executedNodeNames = new Set(Object.keys(result.outputs));
      const missingNodes = workflow.nodes.filter(node => {
        const name = node.name || node.id;
        return !executedNodeNames.has(name) && 
               !executedNodeNames.has(node.id) &&
               node.type !== 'n8n-nodes-base.stickyNote';
      });
      
      if (missingNodes.length > 0) {
        console.log(`\n⚠️  Nodes not executed (${missingNodes.length}):`);
        missingNodes.forEach(node => {
          console.log(`   - ${node.name || node.id} (${node.type})`);
        });
      }
    }

    // Analyze errors
    console.log('\n\n🔍 Error Analysis:');
    console.log('=' .repeat(60));
    
    if (result.errors && result.errors.length > 0) {
      const apiKeyErrors = [];
      const structuralErrors = [];
      
      result.errors.forEach(error => {
        const errorStr = typeof error === 'string' ? error : error.error || JSON.stringify(error);
        
        // Check if it's an API key error
        if (errorStr.includes('API_KEY') || 
            errorStr.includes('API key') ||
            errorStr.includes('not provided') ||
            errorStr.includes('COHERE_API_KEY') ||
            errorStr.includes('PINECONE_API_KEY') ||
            errorStr.includes('OPENAI_API_KEY') ||
            errorStr.includes('GOOGLE_ACCESS_TOKEN') ||
            errorStr.includes('access token')) {
          apiKeyErrors.push(errorStr);
        } else {
          structuralErrors.push(errorStr);
        }
      });

      if (apiKeyErrors.length > 0) {
        console.log('\n✅ API Key Errors (Expected - No Fix Needed):');
        apiKeyErrors.forEach((error, i) => {
          console.log(`   ${i + 1}. ${error}`);
        });
      }

      if (structuralErrors.length > 0) {
        console.log('\n❌ Structural Errors (Need to Fix):');
        structuralErrors.forEach((error, i) => {
          console.log(`   ${i + 1}. ${error}`);
        });
      } else {
        console.log('\n✅ No structural errors found!');
        console.log('   All failures are due to missing API keys (expected).');
      }
    } else {
      console.log('\n✅ No errors found!');
    }

    console.log('\n' + '='.repeat(60));
    console.log('\n✅ Test completed!\n');
    
  } catch (error) {
    console.error('\n❌ Execution failed with exception:', error.message);
    console.error(error.stack);
    
    // Check if it's a structural error
    if (!error.message.includes('API_KEY') && 
        !error.message.includes('API key') &&
        !error.message.includes('not provided')) {
      console.log('\n⚠️  This appears to be a structural error (not API key related)');
    }
  }
}

// Run the test
testWorkflowExecution().catch(console.error);

