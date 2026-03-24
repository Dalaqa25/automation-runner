const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(
  'https://rujwlthjstwjfzumfjns.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1andsdGhqc3R3amZ6dW1mam5zIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTcxMjIyMSwiZXhwIjoyMDY3Mjg4MjIxfQ.04YpgHWhVQqOOH1lZGGIvCvVk_T2OKUAeoHXdNwKnYI'
);

async function main() {
  const { data, error } = await supabase
    .from('automations')
    .select('id, name, workflow')
    .eq('name', 'Linkedrevised poster')
    .single();

  if (error) {
    console.error('Error fetching automation:', error);
    process.exit(1);
  }

  const workflow = typeof data.workflow === 'string' ? JSON.parse(data.workflow) : data.workflow;
  
  const targetNode = workflow.nodes.find(n => n.name === 'Formating markdown to plain text');
  console.log('Target Node Code:', JSON.stringify(targetNode.parameters.jsCode, null, 2));
}

main();
