const WorkflowRunner = require('./src/runner');
const fs = require('fs');
const path = require('path');

// Load the simplified workflow
const workflowPath = path.join(__dirname, 'test-survey-simplified-workflow.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

// Test tokens (you'll need to provide these)
const tokens = {
  googleAccessToken: process.env.GOOGLE_ACCESS_TOKEN || '',
  openAiApiKey: process.env.OPENAI_API_KEY || ''
};

// Test initial data
const initialData = {
  body: {
    survey_data: "What is your favorite programming language? JavaScript, Python, Java"
  }
};

async function testWorkflow() {
  console.log('🧪 Testing simplified Survey Auto Analyze workflow...\n');
  
  // Check if tokens are provided
  if (!tokens.googleAccessToken) {
    console.warn('⚠️  Warning: GOOGLE_ACCESS_TOKEN not provided (Google Sheets operations may fail)');
  }
  if (!tokens.openAiApiKey) {
    console.warn('⚠️  Warning: OPENAI_API_KEY not provided (OpenAI operations may fail)');
  }
  
  console.log('📋 Workflow nodes:');
  workflow.nodes.forEach(node => {
    if (node.type !== 'n8n-nodes-base.stickyNote') {
      console.log(`   - ${node.name} (${node.type})`);
    }
  });
  
  console.log('\n🚀 Executing workflow...\n');
  
  try {
    const runner = new WorkflowRunner();
    const result = await runner.execute(workflow, initialData, tokens);
    
    console.log('✅ Execution completed!\n');
    console.log('📊 Results:');
    console.log(`   Success: ${result.success}`);
    console.log(`   Errors: ${result.errors.length}`);
    
    if (result.errors.length > 0) {
      console.log('\n❌ Errors:');
      result.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error.node || 'Unknown'}: ${error.error || error}`);
      });
    }
    
    if (result.outputs) {
      console.log('\n📤 Node Outputs:');
      Object.keys(result.outputs).forEach(nodeName => {
        const output = result.outputs[nodeName];
        if (output && output.length > 0) {
          console.log(`   ${nodeName}:`);
          const firstOutput = output[0].json || output[0];
          // Show a preview (truncate if too long)
          const preview = JSON.stringify(firstOutput, null, 2);
          if (preview.length > 200) {
            console.log(`      ${preview.substring(0, 200)}...`);
          } else {
            console.log(`      ${preview}`);
          }
        }
      });
    }
    
    return result;
  } catch (error) {
    console.error('❌ Execution failed:', error.message);
    console.error(error.stack);
    throw error;
  }
}

// Run the test
testWorkflow()
  .then(() => {
    console.log('\n✨ Test completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Test failed:', error.message);
    process.exit(1);
  });

