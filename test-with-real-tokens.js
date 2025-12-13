const WorkflowRunner = require('./src/runner');
const fs = require('fs');
const path = require('path');

// Load the simplified workflow
const workflowPath = path.join(__dirname, 'test-survey-simplified-workflow.json');
let workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

// Get tokens from command line arguments or environment variables
// Usage: node test-with-real-tokens.js --openai-key="sk-..." --google-token="ya29..." --sheet-id="..." --sheet-name="..."
const args = process.argv.slice(2);
const tokens = {
  openAiApiKey: process.env.OPENAI_API_KEY || 
                args.find(arg => arg.startsWith('--openai-key='))?.split('=')[1]?.replace(/^["']|["']$/g, '') ||
                '',
  googleAccessToken: process.env.GOOGLE_ACCESS_TOKEN || 
                    args.find(arg => arg.startsWith('--google-token='))?.split('=')[1]?.replace(/^["']|["']$/g, '') ||
                    ''
};

// Get Sheet ID and Sheet Name from command line or environment
const sheetId = process.env.GOOGLE_SHEET_ID || 
                args.find(arg => arg.startsWith('--sheet-id='))?.split('=')[1]?.replace(/^["']|["']$/g, '') ||
                '';

const sheetName = process.env.SHEET_NAME || 
                  args.find(arg => arg.startsWith('--sheet-name='))?.split('=')[1]?.replace(/^["']|["']$/g, '') ||
                  'Log'; // Default to "Log" if not provided

// Replace placeholders in workflow with actual values
if (sheetId) {
  const workflowStr = JSON.stringify(workflow);
  workflow = JSON.parse(workflowStr.replace(/"SHEET_ID"/g, `"${sheetId}"`));
}

if (sheetName) {
  const workflowStr = JSON.stringify(workflow);
  // Replace "Log" with the provided sheet name (but only in the sheetName.value field)
  workflow = JSON.parse(workflowStr.replace(/"value":\s*"Log"/g, `"value": "${sheetName}"`));
}

// Test initial data
const initialData = {
  body: {
    survey_data: "What is your favorite programming language? JavaScript, Python, Java"
  }
};

async function testWorkflow() {
  console.log('🧪 Testing simplified Survey Auto Analyze workflow with real tokens...\n');
  
  // Check if tokens are provided
  if (!tokens.googleAccessToken) {
    console.error('❌ Error: Google Access Token not provided');
    console.log('   Set it via: GOOGLE_ACCESS_TOKEN="ya29..." node test-with-real-tokens.js');
    console.log('   Or: node test-with-real-tokens.js --google-token="ya29..."\n');
    process.exit(1);
  }
  
  if (!tokens.openAiApiKey) {
    console.error('❌ Error: OpenAI API Key not provided');
    console.log('   Set it via: OPENAI_API_KEY="sk-..." node test-with-real-tokens.js');
    console.log('   Or: node test-with-real-tokens.js --openai-key="sk-..."\n');
    process.exit(1);
  }

  if (!sheetId) {
    console.error('❌ Error: Google Sheet ID not provided');
    console.log('   Set it via: GOOGLE_SHEET_ID="your-sheet-id" node test-with-real-tokens.js');
    console.log('   Or: node test-with-real-tokens.js --sheet-id="your-sheet-id"');
    console.log('   Get Sheet ID from: https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit\n');
    process.exit(1);
  }
  
  console.log('✅ Tokens provided:');
  console.log(`   OpenAI API Key: ${tokens.openAiApiKey.substring(0, 10)}...${tokens.openAiApiKey.substring(tokens.openAiApiKey.length - 4)}`);
  console.log(`   Google Token: ${tokens.googleAccessToken.substring(0, 10)}...${tokens.googleAccessToken.substring(tokens.googleAccessToken.length - 4)}`);
  console.log(`   Google Sheet ID: ${sheetId}`);
  console.log(`   Sheet Name: ${sheetName}\n`);
  
  console.log('📋 Workflow nodes:');
  workflow.nodes.forEach(node => {
    if (node.type !== 'n8n-nodes-base.stickyNote') {
      console.log(`   - ${node.name} (${node.type})`);
    }
  });
  
  console.log('\n🚀 Executing workflow...\n');
  
  try {
    const runner = new WorkflowRunner();
    const startTime = Date.now();
    const result = await runner.execute(workflow, initialData, tokens);
    const duration = Date.now() - startTime;
    
    console.log(`\n⏱️  Execution time: ${duration}ms\n`);
    console.log('📊 Results:');
    console.log(`   Success: ${result.success ? '✅' : '❌'}`);
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
          console.log(`\n   ${nodeName}:`);
          const firstOutput = output[0].json || output[0];
          
          // Show a preview (truncate if too long)
          const preview = JSON.stringify(firstOutput, null, 2);
          if (preview.length > 500) {
            console.log(`      ${preview.substring(0, 500)}...`);
            console.log(`      ... (truncated, ${preview.length} chars total)`);
          } else {
            console.log(`      ${preview}`);
          }
        }
      });
    }
    
    if (result.success) {
      console.log('\n✅ Workflow executed successfully!');
    } else {
      console.log('\n⚠️  Workflow completed with errors (see above)');
    }
    
    return result;
  } catch (error) {
    console.error('\n❌ Execution failed:', error.message);
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

