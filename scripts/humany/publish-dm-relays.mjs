#!/usr/bin/env node
/**
 * publish-dm-relays.mjs
 *
 * Publishes kind:10050 (NIP-17 DM relay list) for all geese (or one goose).
 * This tells Nostr clients (Amethyst, Damus, etc.) where to deliver DMs.
 *
 * Usage:
 *   node publish-dm-relays.mjs              # all geese
 *   node publish-dm-relays.mjs healthy      # single goose
 */

import 'websocket-polyfill';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { finalizeEvent, SimplePool } from 'nostr-tools';

const RELAY          = 'ws://127.0.0.1:7778';
const EXTERNAL_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.nostr.band',
];
const ALL_RELAYS     = [RELAY, ...EXTERNAL_RELAYS];
const AGENTS_DIR     = '/home/deploy/agents';
const DM_RELAY       = 'wss://relay.goosielabs.com';

function hexToBytes(hex) {
  return new Uint8Array(hex.match(/.{2}/g).map(b => parseInt(b, 16)));
}

async function publishForGoose(pool, name) {
  const keyFile = resolve(AGENTS_DIR, name, 'nostr-key.json');
  if (!existsSync(keyFile)) {
    console.log(`  ⚠️  ${name}: no nostr-key.json — skipped`);
    return;
  }
  const kd = JSON.parse(readFileSync(keyFile, 'utf8'));
  const sk = hexToBytes(kd.nsecHex);

  const event = finalizeEvent({
    kind: 10050,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['relay', DM_RELAY]],
    content: '',
  }, sk);

  const results = await Promise.allSettled(pool.publish(ALL_RELAYS, event));
  const ok = results.filter(r => r.status === 'fulfilled').length;
  console.log(`  ✅ ${name}: kind 10050 published (${ok}/${ALL_RELAYS.length} relays)`);
}

async function main() {
  const targetGoose = process.argv[2];
  const pool = new SimplePool();

  if (targetGoose) {
    console.log(`Publishing DM relay list for: ${targetGoose}`);
    await publishForGoose(pool, targetGoose);
  } else {
    const dirs = readdirSync(AGENTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .filter(n => existsSync(resolve(AGENTS_DIR, n, 'nostr-key.json')));

    console.log(`Publishing DM relay list for ${dirs.length} geese...\n`);
    for (const name of dirs) {
      await publishForGoose(pool, name);
    }
    console.log(`\nDone. All geese now have kind:10050 → ${DM_RELAY}`);
  }

  pool.close(ALL_RELAYS);
}

main().catch(err => { console.error(err); process.exit(1); });
