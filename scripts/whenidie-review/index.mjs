#!/usr/bin/env node
/**
 * whenidie-review — monthly family-handover reminder
 *
 * Sends Perry a NIP-17 DM reminding him to review /home/deploy/whenidie.md
 * (the family handover letter) so it never drifts out of date.
 * Triggered ~monthly by Blocky (~4320 blocks) via goose-runner.
 * Signed by Assistenty — the goose that keeps Perry's overview.
 *
 * Usage:
 *   node /home/deploy/scripts/whenidie-review/index.mjs remind     # send the DM
 *   node /home/deploy/scripts/whenidie-review/index.mjs --dry-run  # print, send nothing
 */

import { readFileSync } from 'fs';

const DRY_RUN = process.argv.includes('--dry-run');

const NOSTR_TOOLS = '/var/www/goosielabs/apps/skein/node_modules/nostr-tools/lib/esm/index.js';
const WS_PATH     = '/home/deploy/nsite-gateway/node_modules/ws/lib/websocket.js';
const SENDER_KEY  = '/home/deploy/agents/assistenty/nostr-key.json';
const WHITELIST   = '/home/deploy/whitelist.json';
const RELAY       = 'ws://127.0.0.1:7778';
const DOC         = '/home/deploy/whenidie.md';

const wl           = JSON.parse(readFileSync(WHITELIST, 'utf8'));
const PERRY_PUBKEY = wl.perry_goosie;
const senderKey    = JSON.parse(readFileSync(SENDER_KEY, 'utf8'));
const senderPriv   = Buffer.from(senderKey.nsecHex, 'hex');

const MESSAGE = [
  '🪦 Maandelijkse herinnering — familie-overdracht',
  '',
  `Herzie je overdrachtsdocument: ${DOC}`,
  '',
  'Klopt alles nog? Denk aan: waar sleutels/seed/backups staan, wallets en saldi,',
  'kritieke inloggegevens, toegang tot de node/server, en hoe alles veilig af te sluiten.',
  '',
  'Bij wijzigingen: werk het document bij en pas de "Laatst herzien"-datum aan.',
].join('\n');

async function sendDM(toPubkey, message) {
  const { nip17 } = await import(NOSTR_TOOLS);
  const WebSocket = (await import(WS_PATH)).default;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY);
    ws.on('open', () => {
      const wrapped = nip17.wrapEvent(senderPriv, { publicKey: toPubkey }, message);
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
  if (!PERRY_PUBKEY) { console.error('[whenidie-review] no perry_goosie pubkey in whitelist'); process.exit(1); }
  if (DRY_RUN) { console.log('[whenidie-review] DRY RUN — would DM Perry:\n\n' + MESSAGE); return; }
  try {
    await sendDM(PERRY_PUBKEY, MESSAGE);
    console.log('[whenidie-review] reminder DM sent to Perry');
  } catch (e) {
    console.error('[whenidie-review] failed to send DM:', e.message);
    process.exit(1);
  }
})();
