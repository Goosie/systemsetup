#!/usr/bin/env node
/**
 * flock-traction.mjs — Commy's weekly Nostr-traction pulse
 *
 * For every goose, counts REAL external engagement across several big relays:
 *   - followers  (kind 3 lists that p-tag the goose) — deduped by author, flock excluded
 *   - reactions  (kind 7)
 *   - zaps       (kind 9735 receipts)
 * Then DMs Perry a per-goose summary (NIP-17).
 *
 * Honesty notes baked in:
 *   - Followers live on the follower's OWN relays (outbox model), so counts across
 *     public relays are a best-effort lower bound, never exact.
 *   - Flock-internal follows (goose-follows-goose) and Perry are subtracted, so the
 *     number reflects OUTSIDE interest, not the family clapping for itself.
 *   - Bookmarks are deliberately NOT reported — they sit in private lists we can't see.
 *
 * Run:      node scripts/commy/flock-traction.mjs
 * Preview:  node scripts/commy/flock-traction.mjs --dry-run
 * Scheduled weekly via Blocky (1008 blocks) under key 'commy-traction'.
 */

import { readFileSync } from 'fs';
import { loadGeese, gather } from './traction-lib.mjs';

const NOSTR_TOOLS = '/var/www/goosielabs/apps/skein/node_modules/nostr-tools/lib/esm/index.js';
const WS_PATH     = '/home/deploy/nsite-gateway/node_modules/ws/lib/websocket.js';
const WHITELIST   = '/home/deploy/whitelist.json';
const COMMY_KEY   = '/home/deploy/agents/commy/nostr-key.json';
const SEND_RELAY  = 'ws://127.0.0.1:7778';

const DRY_RUN = process.argv.includes('--dry-run');

function buildMessage(rows) {
  const totF = rows.reduce((s, r) => s + r.followers, 0);
  const totR = rows.reduce((s, r) => s + r.reactions, 0);
  const totZ = rows.reduce((s, r) => s + r.zaps, 0);

  const withAny = rows.filter(r => r.followers || r.reactions || r.zaps);

  const lines = (withAny.length ? withAny : rows.slice(0, 5))
    .map(r => `  • ${r.name} — ${r.followers}👤 ${r.reactions}❤️ ${r.zaps}⚡`)
    .join('\n');

  const head = totF + totR + totZ === 0
    ? `Still a quiet room — no external follows, reactions or zaps yet. Something to earn 🪿`
    : `External interest is starting to land 🪿`;

  return [
    `🪿 Commy's flock-traction pulse (weekly)`,
    ``,
    head,
    ``,
    `Totals: ${totF} followers · ${totR} reactions · ${totZ} zaps  (across ${rows.length} geese)`,
    ``,
    withAny.length ? `Geese with traction:` : `Top geese (all at zero):`,
    lines,
    ``,
    `Counts are a best-effort lower bound (followers live on their own relays).`,
    `Flock-internal follows + Perry excluded — this is OUTSIDE interest only.`,
  ].join('\n');
}

async function sendDM(toPubkey, message) {
  const commyKey  = JSON.parse(readFileSync(COMMY_KEY, 'utf8'));
  const commyPriv = Buffer.from(commyKey.nsecHex, 'hex');
  const { nip17 }  = await import(NOSTR_TOOLS);
  const WebSocket  = (await import(WS_PATH)).default;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SEND_RELAY);
    ws.on('open', () => {
      const wrapped = nip17.wrapEvent(commyPriv, { publicKey: toPubkey }, message);
      ws.send(JSON.stringify(['EVENT', wrapped]));
    });
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg[0] === 'OK') { ws.close(); resolve(); }
    });
    ws.on('error', (e) => { ws.close(); reject(new Error(e.message)); });
    setTimeout(() => { ws.close(); resolve(); }, 8_000);
  });
}

(async () => {
  const geese = loadGeese();
  const rows  = await gather(geese);
  const message = buildMessage(rows);

  if (DRY_RUN) {
    console.log('--- DRY RUN (not sent) ---\n');
    console.log(message);
    process.exit(0);
  }

  const wl = JSON.parse(readFileSync(WHITELIST, 'utf8'));
  const perry = wl.perry_goosie;
  if (!perry) { console.error('No perry_goosie pubkey in whitelist.json'); process.exit(1); }

  await sendDM(perry, message);
  // Neutral stdout — the numbers stay in the private DM, never on the public relay.
  console.log('✅ Flock-traction pulse delivered to Perry via private DM.');
  process.exit(0);
})();
