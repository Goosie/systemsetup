#!/usr/bin/env node
/**
 * Secury — security agent voor Goosie Labs
 * Gebruik: node scripts/secury/index.js [commando]
 *
 * Commando's:
 *   check    → fail2ban status, recente bans, luisterende poorten, SSH-logins
 *   logs     → nginx log analyse: top IPs, verdachte patronen, bots
 *   report   → volledig rapport: check + logs + npm audit per app
 */

import { check } from './skills/check.js';
import { analyzeLogs } from './skills/logs.js';
import { report } from './skills/report.js';

const command = process.argv[2] || 'check';
const APPS_DIR = '/var/www/goosielabs/apps';

console.log(`\n🛡️  Secury — security agent Goosie Labs`);
console.log(`────────────────────────────────────────`);

switch (command) {
  case 'check':
    await check();
    break;

  case 'logs':
    await analyzeLogs();
    break;

  case 'report':
    await report({ appsDir: APPS_DIR });
    break;

  default:
    console.log(`Onbekend commando: "${command}"`);
    console.log(`Gebruik: check | logs | report`);
    process.exit(1);
}

console.log(`\n✅ Secury klaar.\n`);
