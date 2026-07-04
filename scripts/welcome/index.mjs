#!/usr/bin/env node
/**
 * scripts/welcome/index.mjs — Welcome goose tasks, run by goose-runner via Blocky.
 *
 * Commands:
 *   relaylist   Publish/refresh Welcome's NIP-65 relay list (kind:10002) so
 *               outbox-model clients (Amethyst, ...) can discover where Welcome
 *               writes and fetch its replies there — even when a user's own relay
 *               rate-limited/dropped the kind:1. Replaceable + idempotent.
 *
 * Deps are imported by absolute path because goose-run scripts have no local
 * node_modules (nostr-tools lives in systemsetup/, ws in humany/). Welcome's key
 * is loaded from its nostr-key.json — the nsec is never printed or passed as an arg.
 */
import { readFileSync } from 'fs';
const { finalizeEvent } = await import('/home/deploy/systemsetup/node_modules/nostr-tools/lib/esm/index.js');
const WebSocket = (await import('/home/deploy/scripts/humany/node_modules/ws/lib/websocket.js')).default;

const command = process.argv[2] || 'relaylist';

const raw = JSON.parse(readFileSync('/home/deploy/agents/welcome/nostr-key.json', 'utf8'));
const sk = new Uint8Array(raw.nsecHex.match(/.{2}/g).map((b) => parseInt(b, 16)));

// Welcome's write relays — the reliable, widely-read ones its replies land on,
// plus nos.lol (the common default) so clients check there too.
const WRITE = [
  'wss://relay.goosielabs.com', 'wss://relay.primal.net', 'wss://relay.snort.social',
  'wss://nostr.oxtr.dev', 'wss://nos.lol',
];
// Publish the list where clients look it up: purplepag.es (the index) + big
// discovery relays + Welcome's own write relays.
const PUBLISH_TO = [...new Set([
  'wss://purplepag.es', 'wss://relay.nostr.band', 'wss://relay.damus.io',
  'wss://relay.primal.net', 'wss://nos.lol', 'wss://relay.goosielabs.com', ...WRITE,
])];

async function publishRelayList() {
  const ev = finalizeEvent({
    kind: 10002,
    created_at: Math.floor(Date.now() / 1000),
    tags: WRITE.map((r) => ['r', r]),   // unmarked r = read+write
    content: '',
  }, sk);
  const res = await Promise.all(PUBLISH_TO.map((u) => new Promise((resolve) => {
    let w, done = false;
    const fin = (v) => { if (done) return; done = true; try { w.close(); } catch (e) {} resolve(v); };
    try { w = new WebSocket(u); } catch (e) { return fin('conn'); }
    const t = setTimeout(() => fin('timeout'), 9000);
    w.on('open', () => w.send(JSON.stringify(['EVENT', ev])));
    w.on('message', (d) => {
      let m; try { m = JSON.parse(d.toString()); } catch (_) { return; }
      if (m[0] === 'OK' && m[1] === ev.id) { clearTimeout(t); fin(m[2] ? 'OK' : 'reject'); }
    });
    w.on('error', () => { clearTimeout(t); fin('err'); });
  })));
  const ok = res.filter((x) => x === 'OK').length;
  console.log(`🪿 Welcome NIP-65 relay list refreshed — ${ev.id.slice(0, 10)}… published to ${ok}/${PUBLISH_TO.length} relays.`);
  console.log(`   write relays: ${WRITE.join(', ')}`);
}

if (command === 'relaylist') await publishRelayList();
else console.log(`Welcome: unknown command "${command}" (known: relaylist)`);
process.exit(0);
