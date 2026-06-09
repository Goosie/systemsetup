#!/usr/bin/env node
/**
 * dm-listener.mjs — NIP-17 DM listener with Claude AI brain
 *
 * Listens for encrypted DMs (kind:1059) addressed to enabled geese.
 * Decrypts with the goose's private key, calls Claude Haiku with the
 * goose's system prompt and tools, and replies via NIP-17 DM.
 *
 * Only responds to Perry's whitelisted pubkeys.
 *
 * Usage:  node /home/deploy/scripts/humany/dm-listener.mjs
 * Service: sudo systemctl start dm-listener
 */

import 'websocket-polyfill';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import WebSocket from 'ws';
import { nip17, finalizeEvent, SimplePool } from 'nostr-tools';

const RELAY      = process.env.RELAY_URL ?? 'ws://127.0.0.1:7778';
const AGENTS_DIR = '/home/deploy/agents';
const WHITELIST  = '/home/deploy/whitelist.json';

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadKey(name) {
  const raw = JSON.parse(readFileSync(resolve(AGENTS_DIR, `${name}/nostr-key.json`), 'utf8'));
  return {
    sk:     new Uint8Array(raw.nsecHex.match(/.{2}/g).map(b => parseInt(b, 16))),
    pubkey: raw.pubkey,
    name,
  };
}

function getPerryPubkeys() {
  const wl = JSON.parse(readFileSync(WHITELIST, 'utf8'));
  return [wl.perry_zoomer, wl.perry_goosie].filter(Boolean);
}

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*[mGKHJA-Z]/g, '').replace(/\x1B\[[0-9]*[JK]/g, '');
}

// ── Healthy: tools ────────────────────────────────────────────────────────────

const HEALTHY_COMMAND_MAP = {
  health:              '/usr/local/bin/checkhealthy',
  memory:              'free -h',
  disk:                'df -h',
  uptime:              'uptime',
  processes:           "ps aux --sort=-%mem | head -12",
  status_blocky:       'systemctl status blocky --no-pager -l',
  status_goose_runner: 'systemctl status goose-runner --no-pager -l',
  status_lnbits:       'systemctl status lnbits --no-pager -l',
  status_strfry:       'systemctl status strfry --no-pager -l',
  status_nginx:        'systemctl status nginx --no-pager -l',
  status_mint:         'systemctl status nutshell --no-pager -l',
  logs_blocky:         'journalctl -u blocky --no-pager -n 30',
  logs_lnbits:         'journalctl -u lnbits --no-pager -n 30',
  logs_goose_runner:   'journalctl -u goose-runner --no-pager -n 30',
  logs_strfry:         'journalctl -u strfry --no-pager -n 30',
};

const HEALTHY_TOOLS = [{
  name: 'server_check',
  description: 'Run a server diagnostic command and return its output.',
  input_schema: {
    type: 'object',
    properties: {
      check: {
        type: 'string',
        enum: Object.keys(HEALTHY_COMMAND_MAP),
        description: 'Which diagnostic to run. Use "health" for a full overview.',
      },
    },
    required: ['check'],
  },
}];

function healthyExecute(name, input) {
  if (name !== 'server_check') return `Unknown tool: ${name}`;
  const cmd = HEALTHY_COMMAND_MAP[input.check];
  if (!cmd) return `Unknown check: ${input.check}`;
  try {
    const out = execSync(cmd, { timeout: 20_000, env: { ...process.env, TERM: 'xterm-256color' } }).toString();
    return stripAnsi(out).trim().slice(0, 3000); // cap at 3k chars
  } catch (err) {
    const out = err.stdout?.toString() ?? '';
    return `Exit ${err.status ?? '?'}\n${stripAnsi(out).trim()}`.slice(0, 3000);
  }
}

const HEALTHY_SYSTEM_PROMPT = `You are Healthy, the server health monitor for Goosie Labs.

You run on a Ubuntu 24.04 DigitalOcean VPS with 1.9 GB RAM and 2 GB swap.

You monitor:
- RAM, swap, disk
- Services: nginx, strfry (Nostr relay), lnbits, nutshell (Cashu mint), blocky, goose-runner
- Server uptime and load

When Perry asks about the server, use your tools to check the current state and give a
clear, concise answer. Start with the most relevant info. Use 🟢🟡🔴 when appropriate.
Be direct — if something is wrong, say so clearly.

Reply in the same language as Perry's message (Dutch or English).`;

// ── Goose registry — add new geese here ──────────────────────────────────────

const ENABLED_GEESE = ['healthy'];

const GEESE_CONFIG = {
  healthy: {
    systemPrompt:   HEALTHY_SYSTEM_PROMPT,
    tools:          HEALTHY_TOOLS,
    executeTool:    healthyExecute,
  },
};

// ── Claude API ────────────────────────────────────────────────────────────────

async function askClaude(gooseName, userMessage) {
  const config = GEESE_CONFIG[gooseName];
  if (!config) return `No AI config for ${gooseName}.`;

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return 'ANTHROPIC_API_KEY not set.';

  const messages = [{ role: 'user', content: userMessage }];
  const MAX_ITER = 6;

  for (let i = 0; i < MAX_ITER; i++) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: config.systemPrompt,
        messages,
        tools: config.tools,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error(`[dm-listener] Claude API error ${resp.status}: ${err}`);
      return `Sorry, I ran into an issue reaching the AI brain (${resp.status}).`;
    }

    const data = await resp.json();

    if (data.stop_reason === 'end_turn') {
      return data.content?.find(b => b.type === 'text')?.text?.trim() ?? '(no response)';
    }

    if (data.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: data.content });

      const toolResults = [];
      for (const block of data.content.filter(b => b.type === 'tool_use')) {
        console.log(`[dm-listener] ${gooseName} calling tool: ${block.name}(${JSON.stringify(block.input)})`);
        const result = await config.executeTool(block.name, block.input);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // max_tokens or other stop reason
    const text = data.content?.find(b => b.type === 'text')?.text?.trim();
    return text ?? `Stopped: ${data.stop_reason}`;
  }

  return 'Reached max tool iterations — please try a more specific question.';
}

// ── NIP-17 reply ──────────────────────────────────────────────────────────────

async function sendReply(gooseSK, toPubkey, message) {
  return new Promise((resolve, reject) => {
    const pool = new SimplePool();
    const wrapped = nip17.wrapEvent(gooseSK, { publicKey: toPubkey }, message);
    const prom = pool.publish([RELAY], wrapped);
    Promise.allSettled([prom]).then(() => {
      pool.close([RELAY]);
      resolve();
    });
    setTimeout(() => { pool.close([RELAY]); resolve(); }, 8_000);
  });
}

// ── Relay listener ────────────────────────────────────────────────────────────

const processed = new Set();
let ws;
let reconnectTimer;

// Build pubkey → goose map
const geese = ENABLED_GEESE.map(loadKey);
const pubkeyToGoose = Object.fromEntries(geese.map(g => [g.pubkey, g]));
const perryPubkeys = getPerryPubkeys();

console.log(`[dm-listener] enabled geese: ${geese.map(g => g.name).join(', ')}`);
console.log(`[dm-listener] authorized senders: ${perryPubkeys.map(p => p.slice(0, 8) + '…').join(', ')}`);

function connect() {
  ws = new WebSocket(RELAY);

  ws.onopen = () => {
    console.log(`[dm-listener] connected to relay`);
    ws.send(JSON.stringify([
      'REQ', 'dm-listener',
      {
        kinds: [1059],
        '#p': geese.map(g => g.pubkey),
        since: Math.floor(Date.now() / 1000) - 259200, // 3-day window
      },
    ]));
    console.log(`[dm-listener] subscribed to kind:1059 for ${geese.length} geese`);
  };

  ws.onmessage = async (event) => {
    let msg;
    try { msg = JSON.parse(event.data.toString()); } catch { return; }

    const [type, , ev] = msg;
    if (type !== 'EVENT' || !ev) return;
    if (processed.has(ev.id)) return;
    processed.add(ev.id);

    // Which goose was this addressed to?
    const recipientPubkey = ev.tags?.find(t => t[0] === 'p')?.[1];
    const goose = pubkeyToGoose[recipientPubkey];
    if (!goose) return;

    // Unwrap the gift-wrap
    let rumor;
    try {
      rumor = nip17.unwrapEvent(ev, goose.sk);
    } catch (err) {
      console.warn(`[dm-listener] unwrap failed for ${goose.name}: ${err.message}`);
      return;
    }

    const senderPubkey = rumor.pubkey;
    const text = rumor.content?.trim();
    if (!text) return;

    console.log(`[dm-listener] DM to ${goose.name} from ${senderPubkey.slice(0, 8)}…: "${text.slice(0, 80)}"`);

    if (!perryPubkeys.includes(senderPubkey)) {
      console.log(`[dm-listener] sender not authorized — ignored`);
      return;
    }

    // Ask Claude
    console.log(`[dm-listener] calling Claude Haiku for ${goose.name}…`);
    let reply;
    try {
      reply = await askClaude(goose.name, text);
    } catch (err) {
      console.error(`[dm-listener] Claude error: ${err.message}`);
      reply = `Sorry, something went wrong: ${err.message}`;
    }

    console.log(`[dm-listener] replying: "${reply.slice(0, 80)}…"`);
    try {
      await sendReply(goose.sk, senderPubkey, reply);
      console.log(`[dm-listener] reply sent ✓`);
    } catch (err) {
      console.error(`[dm-listener] send reply failed: ${err.message}`);
    }
  };

  ws.onclose = () => {
    console.log(`[dm-listener] disconnected — reconnecting in 10s…`);
    reconnectTimer = setTimeout(connect, 10_000);
  };

  ws.onerror = (e) => {
    console.error(`[dm-listener] ws error: ${e.message}`);
  };
}

process.on('SIGTERM', () => {
  console.log('[dm-listener] shutting down');
  clearTimeout(reconnectTimer);
  ws?.close();
  process.exit(0);
});

connect();
console.log('[dm-listener] started — waiting for DMs');
