#!/usr/bin/env node
/**
 * Blocky — Bitcoin block scheduler for the Goosie Labs V-Formation
 *
 * Uses Bitcoin block height as a decentralized timer.
 * Publishes NIP-90 job requests to the relay when a goose is due.
 * Schedule and last-run state live on the relay — no cron, no server clock.
 */

import 'websocket-polyfill';
import WebSocket from 'ws';
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { getPublicKey, finalizeEvent, SimplePool } from 'nostr-tools';

const HONK = '/home/deploy/.local/bin/honk';

// ── Config ───────────────────────────────────────────────────────────────────

const RELAY       = process.env.RELAY_URL   ?? 'ws://127.0.0.1:7778';
const MEMPOOL_WS  = process.env.MEMPOOL_WS  ?? 'wss://mempool.space/api/v1/ws';
const AGENTS_DIR  = '/home/deploy/agents';

const keyData   = JSON.parse(readFileSync(resolve(AGENTS_DIR, 'blocky/nostr-key.json'), 'utf8'));
const SECRET_KEY = new Uint8Array(keyData.nsecHex.match(/.{2}/g).map(b => parseInt(b, 16)));
const PUBKEY     = keyData.pubkey;

// Default schedule — used when no relay config exists yet.
// All intervals in Bitcoin blocks (~10 min each).
const DEFAULT_SCHEDULE = {
  testy:   { interval_blocks: 144,  command: 'run-all',  description: '~1 day'   },
  secury:  { interval_blocks: 1008, command: 'check',    description: '~1 week'  },
  jurry:   { interval_blocks: 4032, command: 'overview', description: '~4 weeks' },
  ay:      { interval_blocks: 1008, command: 'check',    description: '~1 week (woensdag-ritueel)' },
  backy:   { interval_blocks: 144,  command: 'snapshot', description: '~1 day'   },
  healthy: { interval_blocks: 4,    command: 'check',    description: '~40 min'  },
  coachy:  { interval_blocks: 72,   command: 'check',    description: '~12 hours' },
  commy:   { interval_blocks: 3,    command: 'run',      description: '~30 min'  },
  finny:         { interval_blocks: 6,   command: 'report',       description: '~1 hour'  },
  'finny-wallet': { interval_blocks: 18, command: 'wallet-check', description: '~3 hours — payout wallets (Welcome + onboarding pool) low-balance alert' },
  'scb-backup': { interval_blocks: 144,  command: 'backup',   description: '~1 day'   },
  'regenerate-tiles': { interval_blocks: 144, command: 'regen', description: '~1 day (keep agent ages fresh)' },
  gander:  { interval_blocks: 1008, command: 'scout "nostr use cases people want"', description: '~1 week' },
  'onboarding-clawback': { interval_blocks: 144, command: 'run', description: '~1 day — reclaim expired ProofOfRead onboarding earmarks' },
  splitty: { interval_blocks: 6, command: 'sweep', description: '~1 hour — sweep rounding dust into the flock (no-op when empty)' },
  'whenidie-review': { interval_blocks: 4320, command: 'remind', description: '~1 month — remind Perry to review the family handover doc (whenidie.md)' },
  welcome: { interval_blocks: 1008, command: 'relaylist', description: '~1 week — refresh Welcome NIP-65 relay list (outbox discovery)' },
};

// ── State ────────────────────────────────────────────────────────────────────

let pool;
let schedule  = { ...DEFAULT_SCHEDULE };
let lastRun   = {};   // { goose: block_height }
let currentBlock = 0;
let lastBlockAt  = 0; // unix timestamp of previous block

// ── Relay ────────────────────────────────────────────────────────────────────

async function connectRelay() {
  pool = new SimplePool();

  // Try to load schedule from relay
  try {
    const events = await pool.querySync([RELAY], {
      kinds: [30078],
      '#d': ['vformation-schedule'],
      authors: [PUBKEY],
      limit: 1,
    });
    if (events.length > 0) {
      const loaded = JSON.parse(events[0].content);
      // Merge loaded schedule with defaults (defaults fill in any missing geese)
      schedule = Object.fromEntries(
        Object.entries(DEFAULT_SCHEDULE).map(([goose, defaults]) => [
          goose,
          { ...defaults, ...(loaded[goose] ?? {}) },
        ])
      );
      console.log('📅 Schedule loaded from relay');
    } else {
      await publishSchedule();
      console.log('📅 Default schedule published to relay');
    }
  } catch (e) {
    console.log('⚠️  Could not load schedule from relay, using defaults');
  }

  // Try to load last-run state from relay
  try {
    const events = await pool.querySync([RELAY], {
      kinds: [30078],
      '#d': ['vformation-lastrun'],
      authors: [PUBKEY],
      limit: 1,
    });
    if (events.length > 0) {
      lastRun = JSON.parse(events[0].content);
      console.log('📌 Last-run state loaded from relay:', lastRun);
    } else {
      console.log('📌 No last-run state found — starting fresh');
    }
  } catch (e) {
    console.log('⚠️  Could not load last-run state, starting fresh');
  }
}

async function publishEvent(template) {
  const event = finalizeEvent(template, SECRET_KEY);
  try {
    await Promise.allSettled(pool.publish([RELAY], event));
  } catch (e) {
    console.error('⚠️  Publish failed:', e.message);
  }
  return event;
}

async function publishSchedule() {
  const content = Object.fromEntries(
    Object.entries(schedule).map(([goose, { interval_blocks, command, description }]) => [
      goose, { interval_blocks, command, description }
    ])
  );
  await publishEvent({
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', 'vformation-schedule'],
      ['t', 'vformation'],
    ],
    content: JSON.stringify(content),
  });
}

async function persistLastRun() {
  await publishEvent({
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', 'vformation-lastrun'],
      ['t', 'vformation'],
    ],
    content: JSON.stringify(lastRun),
  });
}

// ── Job request (NIP-90) ─────────────────────────────────────────────────────

async function triggerGoose(goose, blockHeight) {
  const config = schedule[goose];

  console.log(`\n  🚀 Triggering ${goose} (command: ${config.command})`);

  // Backy krijgt een DM via honk (zichtbaar in Swarm) in plaats van NIP-90
  if (goose === 'backy') {
    try {
      execFileSync(HONK, [
        'from', '@blocky',
        `Blok ${blockHeight} bereikt — tijd voor een snapshot! snapshot`,
        'to', '@backy',
      ], { timeout: 30000 });
      console.log(`  ✅ Honk verstuurd naar Backy`);
    } catch (e) {
      console.error(`  ❌ Honk naar Backy mislukt: ${e.message}`);
    }
    lastRun[goose] = blockHeight;
    await persistLastRun();
    return;
  }

  // Regenerate tiles is a local maintenance task
  if (goose === 'regenerate-tiles') {
    try {
      execFileSync('node', [
        '/home/deploy/systemsetup/scripts/regenerate-agent-tiles.mjs',
        String(blockHeight),
      ], { timeout: 60000, stdio: 'inherit' });
      console.log(`  ✅ Agent tiles regenerated`);
    } catch (e) {
      console.error(`  ❌ Tile regeneration failed: ${e.message}`);
    }
    lastRun[goose] = blockHeight;
    await persistLastRun();
    return;
  }

  const event = await publishEvent({
    kind: 5000,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['j', 'vformation-run'],
      ['param', 'goose', goose],
      ['param', 'command', config.command],
      ['param', 'trigger_block', String(blockHeight)],
      ['t', 'vformation'],
    ],
    content: `Run ${goose} at block ${blockHeight}`,
  });

  console.log(`  ✅ Job request published — event id: ${event.id.slice(0, 16)}...`);

  lastRun[goose] = blockHeight;
  await persistLastRun();
}

// ── Block announcement ────────────────────────────────────────────────────────

async function publishBlockAnnouncement(height) {
  const now    = Math.floor(Date.now() / 1000);
  const diffS  = lastBlockAt > 0 ? now - lastBlockAt : null;
  const timing = diffS !== null
    ? `${Math.floor(diffS / 60)}m${String(diffS % 60).padStart(2, '0')}s since last block`
    : 'first block since startup';

  lastBlockAt = now;

  await publishEvent({
    kind: 1,
    created_at: now,
    tags: [
      ['t', 'vformation'],
      ['t', 'block'],
      ['block_height', String(height)],
    ],
    content: `⛏️ Block ${height} — ${timing}`,
  });
}

// ── Block handler ─────────────────────────────────────────────────────────────

async function onBlock(height) {
  // On first block: announce it (so dashboards stay in sync) but skip scheduling
  // to avoid triggering all geese at once on restart.
  if (currentBlock === 0) {
    currentBlock = height;
    console.log(`\n⛏️  Starting at block ${height} — initialising last-run for new geese`);
    await publishBlockAnnouncement(height);

    for (const goose of Object.keys(schedule)) {
      if (!lastRun[goose]) {
        lastRun[goose] = height;
        console.log(`  ${goose}: first seen at block ${height}, will run in ${schedule[goose].interval_blocks} blocks`);
      }
    }
    await persistLastRun();
    return;
  }

  // Ignore duplicate / stale updates — mempool.space pushes the same block in
  // repeated messages. Only act (announce + schedule) on a genuinely new block,
  // so exactly one announcement goes out per mined block.
  if (height <= currentBlock) return;

  currentBlock = height;
  console.log(`\n⛏️  Block ${height}`);
  await publishBlockAnnouncement(height);

  for (const [goose, config] of Object.entries(schedule)) {
    const last        = lastRun[goose] ?? 0;
    const blocksSince = height - last;

    if (blocksSince >= config.interval_blocks) {
      await triggerGoose(goose, height);
    } else {
      const remaining = config.interval_blocks - blocksSince;
      const hours     = Math.round(remaining * 10 / 60);
      console.log(`  ${goose}: ${remaining} blocks to go (~${hours}h)`);
    }
  }
}

// ── mempool.space WebSocket ───────────────────────────────────────────────────

async function fetchCurrentHeight() {
  try {
    const res = await fetch('https://mempool.space/api/blocks/tip/height');
    const height = parseInt(await res.text());
    if (height > 0) {
      console.log(`📍 Current block height: ${height}`);
      await onBlock(height);
    }
  } catch (e) {
    console.log('⚠️  Could not fetch current block height:', e.message);
  }
}

function connectMempool() {
  console.log(`\n🔗 Connecting to mempool.space...`);
  const ws = new WebSocket(MEMPOOL_WS);

  ws.on('open', () => {
    console.log('✅ mempool.space connected');
    ws.send(JSON.stringify({ action: 'want', data: ['blocks'] }));
    fetchCurrentHeight();
  });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.block?.height) {
        await onBlock(msg.block.height);
      }
    } catch (e) {
      console.error('⚠️  Message parse error:', e.message);
    }
  });

  ws.on('close', () => {
    console.log('🔌 mempool.space disconnected — reconnecting in 30s...');
    setTimeout(connectMempool, 30_000);
  });

  ws.on('error', (e) => {
    console.error('❌ mempool.space error:', e.message);
  });
}

// ── Schedule overview command ─────────────────────────────────────────────────

async function showSchedule() {
  const MEMPOOL_API = process.env.MEMPOOL_API ?? 'http://100.111.14.11:3006';

  // Current block height — lokale node eerst, valt terug bij 502/parse-fail
  async function fetchHeight(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const n = parseInt((await res.text()).trim(), 10);
    if (!Number.isFinite(n)) throw new Error('non-numeric response');
    return n;
  }
  let currentHeight = 0;
  try {
    currentHeight = await fetchHeight(`${MEMPOOL_API}/api/blocks/tip/height`);
  } catch {
    try {
      currentHeight = await fetchHeight('https://mempool.space/api/blocks/tip/height');
    } catch { currentHeight = 0; }
  }

  // Relay state ophalen
  const pool = new SimplePool();
  let relaySchedule = {};
  let lastRunState  = {};

  try {
    const [schedEvents, lastrunEvents] = await Promise.all([
      pool.querySync([RELAY], { kinds: [30078], '#d': ['vformation-schedule'], authors: [PUBKEY], limit: 1 }),
      pool.querySync([RELAY], { kinds: [30078], '#d': ['vformation-lastrun'],  authors: [PUBKEY], limit: 1 }),
    ]);
    if (schedEvents.length > 0) relaySchedule = JSON.parse(schedEvents[0].content);
    if (lastrunEvents.length > 0) lastRunState = JSON.parse(lastrunEvents[0].content);
  } catch { /* gebruik defaults */ }

  pool.close([RELAY]);

  // Canoniek schema: defaults als basis, relay als override
  const canon = Object.fromEntries(
    Object.entries(DEFAULT_SCHEDULE).map(([goose, defaults]) => [
      goose, { ...defaults, ...(relaySchedule[goose] ?? {}) }
    ])
  );

  const CYAN = '\x1b[36m'; const BOLD = '\x1b[1m'; const RESET = '\x1b[0m';
  const GREEN = '\x1b[32m'; const YELLOW = '\x1b[33m';

  console.log(`\n${BOLD}🪿 Blocky — V-Formation Schedule${RESET}`);
  console.log(`${'─'.repeat(72)}`);
  console.log(`📍 Current block: ${BOLD}${currentHeight.toLocaleString()}${RESET}\n`);

  const cols = ['Goose', 'Interval', 'Approx', 'Last run', 'Next run', 'ETA'];
  console.log(`  ${BOLD}${cols[0].padEnd(10)}${cols[1].padEnd(10)}${cols[2].padEnd(10)}${cols[3].padEnd(12)}${cols[4].padEnd(12)}${cols[5]}${RESET}`);
  console.log(`  ${'─'.repeat(66)}`);

  for (const [goose, cfg] of Object.entries(canon)) {
    const last     = lastRunState[goose] ?? null;
    const interval = cfg.interval_blocks;
    const next     = last ? last + interval : (currentHeight + interval);
    const blocksTo = next - currentHeight;
    const minsTo   = blocksTo * 10;

    const lastStr  = last ? `#${last.toLocaleString()}` : 'never';
    const nextStr  = `#${next.toLocaleString()}`;
    const etaStr   = blocksTo <= 0
      ? `${GREEN}now${RESET}`
      : blocksTo < 6
        ? `${YELLOW}~${minsTo}m${RESET}`
        : minsTo < 120
          ? `~${minsTo}m`
          : `~${Math.round(minsTo / 60)}h`;

    console.log(`  ${CYAN}${goose.padEnd(10)}${RESET}${String(interval).padEnd(10)}${cfg.description.padEnd(10)}${lastStr.padEnd(12)}${nextStr.padEnd(12)}${etaStr}`);
  }

  console.log(`\n  ${BOLD}Stale relay entries (not in active schedule):${RESET}`);
  const stale = Object.keys(relaySchedule).filter(g => !DEFAULT_SCHEDULE[g]);
  if (stale.length === 0) {
    console.log(`  none`);
  } else {
    for (const g of stale) {
      console.log(`  ⚠  ${g} — in relay schedule but not in DEFAULT_SCHEDULE (can be cleaned up)`);
    }
  }

  console.log();
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (process.argv[2] === 'schedule') {
  await showSchedule();
  process.exit(0);
}

if (process.argv[2] === 'clean-relay') {
  // Publiceert het canonieke DEFAULT_SCHEDULE naar de relay, verwijdert stale entries
  const pool = new SimplePool();
  const content = Object.fromEntries(
    Object.entries(DEFAULT_SCHEDULE).map(([goose, { interval_blocks, command, description }]) => [
      goose, { interval_blocks, command, description }
    ])
  );
  const event = finalizeEvent({
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', 'vformation-schedule'], ['t', 'vformation']],
    content: JSON.stringify(content),
  }, SECRET_KEY);
  await Promise.allSettled(pool.publish([RELAY], event));
  pool.close([RELAY]);
  console.log('✅ Relay schedule bijgewerkt — stale entries verwijderd, healthy toegevoegd.');
  console.log('   Geese in schema:', Object.keys(DEFAULT_SCHEDULE).join(', '));
  process.exit(0);
}

console.log('🪿 Blocky — Bitcoin block scheduler for the V-Formation');
console.log('──────────────────────────────────────────────────────────');
console.log(`📡 Relay:  ${RELAY}`);
console.log(`🔑 Pubkey: ${PUBKEY}`);
console.log(`\n📋 Schedule:`);
for (const [goose, cfg] of Object.entries(DEFAULT_SCHEDULE)) {
  console.log(`  ${goose.padEnd(8)} every ${String(cfg.interval_blocks).padStart(5)} blocks  (${cfg.description})`);
}

await connectRelay();
connectMempool();

console.log('\n⏳ Listening for Bitcoin blocks...\n');
