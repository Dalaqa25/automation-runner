require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

const API_URL = 'http://localhost:3001';

async function testScheduling() {
  console.log('=== Testing Workflow Scheduling ===\n');

  try {
    // Load the cold email workflow
    const workflowJson = fs.readFileSync('Zero-Cost Cold Email Machine (300 Leads_Day).json', 'utf8');
    const workflow = JSON.parse(workflowJson);

    console.log('1. Scheduling workflow to run every hour...\n');

    // Schedule the workflow
    const scheduleResponse = await axios.post(`${API_URL}/schedule`, {
      workflow: workflow,
      initialData: {},
      tokens: {
        googleAccessToken: process.env.GOOGLE_ACCESS_TOKEN || 'test-token'
      },
      cronExpression: '0 * * * *'  // Every hour
    });

    console.log('✅ Workflow scheduled successfully!');
    console.log('Schedule Info:', JSON.stringify(scheduleResponse.data, null, 2));
    console.log('');

    const jobKey = scheduleResponse.data.schedule.jobKey;

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('2. Listing all scheduled workflows...\n');

    // List all schedules
    const listResponse = await axios.get(`${API_URL}/schedules`);
    console.log('✅ Scheduled Workflows:');
    console.log(JSON.stringify(listResponse.data, null, 2));
    console.log('');

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('3. Removing scheduled workflow...\n');

    // Remove the schedule
    const removeResponse = await axios.delete(`${API_URL}/schedule/${jobKey}`);
    console.log('✅ Schedule removed:', removeResponse.data.message);
    console.log('');

    console.log('=== Test Complete ===\n');
    console.log('How it works:');
    console.log('1. POST /schedule - Creates a repeatable job in BullMQ');
    console.log('2. BullMQ automatically runs it based on cron expression');
    console.log('3. No manual triggering needed - runs forever until removed');
    console.log('');
    console.log('Cron Expression Examples:');
    console.log('  "0 * * * *"      - Every hour');
    console.log('  "0 9 * * *"      - Every day at 9 AM');
    console.log('  "*/30 * * * *"   - Every 30 minutes');
    console.log('  "0 9 * * 1"      - Every Monday at 9 AM');
    console.log('  "0 0 1 * *"      - First day of every month');

  } catch (error) {
    if (error.response) {
      console.error('❌ API Error:', error.response.data);
    } else if (error.code === 'ECONNREFUSED') {
      console.error('❌ Error: Automation runner is not running!');
      console.error('   Start it with: npm start');
    } else {
      console.error('❌ Error:', error.message);
    }
  }

  process.exit(0);
}

testScheduling();
