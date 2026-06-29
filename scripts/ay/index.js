#!/usr/bin/env node
/**
 * Ay — AI-configuratie agent voor Goosie Labs
 * Gebruik: node /home/deploy/scripts/ay/index.js [commando]
 *
 * Commando's:
 *   check      → controleer alle AI-configuratiebestanden op volledigheid en samenhang
 *   advies     → geef proactief advies over de V-formatie configuratie
 *   overview   → volledig beeld: welke ganzen zijn er, hoe staan ze ervoor
 */

import { checkConfig } from './skills/check.js';
import { advies } from './skills/advies.js';
import { overview } from './skills/overview.js';
import { execSync } from 'child_process';

// Roster drift-check — compares agents/*/nostr-key.json (source of truth) against
// all derived files (agents.json, whitelist, nostr.json, icon/portrait lists,
// gooseAgents.ts). Reports only; exits 1 on hard drift.
function runDrift() {
  console.log(`\n🔎 Roster drift-check:`);
  try {
    execSync('node /home/deploy/systemsetup/scripts/check-roster-drift.mjs', { stdio: 'inherit' });
  } catch {
    console.log('  ⚠️  Drift gevonden — zie hierboven.');
  }
}

const command = process.argv[2] || 'overview';

const PATHS = {
  globalClaude: '/home/deploy/.claude/CLAUDE.md',
  serverClaude: '/home/deploy/CLAUDE.md',
  memory: '/home/deploy/.claude/projects/-home-deploy/memory',
  scripts: '/home/deploy/scripts',
  appsDir: '/var/www/goosielabs/apps',
};

console.log(`\n🪿 Ay — AI-configuratie agent Goosie Labs`);
console.log(`──────────────────────────────────────────────`);

switch (command) {
  case 'check':
    await checkConfig(PATHS);
    runDrift();
    break;

  case 'drift':
    runDrift();
    break;

  case 'advies':
    await advies(PATHS);
    break;

  case 'overview':
    await overview(PATHS);
    break;

  default:
    console.log(`Onbekend commando: "${command}"`);
    console.log(`Gebruik: check | drift | advies | overview`);
    process.exit(1);
}

console.log(`\n✅ Ay klaar.\n`);
