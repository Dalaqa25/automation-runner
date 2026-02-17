require('dotenv').config();
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function fixWorkflow() {
  const automationId = 'b7c6d3ac-270b-415b-bd47-af905fff448c';
  
  // Load the correct workflow from local file
  const workflowJson = fs.readFileSync('./Automations/tiktok_final_workflow.json', 'utf8');
  const workflow = JSON.parse(workflowJson);
  
  console.log('Updating workflow in database...');
  console.log('Automation ID:', automationId);
  
  // Update the workflow in Supabase
  const { data, error } = await supabase
    .from('automations')
    .update({ workflow: workflow })
    .eq('id', automationId);
  
  if (error) {
    console.error('Error updating workflow:', error);
    process.exit(1);
  }
  
  console.log('✅ Workflow updated successfully!');
  console.log('The workflow now uses {{$tokens.accessToken}} expressions');
}

fixWorkflow();
