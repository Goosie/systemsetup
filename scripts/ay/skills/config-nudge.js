/**
 * Ay — config-nudge skill
 *
 * Synthesizes the config-suggestions inbox (+ a lightweight settings-drift check)
 * into ONE NIP-17 DM to Perry, then moves reported inbox lines to "## Sent".
 *
 * - Inbox items are added in-session by the ⚙️ Config coaching rule.
 * - Drift check: flags STALE_TERMS still present in the claude.ai settings mirror.
 * - --dry-run: prints the digest, sends nothing, moves nothing.
 *
 * DM pattern mirrors scripts/healthy/index.mjs (nip17.wrapEvent from a goose key).
 * Never hardcodes Perry's pubkey — reads perry_goosie from whitelist.json.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

const MIRROR      = '/home/deploy/claude-config/claude-web-settings.md';
const INBOX       = '/home/deploy/config-suggestions.md';
const WHITELIST   = '/home/deploy/whitelist.json';
const AY_KEY      = '/home/deploy/agents/ay/nostr-key.json';
const NOSTR_TOOLS = '/var/www/goosielabs/apps/skein/node_modules/nostr-tools/lib/esm/index.js';
const WS_PATH     = '/home/deploy/nsite-gateway/node_modules/ws/lib/websocket.js';
const RELAY       = 'ws://127.0.0.1:7778';

// Starter list — if the settings mirror still mentions <term>, it is likely stale.
// Kept explicit on purpose (no NLP guessing). Extend as the stack evolves.
const STALE_TERMS = [
  { term: 'NWC', reason: 'stack moved to LNbits→LND direct (LndRestWallet); NWC is legacy' },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── Inbox parsing ──────────────────────────────────────────────────────────────
// Returns { header, inboxLines, sentLines } split on the "## Inbox" / "## Sent"
// headings. inboxLines/sentLines are the `- ...` entries under each.
function parseInbox() {
  if (!existsSync(INBOX)) return null;
  const raw = readFileSync(INBOX, 'utf8');
  const lines = raw.split('\n');

  const inboxIdx = lines.findIndex(l => l.trim() === '## Inbox');
  const sentIdx  = lines.findIndex(l => l.trim() === '## Sent');
  if (inboxIdx === -1 || sentIdx === -1 || sentIdx < inboxIdx) return null;

  const header = lines.slice(0, inboxIdx + 1).join('\n'); // up to & incl. "## Inbox"
  const inboxBlock = lines.slice(inboxIdx + 1, sentIdx);
  const sentBlock  = lines.slice(sentIdx + 1);

  const isEntry = l => l.trim().startsWith('- ');
  return {
    header,
    inboxLines: inboxBlock.filter(isEntry).map(l => l.trim()),
    sentLines:  sentBlock.filter(isEntry).map(l => l.trim()),
  };
}

function writeInbox({ header, inboxLines, sentLines }) {
  const body =
    header + '\n\n' +
    (inboxLines.length ? inboxLines.join('\n') + '\n' : '') +
    '\n## Sent\n\n' +
    (sentLines.length ? sentLines.join('\n') + '\n' : '');
  writeFileSync(INBOX, body, 'utf8');
}

// ── Drift check ────────────────────────────────────────────────────────────────
function driftFindings() {
  if (!existsSync(MIRROR)) return [];
  const mirror = readFileSync(MIRROR, 'utf8');
  return STALE_TERMS
    .filter(({ term }) => new RegExp(`\\b${term}\\b`).test(mirror))
    .map(({ term, reason }) => `settings mirror still mentions "${term}" — ${reason}`);
}

// ── NIP-17 DM (mirrors healthy/index.mjs) ───────────────────────────────────────
async function sendDM(toPubkey, message) {
  const ayKey  = JSON.parse(readFileSync(AY_KEY, 'utf8'));
  const ayPriv = Buffer.from(ayKey.nsecHex, 'hex');
  const { nip17 } = await import(NOSTR_TOOLS);
  const WebSocket = (await import(WS_PATH)).default;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY);
    ws.on('open', () => {
      const wrapped = nip17.wrapEvent(ayPriv, { publicKey: toPubkey }, message);
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

// ── Entry point ─────────────────────────────────────────────────────────────────
export async function configNudge(_PATHS, { dryRun = false } = {}) {
  console.log(`\n⚙️  Config-nudge — settings suggestions digest${dryRun ? ' (dry-run)' : ''}:`);

  const inbox = parseInbox();
  if (!inbox) {
    console.log(`  ⚠️  Inbox ${INBOX} missing or malformed (needs "## Inbox" + "## Sent"). Skipping.`);
    return;
  }

  const drift = driftFindings();
  const nItems = inbox.inboxLines.length;

  if (nItems === 0 && drift.length === 0) {
    console.log('  ✅ Nothing to report — inbox empty, no drift.');
    return;
  }

  // Build digest
  const parts = [`⚙️ Config suggestions (${today()})`, ''];
  if (nItems) {
    parts.push(`Inbox (${nItems}):`);
    inbox.inboxLines.forEach(l => parts.push(`  ${l.replace(/^- /, '• ')}`));
    parts.push('');
  }
  if (drift.length) {
    parts.push(`Drift (${drift.length}):`);
    drift.forEach(d => parts.push(`  • ${d}`));
    parts.push('');
  }
  parts.push('Review: ~/config-suggestions.md · mirror: claude-config/claude-web-settings.md');
  const digest = parts.join('\n');

  console.log('\n' + digest + '\n');

  if (dryRun) {
    console.log('  (dry-run — no DM sent, inbox unchanged)');
    return;
  }

  // Send one DM to Perry (pubkey read dynamically, never hardcoded)
  const wl = JSON.parse(readFileSync(WHITELIST, 'utf8'));
  const perry = wl.perry_goosie;
  if (!perry) {
    console.log('  ⚠️  perry_goosie not in whitelist — cannot DM. Inbox left untouched.');
    return;
  }

  try {
    await sendDM(perry, digest);
    console.log('  📨 DM sent to Perry.');
  } catch (e) {
    console.log(`  ⚠️  DM failed (${e.message}) — inbox left untouched for retry.`);
    return;
  }

  // Move reported inbox lines → Sent (drift is stateless; nothing to move for it)
  if (nItems) {
    const stamp = today();
    const moved = inbox.inboxLines.map(l => `${l} (sent ${stamp})`);
    writeInbox({
      header: inbox.header,
      inboxLines: [],
      sentLines: [...inbox.sentLines, ...moved],
    });
    console.log(`  🗂️  Moved ${nItems} item(s) to ## Sent.`);
  }
}
