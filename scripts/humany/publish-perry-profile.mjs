#!/usr/bin/env node
// Publishes Perry's kind:0 profile with updated picture + banner
import 'websocket-polyfill';
import WebSocket from 'ws';
import { finalizeEvent } from 'nostr-tools';
import { nip19 } from 'nostr-tools';

const nsec = process.env.PERRY_NSEC;
if (!nsec?.startsWith('nsec1')) { console.error('PERRY_NSEC not set'); process.exit(1); }

const { data: sk } = nip19.decode(nsec);

const profile = {
  name: 'Perry Smit',
  display_name: 'Perry Smit',
  about: 'Founder of Goosie Labs. Builder at the intersection of Bitcoin, Nostr and AI. Lands on strange places, investigates, and flies on. 🪿',
  picture: 'https://goosielabs.com/perry/perry-goose.jpg',
  banner:  'https://goosielabs.com/perry/perry-banner.jpg',
  website: 'https://goosielabs.com',
  nip05:   'perry@goosielabs.com',
  lud16:   'perry@goosielabs.com',
};

const event = finalizeEvent({
  kind: 0,
  created_at: Math.floor(Date.now() / 1000),
  tags: [],
  content: JSON.stringify(profile),
}, sk);

const relays = ['ws://127.0.0.1:7778', 'wss://relay.damus.io', 'wss://relay.primal.net'];

for (const url of relays) {
  await new Promise(resolve => {
    const ws = new WebSocket(url);
    ws.onopen = () => ws.send(JSON.stringify(['EVENT', event]));
    ws.onmessage = (m) => {
      try { const r = JSON.parse(m.data); if (r[0]==='OK') console.log('✅', url); } catch {}
      ws.close(); resolve();
    };
    ws.onerror = () => { console.log('⚠️ ', url, '(skip)'); resolve(); };
    setTimeout(() => { ws.close(); resolve(); }, 5000);
  });
}
console.log('Done.');
