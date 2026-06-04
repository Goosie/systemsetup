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
    break;

  case 'advies':
    await advies(PATHS);
    break;

  case 'overview':
    await overview(PATHS);
    break;

  default:
    console.log(`Onbekend commando: "${command}"`);
    console.log(`Gebruik: check | advies | overview`);
    process.exit(1);
}

console.log(`\n✅ Ay klaar.\n`);
