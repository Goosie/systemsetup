import WebSocket from 'ws';

const RELAY = 'wss://relay.goosielabs.com';
const BLOCKY = 'd4e2e205c8e1437b40b635a88ca85c44f5f4b18539e8c09551d9ce0f200ff71b';

console.log('🧪 Testing Blocky relay subscription...\n');

const ws = new WebSocket(RELAY);
let eventCount = 0;

ws.onopen = () => {
  console.log('✅ Connected to relay');
  
  ws.send(JSON.stringify(['REQ', 'test-blocky', {
    kinds: [1],
    authors: [BLOCKY],
    '#t': ['block'],
    limit: 3
  }]));
  console.log('📡 Sent subscription request\n');
};

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  
  if (msg[0] === 'EVENT') {
    const event = msg[2];
    const blockTag = event.tags.find(t => t[0] === 'block_height');
    const blockHeight = blockTag ? blockTag[1] : '?';
    console.log(`  Block #${blockHeight}: ${event.content.substring(0, 40)}`);
    eventCount++;
  }
  
  if (msg[0] === 'EOSE') {
    console.log(`\n✅ Success: ${eventCount} block events received`);
    console.log('✅ blocky-block.js subscription will work');
    ws.close();
    process.exit(0);
  }
};

ws.onerror = (e) => {
  console.error('❌ Error:', e.message);
  process.exit(1);
};

setTimeout(() => {
  console.error('❌ Timeout — relay not responding');
  process.exit(1);
}, 8000);
