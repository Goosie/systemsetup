#!/usr/bin/env node
/**
 * onboarding-clawback — reclaim expired ProofOfRead onboarding rewards.
 *
 * Beginners who pass The Honk Standard get 21 sats held custodially with a
 * 7-day deadline to move them to a wallet they own. Past the deadline the
 * earmark is reclaimed (its slot against the program cap is freed; the sats
 * never left the pool wallet).
 *
 * Triggered by Blocky (~144 blocks ≈ daily) via goose-runner — never cron.
 * Zero dependencies: native fetch → the app's secret-guarded clawback endpoint,
 * so the ProofOfRead API stays the single writer of its SQLite DB.
 *
 * Usage: node index.mjs [run]
 */

import { readFileSync } from 'node:fs';

const API = 'http://127.0.0.1:3002/api/onboard/clawback';
const ENV_FILE = '/var/www/goosielabs/apps/proofofread/api/.env';

function readEnv(key) {
  try {
    for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const m = line.match(new RegExp(`^${key}=(.*)$`));
      if (m) return m[1].trim();
    }
  } catch (e) {
    console.error(`Could not read ${ENV_FILE}: ${e.message}`);
  }
  return '';
}

async function main() {
  const secret = readEnv('ONBOARD_CLAWBACK_SECRET');
  if (!secret) {
    console.error('❌ ONBOARD_CLAWBACK_SECRET not found — is the onboarding wallet set up?');
    process.exit(1);
  }

  let res;
  try {
    res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Clawback-Secret': secret },
    });
  } catch (e) {
    console.error(`❌ ProofOfRead API unreachable: ${e.message}`);
    process.exit(1);
  }

  if (!res.ok) {
    console.error(`❌ Clawback failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
    process.exit(1);
  }

  const { reclaimed, sats } = await res.json();
  if (reclaimed > 0) {
    console.log(`🪿 Clawback: reclaimed ${reclaimed} expired earmark(s), ${sats} sats returned to the pool.`);
  } else {
    console.log('🪿 Clawback: nothing expired — every onboarding reward is still within its 7-day window.');
  }
}

main();
