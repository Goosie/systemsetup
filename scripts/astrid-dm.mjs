#!/usr/bin/env node
/**
 * astrid-dm.mjs — Assistenty's DM listener
 *
 * Monitors the Goosie Labs relay for NIP-17 DMs addressed to Assistenty.
 * Accepts whitelist management commands from Perry's pubkeys only.
 *
 * Commands (send as a DM to assistenty@goosielabs.com):
 *   whitelist <npub1... | 64hexkey> [label]   — add a key to the whitelist
 *   whitelist remove <label>                  — remove a key by label
 *   whitelist list                            — list current whitelist
 *
 * Run:  node /home/deploy/scripts/astrid-dm.mjs
 * Service: sudo systemctl start astrid-dm
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';

const NOSTR_TOOLS = '/var/www/goosielabs/apps/catchzaps/node_modules/nostr-tools/lib/esm/index.js';
const WS_PATH     = '/home/deploy/nsite-gateway/node_modules/ws/lib/websocket.js';
const ASTRID_KEY  = '/home/deploy/agents/assistenty/nostr-key.json';
const WHITELIST   = '/home/deploy/whitelist.json';
const RELAY       = 'ws://127.0.0.1:7778';

// ── Load keys ────────────────────────────────────────────────────────────────

const astridKey  = JSON.parse(readFileSync(ASTRID_KEY, 'utf8'));
const astridPriv = Buffer.from(astridKey.nsecHex, 'hex');
const astridPub  = astridKey.pubkey;

function loadWhitelist() {
  return JSON.parse(readFileSync(WHITELIST, 'utf8'));
}

function saveWhitelist(wl) {
  writeFileSync(WHITELIST, JSON.stringify(wl, null, 2) + '\n', 'utf8');
}

function getAuthorizedPubkeys() {
  const wl = loadWhitelist();
  return [wl.perry_zoomer, wl.perry_goosie].filter(Boolean);
}

// ── NIP-17 helpers ───────────────────────────────────────────────────────────

const { nip17, nip19, finalizeEvent, generateSecretKey, getPublicKey } =
  await import(NOSTR_TOOLS);
const WebSocket = (await import(WS_PATH)).default;

function unwrapDM(giftWrap) {
  try {
    return nip17.unwrapEvent(giftWrap, astridPriv);
  } catch {
    return null;
  }
}

function sendReply(toPubkey, message) {
  return new Promise((resolve) => {
    const ws = new WebSocket(RELAY);
    ws.on('open', () => {
      const wrapped = nip17.wrapEvent(astridPriv, { publicKey: toPubkey }, message);
      ws.send(JSON.stringify(['EVENT', wrapped]));
    });
    ws.on('message', () => { ws.close(); resolve(); });
    ws.on('error', (e) => { console.error('reply error:', e.message); resolve(); });
    setTimeout(() => { ws.close(); resolve(); }, 5000);
  });
}

// ── Command handler ───────────────────────────────────────────────────────────

async function handleCommand(senderPubkey, text) {
  const parts = text.trim().split(/\s+/);
  const cmd   = parts[0]?.toLowerCase();

  if (cmd !== 'whitelist') {
    return `Unknown command: ${cmd}\n\nCommands:\n  whitelist <npub|hex> [label]\n  whitelist remove <label>\n  whitelist list`;
  }

  const sub = parts[1]?.toLowerCase();

  // whitelist list
  if (sub === 'list') {
    const wl = loadWhitelist();
    const entries = Object.entries(wl)
      .filter(([, v]) => /^[0-9a-f]{64}$/.test(v))
      .map(([k, v]) => `  ${k}: ${v.slice(0, 8)}...`)
      .join('\n');
    return `Current whitelist (${entries.split('\n').length} entries):\n${entries}`;
  }

  // whitelist remove <label>
  if (sub === 'remove') {
    const label = parts[2];
    if (!label) return 'Usage: whitelist remove <label>';
    const wl = loadWhitelist();
    if (!wl[label]) return `Label not found: ${label}`;
    if (['_comment', 'perry_zoomer', 'perry_goosie', 'manager'].includes(label)) {
      return `Cannot remove protected entry: ${label}`;
    }
    delete wl[label];
    saveWhitelist(wl);
    console.log(`[cmd] removed whitelist entry: ${label}`);
    return `Removed ${label} from whitelist.`;
  }

  // whitelist <npub|hex> [label]
  const raw   = parts[1];
  const label = parts[2] || null;

  if (!raw) return 'Usage: whitelist <npub1...|hex64> [label]';

  let pubkeyHex;
  try {
    if (raw.startsWith('npub1')) {
      pubkeyHex = nip19.decode(raw).data;
    } else if (/^[0-9a-f]{64}$/i.test(raw)) {
      pubkeyHex = raw.toLowerCase();
    } else {
      return `Invalid key format: ${raw}\n\nExpected: npub1... or 64-char hex`;
    }
  } catch {
    return `Could not decode key: ${raw}`;
  }

  const wl = loadWhitelist();

  // Check if already whitelisted
  const existing = Object.entries(wl).find(([, v]) => v === pubkeyHex);
  if (existing) return `Already whitelisted as: ${existing[0]}`;

  // Determine label
  const finalLabel = label || `user_${pubkeyHex.slice(0, 8)}`;
  if (wl[finalLabel]) return `Label already taken: ${finalLabel} — provide a different label`;

  wl[finalLabel] = pubkeyHex;
  saveWhitelist(wl);

  console.log(`[cmd] added whitelist entry: ${finalLabel} = ${pubkeyHex}`);

  let npub;
  try { npub = nip19.npubEncode(pubkeyHex); } catch { npub = pubkeyHex; }
  return `Added to whitelist:\n  label: ${finalLabel}\n  npub:  ${npub}`;
}

// ── Relay listener ────────────────────────────────────────────────────────────

const processed = new Set();
let ws;
let reconnectTimer;

function connect() {
  console.log('[astrid-dm] connecting to relay…');
  ws = new WebSocket(RELAY);

  ws.on('open', () => {
    console.log('[astrid-dm] connected — subscribing to DMs for', astridPub.slice(0, 8) + '…');
    // NIP-59 gift wraps have randomized timestamps up to 48h in the past.
    // Use a 3-day window; the processed Set deduplicates on reconnect.
    ws.send(JSON.stringify([
      'REQ', 'astrid-dm',
      { kinds: [1059], '#p': [astridPub], since: Math.floor(Date.now() / 1000) - 259200 },
    ]));
  });

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    const [type, , event] = msg;
    if (type !== 'EVENT' || !event) return;
    if (processed.has(event.id)) return;
    processed.add(event.id);

    const rumor = unwrapDM(event);
    if (!rumor) return;

    const sender = rumor.pubkey;
    const text   = rumor.content?.trim();

    console.log(`[astrid-dm] DM from ${sender.slice(0, 8)}… : "${text?.slice(0, 60)}"`);

    const authorized = getAuthorizedPubkeys();
    if (!authorized.includes(sender)) {
      console.log('[astrid-dm] sender not authorized — ignoring');
      await sendReply(sender, 'Not authorized. Only Perry can send me commands.');
      return;
    }

    const reply = await handleCommand(sender, text);
    console.log('[astrid-dm] reply:', reply.slice(0, 80));
    await sendReply(sender, reply);
  });

  ws.on('close', () => {
    console.log('[astrid-dm] disconnected — reconnecting in 10s…');
    reconnectTimer = setTimeout(connect, 10_000);
  });

  ws.on('error', (e) => {
    console.error('[astrid-dm] ws error:', e.message);
  });
}

process.on('SIGTERM', () => {
  console.log('[astrid-dm] shutting down');
  clearTimeout(reconnectTimer);
  ws?.close();
  process.exit(0);
});

connect();
console.log('[astrid-dm] Astrid DM listener started');
