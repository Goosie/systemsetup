#!/usr/bin/env node
/**
 * sats-thanks.mjs — Geese say thanks when sats arrive
 *
 * Opens a LNbits WebSocket for each goose wallet.
 * On incoming payment: the goose publishes a public kind:1 Nostr note.
 *
 * Usage:  node /home/deploy/scripts/humany/sats-thanks.mjs
 * Service: sudo systemctl start sats-thanks
 */

import 'websocket-polyfill';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import WebSocket from 'ws';
import { nip17, finalizeEvent, SimplePool } from 'nostr-tools';

const AGENTS_DIR = '/home/deploy/agents';
const RELAY      = 'ws://127.0.0.1:7778';
const LNBITS_WS  = 'wss://lnbits.goosielabs.com/api/v1/ws';

// ── Message variety ───────────────────────────────────────────────────────────

const MESSAGES = [
  (name, sats) => `⚡ ${sats} sats just landed in my wallet — thank you! The V-Formation flies on 🪿 #vformation`,
  (name, sats) => `Honk! 🪿 Someone just donated ${sats} sats to ${name}. Much appreciated! ⚡ #vformation`,
  (name, sats) => `Thanks for the donation! ⚡ ${sats} sats received — every sat counts 🪿 #vformation`,
  (name, sats) => `⚡ ${sats} sats in — thank you for supporting the flock! 🪿 #vformation goosielabs.com`,
  (name, sats) => `🪿 ${name} just received ${sats} sats. Thank you! The formation keeps flying ⚡ #vformation`,
];

function pickMessage(name, sats) {
  return MESSAGES[Math.floor(Math.random() * MESSAGES.length)](name, sats);
}

// ── Nostr publish ─────────────────────────────────────────────────────────────

async function publishThanks(gooseName, sk, sats) {
  const content = pickMessage(gooseName, sats);
  const pool = new SimplePool();
  const event = finalizeEvent({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['t', 'vformation'], ['t', 'sats']],
    content,
  }, sk);
  await Promise.allSettled(pool.publish([RELAY], event));
  pool.close([RELAY]);
  console.log(`[sats-thanks] ${gooseName} → "${content.slice(0, 60)}…"`);
}

// ── Per-goose listener ────────────────────────────────────────────────────────

function watchWallet(gooseName, inkey, sk) {
  let ws;
  let reconnectTimer;
  const logTag = `[${gooseName}]`;

  function connect() {
    ws = new WebSocket(`${LNBITS_WS}/${inkey}`);

    ws.onopen = () => {
      console.log(`${logTag} watching wallet`);
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data.toString());
        const payment = msg.payment;
        if (!payment) return;

        // Only incoming payments (amount > 0) that are settled
        if (payment.amount <= 0) return;
        if (payment.pending) return;

        const sats = Math.floor(payment.amount / 1000);
        if (sats < 1) return; // ignore sub-sat amounts

        await publishThanks(gooseName, sk, sats);
      } catch (e) {
        console.error(`${logTag} message error: ${e.message}`);
      }
    };

    ws.onclose = () => {
      console.log(`${logTag} disconnected — reconnect in 15s`);
      reconnectTimer = setTimeout(connect, 15_000);
    };

    ws.onerror = (e) => {
      console.error(`${logTag} ws error: ${e.message}`);
    };
  }

  connect();
}

// ── Load all geese and start ──────────────────────────────────────────────────

const geese = readdirSync(AGENTS_DIR)
  .filter(name => {
    const wf = resolve(AGENTS_DIR, name, 'lnbits-wallet.json');
    const kf = resolve(AGENTS_DIR, name, 'nostr-key.json');
    return existsSync(wf) && existsSync(kf);
  })
  .map(name => {
    const w  = JSON.parse(readFileSync(resolve(AGENTS_DIR, name, 'lnbits-wallet.json'), 'utf8'));
    const k  = JSON.parse(readFileSync(resolve(AGENTS_DIR, name, 'nostr-key.json'), 'utf8'));
    const sk = new Uint8Array(k.nsecHex.match(/.{2}/g).map(b => parseInt(b, 16)));
    return { name, inkey: w.inkey, sk };
  })
  .filter(g => g.inkey);

console.log(`[sats-thanks] watching ${geese.length} goose wallets`);

for (const goose of geese) {
  // Stagger connections slightly to avoid hammering LNbits on startup
  await new Promise(r => setTimeout(r, 200));
  watchWallet(goose.name, goose.inkey, goose.sk);
}

process.on('SIGTERM', () => {
  console.log('[sats-thanks] shutting down');
  process.exit(0);
});
