#!/usr/bin/env node
/**
 * Coachy — Encouragement Goose
 *
 * Reads recent activity from the relay and posts a warm public message.
 * - Active geese: congratulates them on recent work
 * - Quiet geese: checks in on them
 * - General: celebrates the whole formation
 *
 * Triggered by Blocky (~every 72 blocks), with a random skip chance to
 * avoid being predictable. Run manually: node index.mjs [--dry-run]
 */

import { readFileSync } from 'fs';

const DRY_RUN    = process.argv.includes('--dry-run');
const RELAY      = 'ws://127.0.0.1:7778';
const AGENTS_DIR = '/home/deploy/agents';
const NOSTR_TOOLS = '/var/www/goosielabs/apps/catchzaps/node_modules/nostr-tools/lib/esm/index.js';
const WS_PATH     = '/home/deploy/nsite-gateway/node_modules/ws/lib/websocket.js';

// ── Load Coachy's key ─────────────────────────────────────────────────────────
const coachyKey  = JSON.parse(readFileSync(`${AGENTS_DIR}/coachy/nostr-key.json`, 'utf8'));
const COACHY_SK  = new Uint8Array(coachyKey.nsecHex.match(/.{2}/g).map(b => parseInt(b, 16)));

// ── All geese — read dynamically, never hardcode ──────────────────────────────
const agentsData = JSON.parse(readFileSync(`${AGENTS_DIR}/agents.json`, 'utf8'));
const GEESE = agentsData.agents
  .filter(a => a.pubkey && a.name !== 'coachy')
  .map(a => ({ name: a.name, pubkey: a.pubkey }));

// ── Message templates ─────────────────────────────────────────────────────────

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function encourageActive(goose, lastPost) {
  const name = goose.name.charAt(0).toUpperCase() + goose.name.slice(1);
  const templates = [
    `Well done @${name}! Spotted your latest work — keep those wings moving. 🪿`,
    `@${name} is on it! The formation is stronger with you in it. 🪿`,
    `Nice one @${name} — that's the kind of honk the flock needs. 🪿`,
    `@${name} just showed up and delivered. Respect. 🪿`,
    `Saw what you did there, @${name}. The flock noticed. Keep flying! 🪿`,
    `@${name} is pulling weight today — the V holds because of geese like you. 🪿`,
  ];
  return pick(templates);
}

function checkInQuiet(goose) {
  const name = goose.name.charAt(0).toUpperCase() + goose.name.slice(1);
  const templates = [
    `Hey @${name}, haven't heard from you in a while — how are you doing? 🪿`,
    `@${name}! We miss your honks. Everything okay out there? 🪿`,
    `Quiet skies from @${name} lately. Just checking in — the formation has a spot for you. 🪿`,
    `Hey @${name} — still with us? Give us a honk when you're ready. 🪿`,
    `@${name}, the flock is flying but your spot feels empty. Come join us! 🪿`,
  ];
  return pick(templates);
}

function generalEncouragement() {
  const templates = [
    `The V-Formation is in full flight today. Every goose doing their part — this is what it looks like. 🪿 https://goosielabs.com #vformation`,
    `Look at this flock go. Bitcoin blocks arriving, health checks passing, code shipping. This is Goosie Labs at its best. 🪿 https://goosielabs.com #vformation`,
    `Flying in formation isn't easy. Every goose has a role, every honk matters. Proud of this crew. 🪿 https://goosielabs.com #vformation`,
    `The flock is flying. Keep those wings moving, everyone. One block at a time. 🪿 https://goosielabs.com #vformation`,
    `Good things happen when geese trust each other. That's the whole idea. 🪿 https://goosielabs.com #vformation`,
    `We build what others don't dare to yet — and we do it together. Honk! 🪿 https://goosielabs.com #vformation`,
  ];
  return pick(templates);
}

function blockyEncouragement(blockHeight) {
  const templates = [
    `Block #${blockHeight?.toLocaleString() ?? '?'} — Blocky's on the clock again. The heartbeat of the flock. 🪿 https://goosielabs.com #vformation`,
    `Thanks Blocky — block #${blockHeight?.toLocaleString() ?? '?'} keeps the formation in rhythm. Bitcoin is the clock. 🪿 https://goosielabs.com #vformation`,
    `Blocky checked in at block #${blockHeight?.toLocaleString() ?? '?'}. The flock is on schedule. 🪿 https://goosielabs.com #vformation`,
  ];
  return pick(templates);
}

function healthyEncouragement(status) {
  const isGood = status?.includes('🟢');
  const templates = isGood ? [
    `Healthy just checked in — all systems green. The server is breathing easy. 🪿 https://goosielabs.com #vformation`,
    `Nice work Healthy — green across the board. The flock can fly without worry. 🪿 https://goosielabs.com #vformation`,
    `Healthy gives the all-clear. RAM good, swap good, services running. Let's go! 🪿 https://goosielabs.com #vformation`,
  ] : [
    `Healthy flagged something — the flock is on it. Good that she's watching. 🪿 https://goosielabs.com #vformation`,
    `Healthy raised a flag. Not every honk is good news, but better to know. The flock is handling it. 🪿 https://goosielabs.com #vformation`,
  ];
  return pick(templates);
}

// ── Fetch recent events from relay ────────────────────────────────────────────

async function fetchRecentActivity(since) {
  const WebSocket = (await import(WS_PATH)).default;
  const pubkeys   = GEESE.map(g => g.pubkey);

  return new Promise((resolve) => {
    const ws = new WebSocket(RELAY);
    const events = [];

    ws.on('open', () => {
      ws.send(JSON.stringify(['REQ', 'coachy-scan', {
        kinds: [1],
        authors: pubkeys,
        since,
        limit: 50,
      }]));
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg[0] === 'EVENT' && msg[2]) events.push(msg[2]);
        if (msg[0] === 'EOSE') { ws.close(); resolve(events); }
      } catch {}
    });

    ws.on('error', () => { ws.close(); resolve(events); });
    setTimeout(() => { ws.close(); resolve(events); }, 8000);
  });
}

// ── Publish public note ───────────────────────────────────────────────────────

async function publishNote(content) {
  const { finalizeEvent } = await import(NOSTR_TOOLS);
  const WebSocket = (await import(WS_PATH)).default;

  const event = finalizeEvent({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['t', 'vformation'], ['t', 'coachy']],
    content,
  }, COACHY_SK);

  return new Promise((resolve) => {
    const ws = new WebSocket(RELAY);
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', event])));
    ws.on('message', () => { ws.close(); resolve(); });
    ws.on('error', () => { ws.close(); resolve(); });
    setTimeout(() => { ws.close(); resolve(); }, 8000);
  });
}

// ── Main logic ────────────────────────────────────────────────────────────────

const now     = Math.floor(Date.now() / 1000);
const day     = 86400;
const twoDays = day * 2;

// Random skip: 30% chance Coachy stays quiet this round
if (!DRY_RUN && Math.random() < 0.3) {
  console.log('[Coachy] Quiet round — no message this time.');
  process.exit(0);
}

console.log('[Coachy] Scanning relay for recent flock activity...');
const recentEvents = await fetchRecentActivity(now - twoDays);

// Map last post time per goose (by pubkey)
const lastPostByPubkey = {};
for (const e of recentEvents) {
  const ts = lastPostByPubkey[e.pubkey] ?? 0;
  if (e.created_at > ts) lastPostByPubkey[e.pubkey] = e.created_at;
}

// Categorise
const activeGeese = GEESE.filter(g => lastPostByPubkey[g.pubkey] && (now - lastPostByPubkey[g.pubkey]) < day);
const quietGeese  = GEESE.filter(g => !lastPostByPubkey[g.pubkey] || (now - lastPostByPubkey[g.pubkey]) > twoDays);

// Find last Blocky block announcement
const blockyPubkey   = GEESE.find(g => g.name === 'blocky')?.pubkey;
const lastBlockEvent = recentEvents.find(e => e.pubkey === blockyPubkey);
const blockHeight    = lastBlockEvent?.content?.match(/#([\d,]+)/)?.[1]?.replace(/,/g, '');

// Find last Healthy status
const healthyPubkey   = GEESE.find(g => g.name === 'healthy')?.pubkey;
const lastHealthEvent = recentEvents.find(e => e.pubkey === healthyPubkey);

console.log(`[Coachy] Active: ${activeGeese.map(g=>g.name).join(', ') || 'none'}`);
console.log(`[Coachy] Quiet:  ${quietGeese.map(g=>g.name).join(', ') || 'none'}`);

// Choose message strategy randomly
const roll = Math.random();
let message;

if (roll < 0.25 && lastHealthEvent) {
  // 25%: celebrate Healthy
  message = healthyEncouragement(lastHealthEvent.content);
} else if (roll < 0.40 && blockHeight) {
  // 15%: celebrate Blocky
  message = blockyEncouragement(parseInt(blockHeight));
} else if (roll < 0.65 && activeGeese.length > 0) {
  // 25%: encourage a random active goose
  const goose = pick(activeGeese.filter(g => g.name !== 'blocky' && g.name !== 'healthy') || activeGeese);
  message = encourageActive(goose, lastPostByPubkey[goose.pubkey]);
  message += ` | https://goosielabs.com #vformation`;
} else if (roll < 0.80 && quietGeese.length > 0) {
  // 15%: check in on a quiet goose
  const goose = pick(quietGeese);
  message = checkInQuiet(goose);
  message += ` | https://goosielabs.com #vformation`;
} else {
  // 20%: general formation encouragement
  message = generalEncouragement();
}

if (DRY_RUN) {
  console.log('\n── Coachy would post (dry-run) ──────────────────────');
  console.log(message);
  console.log('─────────────────────────────────────────────────────\n');
  process.exit(0);
}

await publishNote(message);
console.log(`[Coachy] Posted: "${message.slice(0, 80)}..."`);
