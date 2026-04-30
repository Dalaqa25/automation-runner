require('dotenv').config({ path: require('path').join(__dirname, '.env.local') });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

console.log('Starting update...');
console.log('SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? 'found' : 'MISSING');
console.log('SERVICE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'found' : 'MISSING');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function update() {
  const workflow = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'automations', 'vehicle-parts-finder-v1.json'), 'utf8')
  );

  const { data, error } = await supabase
    .from('automations')
    .update({ workflow })
    .eq('name', 'Auto Parts Search Engine')
    .select('id, name');

  if (error) {
    console.log('❌ Failed:', error.message);
  } else if (!data || data.length === 0) {
    console.log('⚠️  No rows matched "Auto Parts Search Engine" — checking what names exist...');
    const { data: all } = await supabase.from('automations').select('id, name');
    console.log('All automations:', all?.map(a => a.name));
  } else {
    console.log('✅ Updated:', data[0].name, '(' + data[0].id + ')');
  }
}

update().catch(console.error);
