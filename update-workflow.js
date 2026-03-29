// Quick script to update the LinkedIn automation workflow in Supabase
// Run with: node update-workflow.js

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function updateWorkflow() {
  const automationId = 'ab364015-54e3-441f-96c2-8ba564c4e8a2';
  
  // Read the updated local JSON file
  const filePath = path.join(__dirname, '..', 'automations', 'linkedin-personal-blog-poster.json');
  const workflowJson = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  
  console.log('Updating workflow for automation:', automationId);
  console.log('Workflow name:', workflowJson.name);
  
  const { data, error } = await supabase
    .from('automations')
    .update({ workflow: workflowJson })
    .eq('id', automationId);
  
  if (error) {
    console.error('❌ Failed to update:', error);
  } else {
    console.log('✅ Workflow updated successfully in Supabase!');
  }
}

updateWorkflow();
