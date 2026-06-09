#!/usr/bin/env node
/**
 * Healthy — server health monitor gans
 *
 * Voert checkhealthy uit en stuurt het rapport als NIP-17 DM naar Perry.
 * Bij statuswijziging (🟢↔🔴/🟡) wordt ook een publiek kind:1 event gepubliceerd
 * met een @mention van @directory.
 *
 * Gebruik:
 *   node /home/deploy/scripts/healthy/index.mjs          # run + DM + publiek bij wijziging
 *   node /home/deploy/scripts/healthy/index.mjs --dry-run # run, niets versturen
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const DRY_RUN = process.argv.includes('--dry-run');

const NOSTR_TOOLS  = '/var/www/goosielabs/apps/catchzaps/node_modules/nostr-tools/lib/esm/index.js';
const WS_PATH      = '/home/deploy/nsite-gateway/node_modules/ws/lib/websocket.js';
const HEALTHY_KEY  = '/home/deploy/agents/healthy/nostr-key.json';
const WHITELIST    = '/home/deploy/whitelist.json';
const AGENTS_JSON  = '/home/deploy/agents/agents.json';
const STATE_FILE   = '/home/deploy/logs/healthy/last_status.txt';
const RELAY        = 'ws://127.0.0.1:7778';
const HEALTH_CMD   = '/usr/local/bin/checkhealthy';

// ── Keys ──────────────────────────────────────────────────────────────────────
const wl          = JSON.parse(readFileSync(WHITELIST, 'utf8'));
const PERRY_PUBKEY = wl.perry_goosie;

const healthyKey  = JSON.parse(readFileSync(HEALTHY_KEY, 'utf8'));
const healthyPriv = Buffer.from(healthyKey.nsecHex, 'hex');

// Directory identity — lees dynamisch, nooit hardcoden
const agents = JSON.parse(readFileSync(AGENTS_JSON, 'utf8'));
const directoryAgent   = agents.agents.find(a => a.name === 'directory');
const DIRECTORY_PUBKEY = directoryAgent?.pubkey;
const DIRECTORY_NPUB   = directoryAgent?.npub;

// ── Helpers ───────────────────────────────────────────────────────────────────
function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*[mGKH]/g, '')
            .replace(/\x1B\[[0-9]*[JK]/g, '');
}

function runHealthCheck() {
  try {
    const output = execSync(HEALTH_CMD, {
      timeout: 30_000,
      env: { ...process.env, TERM: 'xterm-256color' }
    }).toString();
    return { output: stripAnsi(output), exitCode: 0 };
  } catch (err) {
    const output = err.stdout?.toString() || '';
    return { output: stripAnsi(output), exitCode: err.status ?? 1 };
  }
}

function statusEmoji(exitCode, output) {
  if (exitCode !== 0) return '🔴';
  if (output.includes('⚠')) return '🟡';
  return '🟢';
}

function statusLabel(emoji) {
  return { '🟢': 'OK', '🟡': 'WARNINGS', '🔴': 'CRITICAL' }[emoji] ?? 'UNKNOWN';
}

function loadLastStatus() {
  try { return existsSync(STATE_FILE) ? readFileSync(STATE_FILE, 'utf8').trim() : null; }
  catch { return null; }
}

function saveLastStatus(emoji) {
  try { writeFileSync(STATE_FILE, emoji, 'utf8'); } catch {}
}

// ── Nostr publish (kind:1, publiek) ──────────────────────────────────────────
async function publishNote(content, tags = []) {
  const { finalizeEvent } = await import(NOSTR_TOOLS);
  const WebSocket = (await import(WS_PATH)).default;

  const event = finalizeEvent({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
  }, healthyPriv);

  return new Promise((resolve) => {
    const ws = new WebSocket(RELAY);
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', event])));
    ws.on('message', () => { ws.close(); resolve(); });
    ws.on('error', () => { ws.close(); resolve(); });
    setTimeout(() => { ws.close(); resolve(); }, 8_000);
  });
}

// ── NIP-17 DM ────────────────────────────────────────────────────────────────
async function sendDM(toPubkey, message) {
  const { nip17 } = await import(NOSTR_TOOLS);
  const WebSocket  = (await import(WS_PATH)).default;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY);
    ws.on('open', () => {
      const wrapped = nip17.wrapEvent(healthyPriv, { publicKey: toPubkey }, message);
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

// ── Publiek bericht samenstellen bij statuswijziging ─────────────────────────
function buildPublicNote(emoji, prevEmoji, issues) {
  const tags = DIRECTORY_PUBKEY ? [['p', DIRECTORY_PUBKEY]] : [];

  if (prevEmoji === null) {
    // Eerste run
    return { text: `${emoji} Goosie Labs server health: ${statusLabel(emoji)}. Online and watching 🪿 | https://goosielabs.com #vformation`, tags };
  }

  const wasOk  = prevEmoji === '🟢';
  const isOk   = emoji === '🟢';

  const dirMention = DIRECTORY_NPUB ? `nostr:${DIRECTORY_NPUB}` : '@directory';

  if (!wasOk && isOk) {
    return {
      text: `🟢 Server is healthy again! All systems green. Thanks ${dirMention} for acting fast 🪿 | https://goosielabs.com #vformation`,
      tags,
    };
  }

  if (wasOk && !isOk) {
    const summary = issues.length > 0 ? `Issues: ${issues.join(', ')}` : 'Check details in private report.';
    return {
      text: `${emoji} Server health alert at Goosie Labs. ${summary} — ${dirMention} heads up 🪿 | https://goosielabs.com #vformation`,
      tags,
    };
  }

  // 🟡 → 🔴 of andersom
  return {
    text: `${emoji} Server status changed: ${statusLabel(prevEmoji)} → ${statusLabel(emoji)} 🪿 | https://goosielabs.com #vformation`,
    tags,
  };
}

function extractIssues(output) {
  return output.split('\n')
    .filter(l => l.includes('✘'))
    .map(l => l.replace(/[✘\s]/g, '').trim())
    .filter(Boolean)
    .slice(0, 3);
}

// ── Hoofdlogica ───────────────────────────────────────────────────────────────
console.log(`[healthy] ${new Date().toISOString()} — health check starten`);

const { output, exitCode } = runHealthCheck();
const emoji     = statusEmoji(exitCode, output);
const prevEmoji = loadLastStatus();
const changed   = emoji !== prevEmoji;

const timestamp = new Date().toLocaleString('nl-NL', {
  timeZone: 'Europe/Amsterdam',
  dateStyle: 'short',
  timeStyle: 'short'
});

const dmMessage = `${emoji} Goosie Labs — Server Health\n${timestamp}\n\n${output.trim()}`;

console.log(`[healthy] Status: ${emoji} (vorige: ${prevEmoji ?? 'onbekend'}) — gewijzigd: ${changed}`);

if (DRY_RUN) {
  if (emoji === '🔴') {
    console.log('\n── DM inhoud (dry-run, alleen bij 🔴) ──────────────');
    console.log(dmMessage);
  } else {
    console.log(`\n── DM overgeslagen (dry-run) — status is ${emoji}, geen DM`);
  }
  if ((changed || prevEmoji === null) && (emoji === '🟢' || emoji === '🟡')) {
    const issues = extractIssues(output);
    const { text } = buildPublicNote(emoji, prevEmoji, issues);
    console.log('\n── Publiek bericht (dry-run, 🟢/🟡 only) ───────────');
    console.log(text);
  } else {
    console.log(`\n── Publiek bericht overgeslagen (dry-run) — status ${emoji} of ongewijzigd`);
  }
  console.log('─────────────────────────────────────────────────────\n');
  console.log('[healthy] Dry-run klaar — niets verstuurd.');
  process.exit(exitCode);
}

// DM alleen bij 🔴
if (emoji === '🔴') {
  try {
    await sendDM(PERRY_PUBKEY, dmMessage);
    console.log(`[healthy] DM verstuurd naar Perry (🔴 status)`);
  } catch (err) {
    console.error(`[healthy] DM mislukt: ${err.message}`);
  }
} else {
  console.log(`[healthy] DM overgeslagen — status is ${emoji} (alleen 🔴 triggers DM)`);
}

// Publiek bericht alleen bij statuswijziging naar 🟢 of 🟡
if ((changed || prevEmoji === null) && (emoji === '🟢' || emoji === '🟡')) {
  const issues = extractIssues(output);
  const { text, tags } = buildPublicNote(emoji, prevEmoji, issues);
  try {
    await publishNote(text, tags);
    console.log(`[healthy] Publiek bericht gepubliceerd: "${text.slice(0, 60)}…"`);
  } catch (err) {
    console.error(`[healthy] Publiek bericht mislukt: ${err.message}`);
  }
} else if (changed) {
  console.log(`[healthy] Publiek bericht overgeslagen — status ${emoji} is niet publiek`);
} else {
  console.log(`[healthy] Status ongewijzigd (${emoji}) — geen berichten`);
}

saveLastStatus(emoji);

console.log(`[healthy] Klaar.`);
process.exit(0);
