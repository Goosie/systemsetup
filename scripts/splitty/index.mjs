#!/usr/bin/env node
/**
 * Splitty — flock treasurer maintenance.
 *
 * The splitpayments extension splits each INCOMING payment by percentage and
 * rounds down to whole sats, so a little dust accumulates in Splitty's wallet.
 * `sweep` empties that residual balance across all targets (every goose with a
 * wallet + Perry), fully — base share to everyone, the remainder handed out one
 * sat at a time with a rotating start so it stays fair over many sweeps.
 *
 * Usage: node index.mjs sweep
 * Triggered periodically by Blocky (see DEFAULT_SCHEDULE).
 */
'use strict';

import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';

const LNBITS      = 'http://127.0.0.1:5000';
const AGENTS_DIR  = '/home/deploy/agents';
const LNBITS_DB   = '/home/deploy/lnbits/data/database.sqlite3';

const command = process.argv[2] || 'sweep';

async function lnbits(path, { method = 'GET', key, body } = {}) {
  const res = await fetch(`${LNBITS}${path}`, {
    method,
    headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  return data;
}

// Internal LNbits transfer: invoice on the target, paid from Splitty.
async function transfer(targetInkey, splittyAdminkey, sats, memo) {
  const inv = await lnbits('/api/v1/payments', {
    method: 'POST', key: targetInkey,
    body: { out: false, amount: sats, memo },
  });
  const bolt11 = inv.payment_request || inv.bolt11;
  if (!bolt11) throw new Error('no invoice returned');
  await lnbits('/api/v1/payments', {
    method: 'POST', key: splittyAdminkey,
    body: { out: true, bolt11 },
  });
}

function loadTargets() {
  // All geese with a wallet file, except Splitty itself
  const targets = readdirSync(AGENTS_DIR)
    .filter(n => n !== 'splitty' && existsSync(resolve(AGENTS_DIR, n, 'lnbits-wallet.json')))
    .map(n => {
      const w = JSON.parse(readFileSync(resolve(AGENTS_DIR, n, 'lnbits-wallet.json'), 'utf8'));
      return { name: n, inkey: w.inkey, wallet_id: w.wallet_id };
    })
    .filter(t => t.inkey && t.wallet_id);

  // + Perry's personal wallet (he shares in the flock income too)
  try {
    const row = execSync(
      `sqlite3 "${LNBITS_DB}" "SELECT inkey||'|'||id FROM wallets WHERE name='Perry' LIMIT 1;"`,
      { encoding: 'utf8' }
    ).trim();
    const [inkey, wallet_id] = row.split('|');
    if (inkey && wallet_id && !targets.some(t => t.wallet_id === wallet_id)) {
      targets.push({ name: 'perry', inkey, wallet_id });
    }
  } catch { /* Perry wallet not found — sweep over geese only */ }

  return targets;
}

async function sweep() {
  const splitty = JSON.parse(readFileSync(resolve(AGENTS_DIR, 'splitty', 'lnbits-wallet.json'), 'utf8'));

  const wallet = await lnbits('/api/v1/wallet', { key: splitty.adminkey });
  const dust = Math.floor((wallet.balance ?? 0) / 1000); // msat → sat
  if (dust <= 0) { console.log('🧹 Splitty: no dust to sweep (balance 0).'); return; }

  const targets = loadTargets();
  const n = targets.length;
  if (!n) { console.log('⚠️  No targets — nothing swept.'); return; }

  const base = Math.floor(dust / n);
  let rem    = dust % n;
  // Rotate which targets get the +1 remainder so it stays fair across sweeps.
  const offset = Math.floor(Date.now() / 600000) % n; // shifts ~every block
  const ordered = [...targets.slice(offset), ...targets.slice(0, offset)];

  let sent = 0, ok = 0;
  for (let i = 0; i < ordered.length; i++) {
    const amount = base + (i < rem ? 1 : 0);
    if (amount <= 0) continue;
    try {
      await transfer(ordered[i].inkey, splitty.adminkey, amount, 'Splitty dust sweep');
      sent += amount; ok++;
    } catch (e) {
      console.log(`  ⚠️  ${ordered[i].name}: ${e.message}`);
    }
  }
  console.log(`🧹 Splitty swept ${sent} sats over ${ok}/${n} targets (was ${dust} dust).`);
}

(async () => {
  if (command !== 'sweep') { console.log('Usage: index.mjs sweep'); process.exit(1); }
  try { await sweep(); }
  catch (e) { console.error('sweep failed:', e.message); process.exit(1); }
})();
