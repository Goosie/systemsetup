import { readFileSync } from 'fs';
import { finalizeEvent, generateSecretKey, nip19 } from 'nostr-tools';
import { SimplePool } from 'nostr-tools';
import WebSocket from 'ws';
global.WebSocket = WebSocket;

const nsec = process.env.PERRY_NSEC;
const { data: sk } = nip19.decode(nsec);

const content = readFileSync('/tmp/honk-draft.md', 'utf8');

const event = finalizeEvent({
  kind: 30023,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ['title', 'The Honk Standard'],
    ['d', 'the-honk-standard'],
    ['summary', 'A Goosie Labs guide to Bitcoin, Lightning and Nostr — by Docy 🪿'],
    ['t', 'bitcoin'], ['t', 'lightning'], ['t', 'nostr'], ['t', 'goosielabs'],
    ['published_at', String(Math.floor(Date.now() / 1000))],
  ],
  content,
}, sk);

const relays = ['wss://relay.goosielabs.com', 'wss://relay.damus.io', 'wss://nos.lol'];
const pool = new SimplePool();
await Promise.allSettled(pool.publish(relays, event));
await new Promise(r => setTimeout(r, 3000));
pool.close(relays);

console.log('Published! Event ID:', event.id);
console.log('Read on Primal: https://primal.net/e/' + event.id);
