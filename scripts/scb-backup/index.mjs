#!/usr/bin/env node
/**
 * scb-backup — Static Channel Backup kopiëren van Umbrel naar de server
 *
 * Kopieert channel.backup dagelijks van Umbrel via SSH.
 * Bewaart de laatste 14 versies in /home/deploy/backups/lnd-scb/
 * Logt of het bestand is gewijzigd t.o.v. de vorige backup.
 *
 * Gebruik:
 *   node /home/deploy/scripts/scb-backup/index.mjs          # backup uitvoeren
 *   node /home/deploy/scripts/scb-backup/index.mjs --dry-run # tonen zonder kopiëren
 */

import { execSync, execFileSync } from 'child_process';
import { existsSync, readdirSync, unlinkSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

const DRY_RUN     = process.argv.includes('--dry-run');
const UMBREL_HOST = 'umbrel@100.111.14.11';
const REMOTE_PATH = '/home/umbrel/umbrel/app-data/lightning/data/lnd/data/chain/bitcoin/mainnet/channel.backup';
const BACKUP_DIR  = '/home/deploy/backups/lnd-scb';
const KEEP        = 14;

const ts  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dst = join(BACKUP_DIR, `channel.backup.${ts}`);
const latest = join(BACKUP_DIR, 'channel.backup.latest');

function md5(path) {
  return createHash('md5').update(readFileSync(path)).digest('hex');
}

function cleanup() {
  const files = readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('channel.backup.2'))
    .sort();
  while (files.length > KEEP) {
    const old = join(BACKUP_DIR, files.shift());
    console.log(`🗑  Oud bestand verwijderd: ${old}`);
    if (!DRY_RUN) unlinkSync(old);
  }
}

console.log(`📦 SCB backup — ${new Date().toISOString()}`);
console.log(`   Van: ${UMBREL_HOST}:${REMOTE_PATH}`);
console.log(`   Naar: ${dst}`);

if (DRY_RUN) {
  console.log('🔍 Dry-run — niets gekopieerd');
  process.exit(0);
}

try {
  execFileSync('scp', [
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=10',
    `${UMBREL_HOST}:${REMOTE_PATH}`,
    dst,
  ], { stdio: 'inherit' });
} catch (e) {
  console.error(`❌ SCP mislukt: ${e.message}`);
  process.exit(1);
}

const size = statSync(dst).size;
const hash = md5(dst);

if (existsSync(latest)) {
  const prevHash = md5(latest);
  if (hash === prevHash) {
    console.log(`✅ Backup opgeslagen (${size} bytes) — ongewijzigd t.o.v. vorige backup`);
  } else {
    console.log(`✅ Backup opgeslagen (${size} bytes) — ⚠️  GEWIJZIGD t.o.v. vorige backup (nieuw kanaal?)`);
  }
} else {
  console.log(`✅ Eerste backup opgeslagen (${size} bytes)`);
}

execSync(`cp ${dst} ${latest}`);

cleanup();

const files = readdirSync(BACKUP_DIR).filter(f => f.startsWith('channel.backup.2')).sort();
console.log(`📁 Bewaard: ${files.length} versies (max ${KEEP})`);
console.log(`   Oudste: ${files[0]}`);
console.log(`   Nieuwste: ${files[files.length - 1]}`);
