#!/usr/bin/env node
/**
 * Healthy — server health monitor gans
 *
 * Voert checkhealthy uit en stuurt het rapport als NIP-17 DM naar Perry.
 * Draait via cron — zie: crontab -l
 *
 * Gebruik:
 *   node /home/deploy/scripts/healthy/index.mjs          # run + DM Perry
 *   node /home/deploy/scripts/healthy/index.mjs --dry-run # run, geen DM
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const DRY_RUN = process.argv.includes('--dry-run');

const NOSTR_TOOLS = '/var/www/goosielabs/apps/catchzaps/node_modules/nostr-tools/lib/esm/index.js';
const WS_PATH     = '/home/deploy/nsite-gateway/node_modules/ws/lib/websocket.js';
const HEALTHY_KEY = '/home/deploy/agents/healthy/nostr-key.json';
const WHITELIST   = '/home/deploy/whitelist.json';
const RELAY       = 'ws://127.0.0.1:7778';
const HEALTH_CMD  = '/usr/local/bin/checkhealthy';

// ── Perry's pubkeys ────────────────────────────────────────────────────────────
const wl = JSON.parse(readFileSync(WHITELIST, 'utf8'));
// Stuur naar perry_goosie (actief voor DMs)
const PERRY_PUBKEY = wl.perry_goosie;

// ── Healthy's key ──────────────────────────────────────────────────────────────
const healthyKey  = JSON.parse(readFileSync(HEALTHY_KEY, 'utf8'));
const healthyPriv = Buffer.from(healthyKey.nsecHex, 'hex');

// ── ANSI stripper ─────────────────────────────────────────────────────────────
function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*[mGKH]/g, '')
            .replace(/\x1B\[[0-9]*[JK]/g, '');
}

// ── Health check uitvoeren ────────────────────────────────────────────────────
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

// ── Status emoji op basis van exit code ──────────────────────────────────────
function statusEmoji(exitCode, output) {
  if (exitCode !== 0) return '🔴';
  if (output.includes('⚠')) return '🟡';
  return '🟢';
}

// ── DM sturen via NIP-17 ──────────────────────────────────────────────────────
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
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg[0] === 'OK') {
        ws.close();
        resolve();
      }
    });

    ws.on('error', (e) => {
      ws.close();
      reject(new Error(`WebSocket fout: ${e.message}`));
    });

    setTimeout(() => {
      ws.close();
      resolve(); // timeout is geen fout — relay kan traag zijn
    }, 8_000);
  });
}

// ── Hoofdlogica ────────────────────────────────────────────────────────────────
console.log(`[healthy] ${new Date().toISOString()} — health check starten`);

const { output, exitCode } = runHealthCheck();
const emoji = statusEmoji(exitCode, output);
const timestamp = new Date().toLocaleString('nl-NL', {
  timeZone: 'Europe/Amsterdam',
  dateStyle: 'short',
  timeStyle: 'short'
});

const message = `${emoji} Goosie Labs — Server Health\n${timestamp}\n\n${output.trim()}`;

if (DRY_RUN) {
  console.log('\n── DM inhoud (dry-run) ──────────────────────────────');
  console.log(message);
  console.log('─────────────────────────────────────────────────────\n');
  console.log('[healthy] Dry-run klaar — geen DM verstuurd.');
  process.exit(exitCode);
}

try {
  await sendDM(PERRY_PUBKEY, message);
  console.log(`[healthy] DM verstuurd naar Perry (${PERRY_PUBKEY.slice(0,8)}…)`);
} catch (err) {
  console.error(`[healthy] DM mislukt: ${err.message}`);
  process.exit(1);
}

console.log(`[healthy] Klaar. Status: ${emoji}`);
process.exit(0);
