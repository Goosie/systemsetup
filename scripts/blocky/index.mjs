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
import { resolve } from 'path';
import { getPublicKey, finalizeEvent, SimplePool } from 'nostr-tools';

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
  tessa:  { interval_blocks: 144,  command: 'run-all',  description: '~1 day'   },
  secury: { interval_blocks: 1008, command: 'check',    description: '~1 week'  },
  jurry:  { interval_blocks: 4032, command: 'overview', description: '~4 weeks' },
  haitje: { interval_blocks: 2016, command: 'check',    description: '~2 weeks' },
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

// ── Main ──────────────────────────────────────────────────────────────────────

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
