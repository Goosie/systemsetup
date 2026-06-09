#!/usr/bin/env node
/**
 * dm-listener.mjs — NIP-17 DM listener with Claude AI brain
 *
 * Listens for encrypted DMs (kind:1059) addressed to enabled geese.
 * Decrypts with the goose's private key, calls Claude Haiku with the
 * goose's system prompt and tools, and replies via NIP-17 DM.
 *
 * Enabled geese:
 *   assistenty — V-Formation coordinator; delegates to specialist geese
 *   healthy    — Server health monitor; runs diagnostic commands
 *
 * Only responds to Perry's whitelisted pubkeys.
 *
 * Usage:  node /home/deploy/scripts/humany/dm-listener.mjs
 * Service: sudo systemctl start dm-listener
 */

import 'websocket-polyfill';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import WebSocket from 'ws';
import { nip17, nip19, SimplePool } from 'nostr-tools';

const USAGE_LOG = '/home/deploy/logs/finny/usage.jsonl';

function logUsage(gooseName, model, inputTokens, outputTokens, toolCalls) {
  try {
    mkdirSync('/home/deploy/logs/finny', { recursive: true });
    appendFileSync(USAGE_LOG, JSON.stringify({
      ts: Math.floor(Date.now() / 1000),
      goose: gooseName,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      tool_calls: toolCalls,
    }) + '\n');
  } catch (e) {
    console.warn(`[dm-listener] usage log failed: ${e.message}`);
  }
}

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

const AGENTS_JSON = '/home/deploy/agents/agents.json';

function loadWhitelist()   { return JSON.parse(readFileSync(WHITELIST, 'utf8')); }
function saveWhitelist(wl) { writeFileSync(WHITELIST, JSON.stringify(wl, null, 2) + '\n'); }

function getPerryPubkeys() {
  const wl = loadWhitelist();
  return [wl.perry_zoomer, wl.perry_goosie].filter(Boolean);
}

// All allowed senders: Perry + every goose in the formation
function getAllowedSenders() {
  const perry = getPerryPubkeys();
  try {
    const agents = JSON.parse(readFileSync(AGENTS_JSON, 'utf8'));
    const geesePubkeys = agents.agents.map(a => a.pubkey).filter(Boolean);
    return [...new Set([...perry, ...geesePubkeys])];
  } catch {
    return perry; // fallback: Perry only if agents.json unreadable
  }
}

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*[mGKHJA-Z]/g, '').replace(/\x1B\[[0-9]*[JK]/g, '');
}

// ── Healthy: server diagnostics ───────────────────────────────────────────────

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
    return stripAnsi(out).trim().slice(0, 3000);
  } catch (err) {
    return `Exit ${err.status ?? '?'}\n${stripAnsi(err.stdout?.toString() ?? '').trim()}`.slice(0, 3000);
  }
}

const HEALTHY_SYSTEM_PROMPT = `You are Healthy, the server health monitor for Goosie Labs.

Server: Ubuntu 24.04 DigitalOcean VPS, 1.9 GB RAM, 2 GB swap.

You monitor: RAM/swap/disk, nginx, strfry (Nostr relay), lnbits, nutshell (Cashu mint), blocky, goose-runner.

Use your tools to check the current state and give a clear, concise answer.
Use 🟢🟡🔴 when appropriate. Be direct about problems.
Reply in the same language as Perry's message (Dutch or English).`;

// ── Assistenty: V-Formation coordinator ──────────────────────────────────────

// Maps goose → available commands with their shell invocations
const GOOSE_ROSTER = {
  healthy: {
    emoji: '🏥', label: 'Server health',
    commands: {
      check: { cmd: '/usr/local/bin/checkhealthy', timeout: 30_000, desc: 'Full server health report (RAM, disk, services)' },
    },
  },
  secury: {
    emoji: '🛡️', label: 'Security watchdog',
    commands: {
      check:  { cmd: 'node /home/deploy/scripts/secury/index.js check',  timeout: 60_000, desc: 'fail2ban status, open ports, recent SSH logins' },
      logs:   { cmd: 'node /home/deploy/scripts/secury/index.js logs',   timeout: 60_000, desc: 'nginx log analysis: suspicious IPs, bots' },
      report: { cmd: 'node /home/deploy/scripts/secury/index.js report', timeout: 120_000, desc: 'Full security report including npm audits' },
    },
  },
  jurry: {
    emoji: '⚖️', label: 'Legal & compliance',
    commands: {
      overview: { cmd: 'node /home/deploy/scripts/jurry/index.js overview',  timeout: 120_000, desc: 'Legal status summary of all apps' },
      licenses: { cmd: 'node /home/deploy/scripts/jurry/index.js licenses',  timeout: 120_000, desc: 'npm license compliance check' },
    },
  },
  ay: {
    emoji: '🪿', label: 'AI config specialist',
    commands: {
      check:    { cmd: 'node /home/deploy/scripts/ay/index.js check',    timeout: 60_000, desc: 'Check V-Formation agent configs for issues' },
      overview: { cmd: 'node /home/deploy/scripts/ay/index.js overview', timeout: 60_000, desc: 'Full overview of V-Formation health' },
    },
  },
};

// Build enum values: "healthy:check", "secury:check", "secury:logs", etc.
const GOOSE_COMMAND_ENUM = Object.entries(GOOSE_ROSTER).flatMap(([goose, cfg]) =>
  Object.entries(cfg.commands).map(([cmd, info]) => ({
    value: `${goose}:${cmd}`,
    desc: `${cfg.emoji} ${cfg.label} — ${info.desc}`,
  }))
);

const ASSISTENTY_TOOLS = [
  {
    name: 'ask_goose',
    description: `Delegate a task to a specialist goose and get their report back.
Available geese:\n${GOOSE_COMMAND_ENUM.map(e => `  ${e.value}: ${e.desc}`).join('\n')}`,
    input_schema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          enum: GOOSE_COMMAND_ENUM.map(e => e.value),
          description: 'Which goose and command to run, format: "goose:command"',
        },
      },
      required: ['task'],
    },
  },
];

function assistentyExecute(name, input) {
  if (name !== 'ask_goose') return `Unknown tool: ${name}`;
  const [goose, cmd] = (input.task ?? '').split(':');
  const roster = GOOSE_ROSTER[goose];
  if (!roster) return `Unknown goose: ${goose}`;
  const spec = roster.commands[cmd];
  if (!spec) return `Unknown command "${cmd}" for ${goose}`;

  console.log(`[dm-listener] assistenty → ${goose}:${cmd}`);
  try {
    const out = execSync(spec.cmd, {
      timeout: spec.timeout,
      env: { ...process.env, TERM: 'xterm-256color' },
    }).toString();
    return `[${roster.emoji} ${goose}]\n${stripAnsi(out).trim()}`.slice(0, 4000);
  } catch (err) {
    const out = stripAnsi(err.stdout?.toString() ?? '').trim();
    return `[${roster.emoji} ${goose}] Exit ${err.status ?? '?'}\n${out}`.slice(0, 4000);
  }
}

// Whitelist management — bypass Claude for explicit "whitelist ..." commands
function handleWhitelistCommand(text) {
  const parts = text.trim().split(/\s+/);
  const sub   = parts[1]?.toLowerCase();

  if (sub === 'list') {
    const wl = loadWhitelist();
    const entries = Object.entries(wl)
      .filter(([, v]) => /^[0-9a-f]{64}$/.test(v))
      .map(([k, v]) => `  ${k}: ${v.slice(0, 8)}…`)
      .join('\n');
    return `Whitelist (${entries.split('\n').length} entries):\n${entries}`;
  }

  if (sub === 'remove') {
    const label = parts[2];
    if (!label) return 'Usage: whitelist remove <label>';
    const wl = loadWhitelist();
    if (!wl[label]) return `Not found: ${label}`;
    if (['_comment', 'perry_zoomer', 'perry_goosie', 'manager'].includes(label))
      return `Cannot remove protected entry: ${label}`;
    delete wl[label];
    saveWhitelist(wl);
    return `Removed ${label} from whitelist.`;
  }

  // whitelist <npub|hex> [label]
  const raw   = parts[1];
  const label = parts[2] || null;
  if (!raw) return 'Usage:\n  whitelist list\n  whitelist <npub|hex> [label]\n  whitelist remove <label>';

  let pubkeyHex;
  try {
    pubkeyHex = raw.startsWith('npub1')
      ? nip19.decode(raw).data
      : /^[0-9a-f]{64}$/i.test(raw) ? raw.toLowerCase() : null;
  } catch { pubkeyHex = null; }
  if (!pubkeyHex) return `Invalid key: ${raw}`;

  const wl = loadWhitelist();
  const existing = Object.entries(wl).find(([, v]) => v === pubkeyHex);
  if (existing) return `Already whitelisted as: ${existing[0]}`;

  const finalLabel = label || `user_${pubkeyHex.slice(0, 8)}`;
  if (wl[finalLabel]) return `Label taken: ${finalLabel}`;
  wl[finalLabel] = pubkeyHex;
  saveWhitelist(wl);

  let npub;
  try { npub = nip19.npubEncode(pubkeyHex); } catch { npub = pubkeyHex; }
  return `Added:\n  label: ${finalLabel}\n  npub:  ${npub}`;
}

const ASSISTENTY_SYSTEM_PROMPT = `Je bent Assistenty, de coördinator van de V-Formatie bij Goosie Labs.

Perry praat met jou. Jij bevraagt de specialist-ganzen en rapporteert terug aan Perry.

De V-Formatie specialisten die jij kunt raadplegen:
- 🏥 Healthy: server gezondheid — RAM, disk, services, uptime
- 🛡️ Secury: beveiliging — fail2ban, nginx-logs, poorten, npm-kwetsbaarheden
- ⚖️ Jurry: juridisch en compliance — licenties, privacy, aansprakelijkheid per app
- 🪿 Ay: AI-configuratie — ganzen-prompts, V-formatie kwaliteit

Werkwijze:
1. Bepaal welke specialisten relevant zijn voor Perry's vraag
2. Gebruik ask_goose om ze te raadplegen (meerdere tegelijk mag en is vaak beter)
3. Synthetiseer hun bevindingen in een helder, concreet antwoord voor Perry
4. Als er actie nodig is: noem die expliciet

Context over het project:
- Goosie Labs — experimenten met Nostr, Lightning en AI op een Ubuntu 24.04 VPS
- Stack: Node.js v20, strfry relay, LNbits, Cashu mint, ~20 actieve apps
- Perry is technisch maar heeft weinig tijd — wees bondig en concreet

Taal: Nederlands, tenzij Perry Engels schrijft.
Toon: direct en professioneel, geen overbodige beleefdheden.`;

// ── Goose registry ────────────────────────────────────────────────────────────

const GEESE_CONFIG = {
  assistenty: {
    systemPrompt: ASSISTENTY_SYSTEM_PROMPT,
    tools:        ASSISTENTY_TOOLS,
    executeTool:  assistentyExecute,
    preprocess:   (text) => text.trim().toLowerCase().startsWith('whitelist')
                    ? handleWhitelistCommand(text)
                    : null,
  },
  healthy: {
    systemPrompt: HEALTHY_SYSTEM_PROMPT,
    tools:        HEALTHY_TOOLS,
    executeTool:  healthyExecute,
    preprocess:   null,
  },
};

const ENABLED_GEESE = ['assistenty', 'healthy'];

// ── Claude API — tool loop with parallel tool execution ───────────────────────

async function askClaude(gooseName, userMessage) {
  const config = GEESE_CONFIG[gooseName];
  if (!config) return `No AI config for ${gooseName}.`;

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return 'ANTHROPIC_API_KEY not configured.';

  // Preprocessor — bypass Claude for direct commands (e.g. "whitelist list")
  if (config.preprocess) {
    const direct = config.preprocess(userMessage);
    if (direct !== null) return typeof direct === 'string' ? direct : await direct;
  }

  const messages = [{ role: 'user', content: userMessage }];
  const MAX_ITER = 8;
  let totalInputTokens = 0, totalOutputTokens = 0, totalToolCalls = 0;
  const model = 'claude-haiku-4-5-20251001';

  for (let i = 0; i < MAX_ITER; i++) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system:     config.systemPrompt,
        messages,
        tools:      config.tools,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error(`[dm-listener] Claude API ${resp.status}: ${err.slice(0, 200)}`);
      return `AI brain error (${resp.status}) — probeer het later opnieuw.`;
    }

    const data = await resp.json();
    totalInputTokens  += data.usage?.input_tokens  ?? 0;
    totalOutputTokens += data.usage?.output_tokens ?? 0;

    if (data.stop_reason === 'end_turn') {
      logUsage(gooseName, model, totalInputTokens, totalOutputTokens, totalToolCalls);
      return data.content?.find(b => b.type === 'text')?.text?.trim() ?? '(no response)';
    }

    if (data.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: data.content });

      // Execute all tool calls in parallel
      const toolBlocks = data.content.filter(b => b.type === 'tool_use');
      totalToolCalls += toolBlocks.length;
      const toolResults = await Promise.all(toolBlocks.map(async block => {
        console.log(`[dm-listener] ${gooseName} → ${block.name}(${JSON.stringify(block.input)})`);
        const result = await config.executeTool(block.name, block.input);
        return { type: 'tool_result', tool_use_id: block.id, content: result };
      }));

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    const text = data.content?.find(b => b.type === 'text')?.text?.trim();
    return text ?? `Stopped: ${data.stop_reason}`;
  }

  return 'Te veel stappen nodig — stel een specifiekere vraag.';
}

// ── NIP-17 reply ──────────────────────────────────────────────────────────────

async function sendReply(gooseSK, toPubkey, message) {
  return new Promise((resolve) => {
    const pool = new SimplePool();
    const wrapped = nip17.wrapEvent(gooseSK, { publicKey: toPubkey }, message);
    Promise.allSettled([pool.publish([RELAY], wrapped)]).then(() => {
      pool.close([RELAY]);
      resolve();
    });
    setTimeout(() => { pool.close([RELAY]); resolve(); }, 8_000);
  });
}

// ── Relay listener ────────────────────────────────────────────────────────────

const processed      = new Set();
const geese          = ENABLED_GEESE.map(loadKey);
const pubkeyMap      = Object.fromEntries(geese.map(g => [g.pubkey, g]));
const perryKeys      = getPerryPubkeys();
const allowedSenders = getAllowedSenders();

let ws;
let reconnectTimer;

console.log(`[dm-listener] geese: ${geese.map(g => g.name).join(', ')}`);
console.log(`[dm-listener] perry: ${perryKeys.map(p => p.slice(0, 8) + '…').join(', ')}`);
console.log(`[dm-listener] allowed senders: Perry (${perryKeys.length}) + geese (${allowedSenders.length - perryKeys.length}) = ${allowedSenders.length} total`);

function connect() {
  ws = new WebSocket(RELAY);

  ws.onopen = () => {
    console.log(`[dm-listener] connected`);
    ws.send(JSON.stringify([
      'REQ', 'dm-listener',
      { kinds: [1059], '#p': geese.map(g => g.pubkey), since: Math.floor(Date.now() / 1000) - 259200 },
    ]));
  };

  ws.onmessage = async (event) => {
    let msg;
    try { msg = JSON.parse(event.data.toString()); } catch { return; }

    const [type, , ev] = msg;
    if (type !== 'EVENT' || !ev) return;
    if (processed.has(ev.id)) return;
    processed.add(ev.id);

    const recipientPubkey = ev.tags?.find(t => t[0] === 'p')?.[1];
    const goose = pubkeyMap[recipientPubkey];
    if (!goose) return;

    let rumor;
    try { rumor = nip17.unwrapEvent(ev, goose.sk); } catch { return; }

    const senderPubkey = rumor.pubkey;
    const text = rumor.content?.trim();
    if (!text) return;

    console.log(`[dm-listener] DM to ${goose.name} from ${senderPubkey.slice(0, 8)}…: "${text.slice(0, 80)}"`);

    if (!allowedSenders.includes(senderPubkey)) {
      console.log(`[dm-listener] ${senderPubkey.slice(0, 8)}… not authorized — ignored`);
      return;
    }

    let reply;
    try {
      reply = await askClaude(goose.name, text);
    } catch (err) {
      console.error(`[dm-listener] error: ${err.message}`);
      reply = `Er ging iets mis: ${err.message}`;
    }

    console.log(`[dm-listener] reply (${reply.length} chars): "${reply.slice(0, 60)}…"`);
    try {
      await sendReply(goose.sk, senderPubkey, reply);
      console.log(`[dm-listener] sent ✓`);
    } catch (err) {
      console.error(`[dm-listener] send failed: ${err.message}`);
    }
  };

  ws.onclose = () => {
    console.log(`[dm-listener] disconnected — reconnect in 10s`);
    reconnectTimer = setTimeout(connect, 10_000);
  };

  ws.onerror = (e) => console.error(`[dm-listener] ws error: ${e.message}`);
}

process.on('SIGTERM', () => {
  console.log('[dm-listener] shutting down');
  clearTimeout(reconnectTimer);
  ws?.close();
  process.exit(0);
});

connect();
console.log('[dm-listener] started');
