/**
 * traction-lib.mjs — shared Nostr-traction gathering for Commy's pulses.
 *
 * No side effects on import. Used by:
 *   - flock-traction.mjs (weekly, full per-goose breakdown)
 *   - traffic-pulse.mjs   (daily, compact flock-total line)
 *
 * Counts REAL external engagement per goose across several relays:
 *   followers (kind 3, deduped by author, flock+Perry excluded), reactions (7), zaps (9735).
 * Follower counts are a best-effort lower bound (outbox model — lists live on the
 * follower's own relays).
 */

import { readFileSync } from 'fs';

const NOSTR_TOOLS = '/var/www/goosielabs/apps/skein/node_modules/nostr-tools/lib/esm/index.js';
const WS_PATH     = '/home/deploy/nsite-gateway/node_modules/ws/lib/websocket.js';
const AGENTS      = '/home/deploy/agents/agents.json';
const WHITELIST   = '/home/deploy/whitelist.json';

// Our relay + big public ones (outbox coverage).
export const QUERY_RELAYS = [
  'wss://relay.goosielabs.com',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

export function loadGeese() {
  const data = JSON.parse(readFileSync(AGENTS, 'utf8'));
  const map = {};                     // pubkey -> name
  for (const a of data.agents) if (a.pubkey) map[a.pubkey] = a.name;
  return map;
}

// Returns rows [{ name, followers, reactions, zaps }] sorted by traction desc.
export async function gather(geese) {
  const { SimplePool } = await import(NOSTR_TOOLS);
  globalThis.WebSocket = (await import(WS_PATH)).default;

  const pubkeys = Object.keys(geese);
  const flock   = new Set(pubkeys);
  const wl      = JSON.parse(readFileSync(WHITELIST, 'utf8'));
  const perry   = wl.perry_goosie;
  if (perry) flock.add(perry);        // don't count Perry as external interest

  const pool = new SimplePool();
  let events = [];
  try {
    events = await pool.querySync(QUERY_RELAYS, {
      kinds: [3, 7, 9735],
      '#p': pubkeys,
    }, { maxWait: 12_000 });
  } catch { /* return whatever we have */ }
  try { pool.close(QUERY_RELAYS); } catch {}

  const stats = {};
  for (const pk of pubkeys) stats[pk] = { followers: new Set(), reactions: 0, zaps: 0 };

  for (const ev of events) {
    const targets = ev.tags.filter(t => t[0] === 'p' && stats[t[1]]).map(t => t[1]);
    if (!targets.length) continue;
    for (const pk of targets) {
      if (ev.kind === 3) {
        if (!flock.has(ev.pubkey)) stats[pk].followers.add(ev.pubkey); // external only
      } else if (ev.kind === 7)     stats[pk].reactions++;
      else if (ev.kind === 9735)    stats[pk].zaps++;
    }
  }

  return pubkeys
    .map(pk => ({
      name: geese[pk],
      followers: stats[pk].followers.size,
      reactions: stats[pk].reactions,
      zaps: stats[pk].zaps,
    }))
    .sort((a, b) =>
      b.followers - a.followers || b.reactions - a.reactions || b.zaps - a.zaps || a.name.localeCompare(b.name));
}

// Convenience: flock-wide totals + the top few geese with any traction.
export function totals(rows) {
  return {
    followers: rows.reduce((s, r) => s + r.followers, 0),
    reactions: rows.reduce((s, r) => s + r.reactions, 0),
    zaps: rows.reduce((s, r) => s + r.zaps, 0),
    top: rows.filter(r => r.followers || r.reactions || r.zaps).slice(0, 3),
  };
}
