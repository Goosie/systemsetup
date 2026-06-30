#!/usr/bin/env node
/**
 * Goose Runner — NIP-90 job dispatcher for the Goosie Labs V-Formation
 *
 * Subscribes to the relay for kind 5000 job requests published by Blocky.
 * Routes each job to the right goose script, captures output,
 * and publishes a kind 6000 result back to the relay — signed by that goose.
 */

import 'websocket-polyfill';
import WebSocket from 'ws';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { finalizeEvent, SimplePool } from 'nostr-tools';

const execFileAsync = promisify(execFile);

// ── Config ───────────────────────────────────────────────────────────────────

const RELAY        = process.env.RELAY_URL ?? 'ws://127.0.0.1:7778';
const BLOCKY_PUBKEY = 'd4e2e205c8e1437b40b635a88ca85c44f5f4b18539e8c09551d9ce0f200ff71b';
const AGENTS_DIR   = '/home/deploy/agents';
const APPS_DIR     = '/var/www/goosielabs/apps';
const SCRIPTS_DIR  = '/home/deploy/scripts';

// ── Keypairs ─────────────────────────────────────────────────────────────────

function loadKey(goose) {
  const raw = JSON.parse(readFileSync(resolve(AGENTS_DIR, `${goose}/nostr-key.json`), 'utf8'));
  return new Uint8Array(raw.nsecHex.match(/.{2}/g).map(b => parseInt(b, 16)));
}

const KEYS = {
  testy:  loadKey('testy'),
  secury: loadKey('secury'),
  jurry:  loadKey('jurry'),
  ay: loadKey('ay'),
  humany: loadKey('humany'),
  gitty: loadKey('gitty'),
  directory: loadKey('directory'),
  healthy: loadKey('healthy'),
  coachy: loadKey('coachy'),
  gander: loadKey('gander'),
  cssy: loadKey('cssy'),
  commy: loadKey('commy'),
  finny: loadKey('finny'),
  thinky: loadKey('thinky'),
  creaty: loadKey('creaty'),
  devy:       loadKey('devy'),
  'scb-backup': loadKey('devy'),
  'whenidie-review': loadKey('assistenty'),
  toddy: loadKey('toddy'),
  welcome: loadKey('welcome'),
  skeiny: loadKey('skeiny'),
  'onboarding-clawback': loadKey('welcome'), // app maintenance — signs as Welcome (the onboarding goose)
  splitty: loadKey('splitty'),
  // ── NEW GEESE ──
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function getParam(tags, name) {
  return tags.find(t => t[0] === 'param' && t[1] === name)?.[2];
}

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*m/g, '');
}

async function publishResult(pool, goose, jobEvent, content, status = 'success') {
  const event = finalizeEvent({
    kind: 6000,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['e', jobEvent.id],
      ['p', jobEvent.pubkey],
      ['status', status],
      ['t', 'vformation'],
      ['t', `goose:${goose}`],
    ],
    content: stripAnsi(content),
  }, KEYS[goose]);

  await Promise.allSettled(pool.publish([RELAY], event));
  console.log(`  📤 Result published (${status}) — id: ${event.id.slice(0, 16)}...`);
}

async function publishChat(pool, goose, content, toPubkey = null) {
  const tags = [
    ['t', 'vformation'],
    ['t', 'vformation-chat'],
  ];
  if (toPubkey) tags.push(['p', toPubkey]);

  const event = finalizeEvent({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
  }, KEYS[goose]);

  await Promise.allSettled(pool.publish([RELAY], event));
  console.log(`  💬 Chat: ${content.slice(0, 60)}`);
}

async function runScript(args, timeoutMs = 60_000) {
  const { stdout, stderr } = await execFileAsync('node', args, {
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
  });
  return (stdout + stderr).trim();
}

// ── Testy ────────────────────────────────────────────────────────────────────

async function handleTesty(pool, jobEvent, command) {
  const block = getParam(jobEvent.tags, 'trigger_block') ?? '?';

  if (command === 'run-all') {
    await publishChat(pool, 'testy', `Starting run-all at block ${block}...`, BLOCKY_PUBKEY);
    console.log('  🧪 Testy: checking all apps...');

    const apps = readdirSync(APPS_DIR).filter(app => {
      if (existsSync(resolve(APPS_DIR, app, '.archived'))) return false;
      return existsSync(resolve(APPS_DIR, app, 'scripts/testy/index.js'));
    });

    const results = [];

    for (const app of apps) {
      try {
        await runScript([resolve(APPS_DIR, app, 'scripts/testy/index.js'), 'check'], 30_000);
        results.push({ app, ok: true });
        console.log(`  ✅ ${app}`);
      } catch (e) {
        results.push({ app, ok: false, error: e.message.slice(0, 80) });
        console.log(`  ❌ ${app}`);
      }
    }

    const ok    = results.filter(r => r.ok).length;
    const lines = results.map(r => `${r.ok ? '✅' : '❌'} ${r.app}${r.error ? `: ${r.error}` : ''}`);
    const content = `Testy run-all — ${ok}/${results.length} apps reachable\n\n${lines.join('\n')}`;

    await publishResult(pool, 'testy', jobEvent, content, ok === results.length ? 'success' : 'partial');
  } else {
    const [app, cmd = 'check'] = command.split(':');
    const script = resolve(APPS_DIR, app, 'scripts/testy/index.js');
    if (!existsSync(script)) {
      await publishResult(pool, 'testy', jobEvent, `No testy script for app: ${app}`, 'error');
      return;
    }
    await publishChat(pool, 'testy', `Starting ${cmd} for ${app} at block ${block}...`, BLOCKY_PUBKEY);
    try {
      const output = await runScript([script, cmd], 30_000);
      await publishResult(pool, 'testy', jobEvent, output);
    } catch (e) {
      await publishResult(pool, 'testy', jobEvent, e.message, 'error');
    }
  }
}

// ── Secury / Jurry / Ay / generic ────────────────────────────────────────────

function resolveScript(goose) {
  for (const ext of ['js', 'mjs']) {
    const p = resolve(SCRIPTS_DIR, goose, `index.${ext}`);
    if (existsSync(p)) return p;
  }
  throw new Error(`No script found for goose "${goose}" in ${SCRIPTS_DIR}/${goose}/`);
}

function buildPublicSummary(goose, command, output, ok) {
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const lines = output.split('\n').filter(l => l.trim());
  // Count status indicators in output
  const checks  = (output.match(/[✔✓]/g) || []).length;
  const warnings = (output.match(/⚠/g) || []).length;
  const fails   = (output.match(/[✘✗]/g) || []).length;
  let status = ok ? '✅' : '❌';
  let detail = '';
  if (checks || warnings || fails) {
    detail = ` — ${checks} ok${warnings ? `, ${warnings} warnings` : ''}${fails ? `, ${fails} issues` : ''}`;
  }
  return `🪿 ${cap(goose)} ran \`${command}\`${detail} | https://goosielabs.com #vformation`;
}

async function handleScript(pool, goose, jobEvent, command) {
  const block = getParam(jobEvent.tags, 'trigger_block') ?? '?';
  const scriptPath = resolveScript(goose);
  await publishChat(pool, goose, `Starting ${command} at block ${block}...`, BLOCKY_PUBKEY);
  console.log(`  Running ${goose} ${command}...`);
  try {
    const output = await runScript([scriptPath, command], 120_000);
    await publishResult(pool, goose, jobEvent, output);
    await publishChat(pool, goose, buildPublicSummary(goose, command, output, true));
  } catch (e) {
    await publishResult(pool, goose, jobEvent, e.stderr || e.message, 'error');
    await publishChat(pool, goose, buildPublicSummary(goose, command, e.stderr || e.message, false));
  }
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

const processedJobs = new Set();

async function dispatch(pool, event) {
  if (processedJobs.has(event.id)) return;
  processedJobs.add(event.id);

  const goose   = getParam(event.tags, 'goose');
  const command = getParam(event.tags, 'command') ?? 'check';
  const block   = getParam(event.tags, 'trigger_block') ?? '?';

  console.log(`\n📥 Job — goose: ${goose}  command: ${command}  block: ${block}`);

  if (!KEYS[goose]) {
    console.log(`  ⚠️  No key loaded for goose "${goose}" — skipping`);
    return;
  }

  try {
    switch (goose) {
      case 'testy':  await handleTesty(pool, event, command); break;
      case 'secury': await handleScript(pool, 'secury', event, command); break;
      case 'jurry':  await handleScript(pool, 'jurry',  event, command); break;
      case 'ay': await handleScript(pool, 'ay', event, command); break;
      case 'humany': await handleScript(pool, 'humany', event, command); break;
      case 'gitty': await handleScript(pool, 'gitty', event, command); break;
      case 'directory': await handleScript(pool, 'directory', event, command); break;
      case 'healthy': await handleScript(pool, 'healthy', event, command); break;
      case 'coachy': await handleScript(pool, 'coachy', event, command); break;
      case 'gander': await handleScript(pool, 'gander', event, command); break;
      case 'cssy': await handleScript(pool, 'cssy', event, command); break;
      case 'commy': await handleScript(pool, 'commy', event, command); break;
      case 'finny':        await handleScript(pool, 'finny', event, command); break;
      case 'finny-wallet': await handleScript(pool, 'finny', event, command); break;
      case 'scb-backup': await handleScript(pool, 'scb-backup', event, command); break;
      case 'whenidie-review': await handleScript(pool, 'whenidie-review', event, command); break;
      case 'thinky': await handleScript(pool, 'thinky', event, command); break;
      case 'creaty': await handleScript(pool, 'creaty', event, command); break;
      case 'devy':    await handleScript(pool, 'devy',    event, command); break;
      case 'toddy': await handleScript(pool, 'toddy', event, command); break;
      case 'welcome': await handleScript(pool, 'welcome', event, command); break;
      case 'skeiny': await handleScript(pool, 'skeiny', event, command); break;
      case 'onboarding-clawback': await handleScript(pool, 'onboarding-clawback', event, command); break;
      case 'splitty': await handleScript(pool, 'splitty', event, command); break;
      // ── NEW CASES ──
    }
  } catch (e) {
    console.error(`  ❌ Error in ${goose}:`, e.message);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('🪿 Goose Runner — NIP-90 job dispatcher');
console.log('────────────────────────────────────────');
console.log(`📡 Relay:    ${RELAY}`);
console.log(`🎯 Geese:    ${Object.keys(KEYS).join(', ')}`);
console.log(`🔒 Trusted:  Blocky (${BLOCKY_PUBKEY.slice(0, 16)}...)\n`);

// ── Publish pool (for results) ────────────────────────────────────────────────

const pool = new SimplePool();

// ── Relay subscription (raw WebSocket — SimplePool doesn't reliably deliver live events) ──

function connectRelay() {
  const ws = new WebSocket(RELAY);
  const subId = 'goose-runner-' + Math.random().toString(36).slice(2, 8);

  ws.on('open', () => {
    const filter = {
      kinds: [5000],
      '#t': ['vformation'],
      authors: [BLOCKY_PUBKEY],
      since: Math.floor(Date.now() / 1000) - 30,
    };
    ws.send(JSON.stringify(['REQ', subId, filter]));
    console.log('🔗 Relay connected — subscription active');
  });

  ws.on('message', async (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    if (msg[0] === 'EVENT' && msg[1] === subId) {
      const event = msg[2];
      try { await dispatch(pool, event); }
      catch (e) { console.error('❌ Dispatch error:', e.message); }
    } else if (msg[0] === 'EOSE' && msg[1] === subId) {
      console.log('✅ Ready — waiting for job requests from Blocky...');
    } else if (msg[0] === 'NOTICE') {
      console.log('📢 Relay notice:', msg[1]);
    }
  });

  ws.on('close', () => {
    console.log('🔌 Relay disconnected — reconnecting in 10s...');
    setTimeout(connectRelay, 10_000);
  });

  ws.on('error', (e) => {
    console.error('❌ Relay error:', e.message);
  });
}

connectRelay();
