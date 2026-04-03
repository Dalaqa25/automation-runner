require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const fixedCode = `const MAX_LENGTH = 2900;

// Get the text from the input (agent nodes output text in different fields)
let text = $json.output || $json.text || $json.content || $json.Content || '';

if (!text || typeof text !== 'string') {
  text = JSON.stringify($json);
}

// Strip markdown formatting to plain text for LinkedIn

// Remove headers (# ## ### etc)
text = text.replace(/^#{1,6}\\s*/gm, '');

// Remove bold (**text** or __text__)
text = text.replace(/\\*\\*(.+?)\\*\\*/g, '$1');
text = text.replace(/__(.+?)__/g, '$1');

// Remove italic (*text* or _text_)  
text = text.replace(/\\*(.+?)\\*/g, '$1');
text = text.replace(/_(.+?)_/g, '$1');

// Remove inline code
text = text.replace(/\`(.+?)\`/g, '$1');

// Remove code blocks
text = text.replace(/\`\`\`[\\s\\S]*?\`\`\`/g, '');

// Remove links but keep text: [text](url) -> text
text = text.replace(/\\[([^\\]]+)\\]\\([^)]+\\)/g, '$1');

// Remove images: ![alt](url)
text = text.replace(/!\\[([^\\]]*?)\\]\\([^)]+\\)/g, '$1');

// Remove horizontal rules
text = text.replace(/^[-*_]{3,}$/gm, '');

// Convert markdown bullet points to LinkedIn-friendly bullets
text = text.replace(/^\\s*[-*+]\\s+/gm, '• ');

// Convert numbered lists (keep them)
text = text.replace(/^\\s*(\\d+)\\.\\s+/gm, '$1. ');

// Clean up extra whitespace
text = text.replace(/\\n{3,}/g, '\\n\\n');
text = text.trim();

// Truncate if too long
if (text.length > MAX_LENGTH) {
  text = text.substring(0, MAX_LENGTH - 3) + '...';
}

return { json: { linkedinText: text } };`;

(async () => {
  // Fetch current workflow
  const { data, error } = await sb
    .from('automations')
    .select('workflow')
    .eq('id', '3819ae05-5478-47fb-a42a-a718f2c23c1f')
    .single();

  if (error) {
    console.error('Fetch error:', error);
    return;
  }

  const wf = typeof data.workflow === 'string' ? JSON.parse(data.workflow) : data.workflow;

  // Find and update the code node
  let found = false;
  for (const node of wf.nodes) {
    if (node.name === 'Formating markdown to plain text') {
      console.log('OLD code:', JSON.stringify(node.parameters.jsCode).substring(0, 100));
      node.parameters.jsCode = fixedCode;
      console.log('NEW code length:', fixedCode.length);
      found = true;
      break;
    }
  }

  if (!found) {
    console.error('Node not found!');
    return;
  }

  // Save back
  const { error: updateError } = await sb
    .from('automations')
    .update({ workflow: wf })
    .eq('id', '3819ae05-5478-47fb-a42a-a718f2c23c1f');

  if (updateError) {
    console.error('Update error:', updateError);
    return;
  }
  console.log('✅ Workflow code node updated successfully!');
})();
