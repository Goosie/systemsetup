#!/usr/bin/env node
/**
 * Jurry — juridisch agent voor Goosie Labs
 * Gebruik: node scripts/jurry/index.js [commando] [opties]
 *
 * Commando's:
 *   licenses              → controleer npm-licenties van alle apps
 *   licenses <appnaam>    → controleer licenties van één app
 *   review                → volledig juridisch overzicht van alle apps
 *   review <appnaam>      → gedetailleerde review van één app
 *   overview              → samenvatting: status, risico's, aandachtspunten
 */

import { checkLicenses } from './skills/licenses.js';
import { reviewApp } from './skills/review.js';
import { overview } from './skills/overview.js';

const command = process.argv[2] || 'overview';
const target = process.argv[3] || null;

const APPS_DIR = '/var/www/goosielabs/apps';

console.log(`\n⚖️  Jurry — juridisch agent Goosie Labs`);
console.log(`────────────────────────────────────────`);

switch (command) {
  case 'licenses':
    await checkLicenses({ appName: target, appsDir: APPS_DIR });
    break;

  case 'review':
    await reviewApp({ appName: target, appsDir: APPS_DIR });
    break;

  case 'overview':
    await overview({ appsDir: APPS_DIR });
    break;

  default:
    console.log(`Onbekend commando: "${command}"`);
    console.log(`Gebruik: licenses | licenses <app> | review | review <app> | overview`);
    process.exit(1);
}

console.log(`\n✅ Jurry klaar.\n`);
