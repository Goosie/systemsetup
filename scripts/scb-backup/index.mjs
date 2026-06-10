#!/usr/bin/env node
/**
 * scb-backup — LND onderhoud: SCB backup + TLS cert check
 *
 * Elke dag (144 blokken via Blocky):
 *   1. Kopieert channel.backup van Umbrel, bewaart 14 versies
 *   2. Vergelijkt TLS cert op Umbrel met lokale kopie
 *      → bij wijziging: cert vervangen + LNbits herstarten
 *
 * Gebruik:
 *   node index.mjs           # backup + cert check
 *   node index.mjs --dry-run # tonen zonder wijzigingen
 */

import { execSync, execFileSync, spawnSync } from 'child_process';
import { existsSync, readdirSync, unlinkSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

const DRY_RUN     = process.argv.includes('--dry-run');
const UMBREL_HOST = 'umbrel@100.111.14.11';

const REMOTE_SCB  = '/home/umbrel/umbrel/app-data/lightning/data/lnd/data/chain/bitcoin/mainnet/channel.backup';
const REMOTE_CERT = '/home/umbrel/umbrel/app-data/lightning/data/lnd/tls.cert';
const LOCAL_CERT  = '/home/deploy/lnbits/lnd-certs/tls.cert';
const BACKUP_DIR  = '/home/deploy/backups/lnd-scb';
const KEEP        = 14;

function md5(path) {
  return createHash('md5').update(readFileSync(path)).digest('hex');
}

function scpFrom(remote, local) {
  execFileSync('scp', [
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=10',
    `${UMBREL_HOST}:${remote}`,
    local,
  ], { stdio: 'inherit' });
}

// ── 1. SCB backup ─────────────────────────────────────────────────────────────

console.log(`\n📦 SCB backup — ${new Date().toISOString()}`);

const ts     = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dst    = join(BACKUP_DIR, `channel.backup.${ts}`);
const latest = join(BACKUP_DIR, 'channel.backup.latest');

if (DRY_RUN) {
  console.log(`   Dry-run — zou kopiëren naar ${dst}`);
} else {
  try {
    scpFrom(REMOTE_SCB, dst);
    const size = statSync(dst).size;
    const hash = md5(dst);
    if (existsSync(latest)) {
      const prevHash = md5(latest);
      if (hash === prevHash) {
        console.log(`✅ Backup opgeslagen (${size} bytes) — ongewijzigd`);
      } else {
        console.log(`✅ Backup opgeslagen (${size} bytes) — ⚠️  GEWIJZIGD (nieuw kanaal?)`);
      }
    } else {
      console.log(`✅ Eerste backup opgeslagen (${size} bytes)`);
    }
    execSync(`cp ${dst} ${latest}`);
    // Opruimen — max KEEP versies bewaren
    const files = readdirSync(BACKUP_DIR).filter(f => f.startsWith('channel.backup.2')).sort();
    while (files.length > KEEP) {
      const old = join(BACKUP_DIR, files.shift());
      unlinkSync(old);
      console.log(`🗑  Oud bestand verwijderd: ${old}`);
    }
    const kept = readdirSync(BACKUP_DIR).filter(f => f.startsWith('channel.backup.2'));
    console.log(`📁 Bewaard: ${kept.length} versies (max ${KEEP})`);
  } catch (e) {
    console.error(`❌ SCB backup mislukt: ${e.message}`);
  }
}

// ── 2. TLS cert check ─────────────────────────────────────────────────────────

console.log(`\n🔐 TLS cert check`);

const tmpCert = '/tmp/lnd-tls-check.cert';

try {
  scpFrom(REMOTE_CERT, tmpCert);
} catch (e) {
  console.error(`❌ Cert ophalen mislukt: ${e.message}`);
  process.exit(1);
}

const remoteHash = md5(tmpCert);
const localHash  = existsSync(LOCAL_CERT) ? md5(LOCAL_CERT) : null;

if (remoteHash === localHash) {
  console.log('✅ TLS cert ongewijzigd — LNbits hoeft niet herstarten');
} else {
  console.log('⚠️  TLS cert is veranderd op Umbrel!');
  if (DRY_RUN) {
    console.log('   Dry-run — zou cert vervangen en LNbits herstarten');
  } else {
    execSync(`cp ${tmpCert} ${LOCAL_CERT}`);
    console.log(`✅ Nieuw cert opgeslagen: ${LOCAL_CERT}`);
    try {
      execSync('sudo systemctl restart lnbits', { stdio: 'inherit' });
      console.log('✅ LNbits herstart met nieuw cert');
    } catch (e) {
      console.error(`❌ LNbits herstart mislukt: ${e.message}`);
    }
  }
}

execSync(`rm -f ${tmpCert}`);

console.log('\n✅ scb-backup klaar\n');
