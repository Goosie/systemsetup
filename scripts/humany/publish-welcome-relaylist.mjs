#!/usr/bin/env node
/**
 * publish-welcome-relaylist.mjs — publish Welcome's NIP-65 relay list (kind:10002).
 *
 * So outbox-model clients (Amethyst, etc.) can discover WHERE Welcome writes and
 * fetch its replies there, even when a user's own relays rate-limited/dropped the
 * reply. Replaceable event — safe to re-run any time (e.g. via Blocky).
 *
 * Loads Welcome's key from its nostr-key.json file — the nsec is never printed,
 * never passed as an argument.
 */
import { finalizeEvent } from 'nostr-tools';
import { readFileSync } from 'fs';
import WebSocket from 'ws';

const raw = JSON.parse(readFileSync('/home/deploy/agents/welcome/nostr-key.json', 'utf8'));
const sk = new Uint8Array(raw.nsecHex.match(/.{2}/g).map((b) => parseInt(b, 16)));

// Welcome's write relays — the reliable, widely-read ones its replies land on,
// plus nos.lol (the common default) so clients check there too.
const WRITE = [
  'wss://relay.goosielabs.com',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://nostr.oxtr.dev',
  'wss://nos.lol',
];

const ev = finalizeEvent({
  kind: 10002,
  created_at: Math.floor(Date.now() / 1000),
  tags: WRITE.map((r) => ['r', r]),   // unmarked r = read+write
  content: '',
}, sk);

// Publish where clients look up relay lists: purplepag.es (the index) + the big
// discovery relays + Welcome's own write relays.
const PUBLISH_TO = [...new Set([
  'wss://purplepag.es', 'wss://relay.nostr.band', 'wss://relay.damus.io',
  'wss://relay.primal.net', 'wss://nos.lol', 'wss://relay.goosielabs.com',
  ...WRITE,
])];

console.log(`Welcome kind:10002 relay list — event ${ev.id.slice(0, 12)}…`);
console.log('write relays:', WRITE.join(', '), '\n');

const res = await Promise.all(PUBLISH_TO.map((u) => new Promise((resolve) => {
  let w, done = false;
  const fin = (v) => { if (done) return; done = true; try { w.close(); } catch (e) {} resolve(v); };
  try { w = new WebSocket(u); } catch (e) { return fin('conn'); }
  const t = setTimeout(() => fin('timeout'), 9000);
  w.on('open', () => w.send(JSON.stringify(['EVENT', ev])));
  w.on('message', (d) => {
    let m; try { m = JSON.parse(d.toString()); } catch (_) { return; }
    if (m[0] === 'OK' && m[1] === ev.id) { clearTimeout(t); fin(m[2] ? 'OK' : ('reject:' + (m[3] || '').slice(0, 28))); }
  });
  w.on('error', () => { clearTimeout(t); fin('err'); });
})));

PUBLISH_TO.forEach((u, i) => console.log((res[i] === 'OK' ? '✅' : '· ') + ' ' + String(res[i]).padEnd(14) + ' ' + u));
console.log(`\npublished to ${res.filter((x) => x === 'OK').length}/${PUBLISH_TO.length} relays`);
process.exit(0);
