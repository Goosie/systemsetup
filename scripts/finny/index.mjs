#!/usr/bin/env node
/**
 * Finny — Financial watchdog
 *
 * Reads Claude API usage from dm-listener's usage log and reports costs to Perry.
 * Triggered by Blocky every 6 blocks (~1 hour).
 *
 * Usage:
 *   node /home/deploy/scripts/finny/index.mjs report     # DM Perry a usage report
 *   node /home/deploy/scripts/finny/index.mjs report --dry-run  # print, no DM
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';

const NOSTR_TOOLS = '/var/www/goosielabs/apps/catchzaps/node_modules/nostr-tools/lib/esm/index.js';
const WS_PATH     = '/home/deploy/nsite-gateway/node_modules/ws/lib/websocket.js';
const FINNY_KEY   = '/home/deploy/agents/finny/nostr-key.json';
const WHITELIST   = '/home/deploy/whitelist.json';
const USAGE_LOG   = '/home/deploy/logs/finny/usage.jsonl';
const STATE_FILE  = '/home/deploy/logs/finny/last_report.json';
const RELAY       = 'ws://127.0.0.1:7778';
const DRY_RUN     = process.argv.includes('--dry-run');

// ── Pricing (estimates — update when Anthropic changes rates) ────────────────
const PRICING = {
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },   // $/M tokens
  'claude-haiku-4-5':          { input: 0.80, output: 4.00 },
  'claude-opus-4-7':           { input: 15.0, output: 75.0  },
  'claude-sonnet-4-6':         { input: 3.00, output: 15.0  },
};
const DEFAULT_PRICING = { input: 1.00, output: 5.00 };

function costUsd(model, inputTokens, outputTokens) {
  const p = PRICING[model] ?? DEFAULT_PRICING;
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

// ── Read usage log ────────────────────────────────────────────────────────────

function readUsage() {
  if (!existsSync(USAGE_LOG)) return [];
  return readFileSync(USAGE_LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function loadLastReport() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { ts: 0 }; }
}

function saveLastReport() {
  writeFileSync(STATE_FILE, JSON.stringify({ ts: Math.floor(Date.now() / 1000) }));
}

// ── Aggregate stats ───────────────────────────────────────────────────────────

function aggregate(entries) {
  const totals = { calls: 0, input_tokens: 0, output_tokens: 0, tool_calls: 0, cost_usd: 0 };
  const byGoose = {};
  const byModel = {};

  for (const e of entries) {
    totals.calls++;
    totals.input_tokens  += e.input_tokens  ?? 0;
    totals.output_tokens += e.output_tokens ?? 0;
    totals.tool_calls    += e.tool_calls    ?? 0;
    totals.cost_usd      += costUsd(e.model, e.input_tokens ?? 0, e.output_tokens ?? 0);

    byGoose[e.goose] = (byGoose[e.goose] ?? 0) + 1;
    byModel[e.model] = (byModel[e.model] ?? 0) + 1;
  }

  return { totals, byGoose, byModel };
}

async function getEurRate() {
  try {
    const r = await fetch('https://api.frankfurter.app/latest?from=USD&to=EUR');
    const d = await r.json();
    return d.rates?.EUR ?? 0.92;
  } catch {
    return 0.92; // fallback
  }
}

function fmt(n) { return n.toLocaleString('nl-NL'); }
function fmtCost(usd, eurRate) { return `€${(usd * eurRate).toFixed(4)}`; }

function buildReport(sinceStats, allStats, sinceLabel, eurRate) {
  const lines = [];
  lines.push(`🏦 Finny — API verbruikrapport`);
  lines.push(`${new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', dateStyle: 'short', timeStyle: 'short' })}`);
  lines.push('');

  if (sinceStats.totals.calls > 0) {
    lines.push(`📊 Laatste ${sinceLabel}:`);
    lines.push(`  ${sinceStats.totals.calls} gesprekken · ${fmt(sinceStats.totals.input_tokens)} in / ${fmt(sinceStats.totals.output_tokens)} uit tokens`);
    if (sinceStats.totals.tool_calls > 0) lines.push(`  ${sinceStats.totals.tool_calls} tool calls`);
    lines.push(`  Kosten: ${fmtCost(sinceStats.totals.cost_usd, eurRate)} (schatting)`);
    const gooseList = Object.entries(sinceStats.byGoose).sort((a, b) => b[1] - a[1])
      .map(([g, n]) => `${g} ${n}×`).join(' · ');
    if (gooseList) lines.push(`  Ganzen: ${gooseList}`);
  } else {
    lines.push(`📊 Laatste ${sinceLabel}: geen activiteit`);
  }

  lines.push('');
  lines.push(`📈 Totaal (alle tijd):`);
  lines.push(`  ${allStats.totals.calls} gesprekken · ${fmt(allStats.totals.input_tokens)} in / ${fmt(allStats.totals.output_tokens)} uit tokens`);
  lines.push(`  Kosten: ${fmtCost(allStats.totals.cost_usd, eurRate)} (schatting)`);

  if (Object.keys(allStats.byModel).length > 1) {
    lines.push('');
    lines.push('Modellen:');
    for (const [model, count] of Object.entries(allStats.byModel))
      lines.push(`  ${model}: ${count}×`);
  }

  lines.push('');
  lines.push(`⚠️ Schatting op basis van EUR/USD ${eurRate.toFixed(4)}. Exacte kosten: console.anthropic.com`);

  return lines.join('\n');
}

// ── Send DM ───────────────────────────────────────────────────────────────────

async function sendDM(message) {
  const { nip17 } = await import(NOSTR_TOOLS);
  const WebSocket  = (await import(WS_PATH)).default;
  const finnyKey   = JSON.parse(readFileSync(FINNY_KEY, 'utf8'));
  const finnyPriv  = Buffer.from(finnyKey.nsecHex, 'hex');
  const wl         = JSON.parse(readFileSync(WHITELIST, 'utf8'));
  const perryPubkey = wl.perry_goosie;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY);
    ws.on('open', () => {
      const wrapped = nip17.wrapEvent(finnyPriv, { publicKey: perryPubkey }, message);
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

// ── Main ──────────────────────────────────────────────────────────────────────

const command = process.argv[2] ?? 'report';

if (command === 'report') {
  const allEntries  = readUsage();
  const lastReport  = loadLastReport();
  const sinceEntries = allEntries.filter(e => e.ts > lastReport.ts);

  const allStats   = aggregate(allEntries);
  const sinceStats = aggregate(sinceEntries);

  // Human-readable label for the "since" window
  const minutes = Math.round((Date.now() / 1000 - lastReport.ts) / 60);
  const sinceLabel = lastReport.ts === 0 ? 'alle tijd' :
    minutes < 120 ? `${minutes} min` : `${Math.round(minutes / 60)} uur`;

  const eurRate = await getEurRate();
  const report = buildReport(sinceStats, allStats, sinceLabel, eurRate);

  console.log(report);

  if (!DRY_RUN) {
    try {
      await sendDM(report);
      console.log(`\n✅ DM verstuurd naar Perry`);
      saveLastReport();
    } catch (err) {
      console.error(`DM mislukt: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.log('\n(dry-run — geen DM verstuurd)');
  }
} else {
  console.log(`Onbekend commando: ${command}\nGebruik: report [--dry-run]`);
  process.exit(1);
}
