require('dotenv').config({ path: require('path').join(__dirname, '.env.local') });
const fs = require('fs');
const path = require('path');

const workflow = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'automations', 'vehicle-parts-finder-v1.json'), 'utf8')
);

async function test() {
  console.log('🚗 Test 1: Honda Civic 2019, brake pads, max $100');

  const res = await fetch('http://localhost:3001/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflow,
      initialData: {
        body: {
          vehicle: 'Honda Civic 2019',
          part_name: 'brake pads',
          max_budget: '100'
        }
      },
      tokens: { groqApiKey: process.env.GROQ_API_KEY }
    })
  });

  const result = await res.json();

  if (!result.success) {
    console.log('❌ Failed:', result.error);
    console.log('Node outputs:', Object.keys(result.outputs || {}));
    // Show what each node returned
    for (const [nodeName, nodeOutput] of Object.entries(result.outputs || {})) {
      if (Array.isArray(nodeOutput) && nodeOutput[0]) {
        const data = nodeOutput[0].json;
        if (data && data.error) {
          console.log(nodeName + ' ERROR:', data.error, data.httpStatus);
        } else if (data) {
          console.log(nodeName + ' OK, keys:', Object.keys(data).join(', '));
          // Show AliExpress result details
          if (nodeName.includes('AliExpress') || nodeName === 'aliexpress-search') {
            console.log('  AliExpress result:', JSON.stringify(data).substring(0, 500));
          }
          // Show merge results
          if (nodeName.includes('Merge') || nodeName === 'merge-results') {
            console.log('  Merge output:', JSON.stringify(data).substring(0, 500));
          }
        }
      }
    }
    return;
  }

  // Check what eBay returned
  const ebayNode = result.outputs && (result.outputs['Search eBay Motors'] || result.outputs['ebay-search']);
  if (ebayNode && ebayNode[0]) {
    const ebayData = ebayNode[0].json;
    console.log('\n📦 eBay raw response:', JSON.stringify(ebayData).substring(0, 2000));
  } else {
    console.log('\n⚠️  No eBay node output found. Output keys:', Object.keys(result.outputs || {}));
  }

  const outputs = result.outputs || {};
  const parseNode = outputs['Parse AI JSON'];
  const display = parseNode && parseNode[0] && parseNode[0].json && parseNode[0].json.result_display;

  if (display && display.items && display.items.length > 0) {
    console.log('\n' + display.intro + '\n');
    display.items.forEach((item, i) => {
      console.log((i + 1) + '. ' + item.title);
      console.log('   ' + item.subtitle);
      console.log('   ' + item.link + '\n');
    });
  } else {
    console.log('No results:', JSON.stringify(result.errors));
  }
}

test().catch(console.error);
