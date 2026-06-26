#!/usr/bin/env node
/**
 * scb-backup — LND + LNbits daily backup
 *
 * Every day (144 blocks via Blocky):
 *   1. channel.backup from Umbrel — keeps 14 versions
 *   2. TLS cert check — replaces + restarts LNbits if changed
 *   3. LNbits SQLite databases — keeps 14 versions
 *   4. LNbits .env + lnd-certs — keeps 14 versions
 *   4b. Cashu mint ledger (nutshell mint.sqlite3) — keeps 14 versions + offsite.
 *       If lost, every issued Cashu token is unredeemable.
 *
 * Usage:
 *   node index.mjs           # full backup
 *   node index.mjs --dry-run # show without changes
 */

import { execSync, execFileSync } from 'child_process';
import { existsSync, readdirSync, unlinkSync, readFileSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

const DRY_RUN     = process.argv.includes('--dry-run');
const UMBREL_HOST = 'umbrel@100.111.14.11';

const REMOTE_SCB  = '/home/umbrel/umbrel/app-data/lightning/data/lnd/data/chain/bitcoin/mainnet/channel.backup';
const REMOTE_CERT = '/home/umbrel/umbrel/app-data/lightning/data/lnd/tls.cert';
const LOCAL_CERT  = '/home/deploy/lnbits/lnd-certs/tls.cert';

const SCB_DIR     = '/home/deploy/backups/lnd-scb';
const LNBITS_DIR  = '/home/deploy/backups/lnbits';
const MINT_DIR    = '/home/deploy/backups/nutshell';
const MINT_DB     = '/home/deploy/nutshell/data/mint/mint.sqlite3';
const KEEP        = 14;

let mintBackupDest = null; // set in §4b, offsited in §5

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

function pruneDir(dir, prefix, keep) {
  const files = readdirSync(dir).filter(f => f.startsWith(prefix)).sort();
  while (files.length > keep) {
    const old = join(dir, files.shift());
    unlinkSync(old);
    console.log(`🗑  Removed: ${old}`);
  }
}

// ── 1. SCB backup ─────────────────────────────────────────────────────────────

console.log(`\n📦 SCB backup — ${new Date().toISOString()}`);

const ts     = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dst    = join(SCB_DIR, `channel.backup.${ts}`);
const latest = join(SCB_DIR, 'channel.backup.latest');

if (DRY_RUN) {
  console.log(`   Dry-run — would copy to ${dst}`);
} else {
  try {
    scpFrom(REMOTE_SCB, dst);
    const size = statSync(dst).size;
    const hash = md5(dst);
    const changed = existsSync(latest) && md5(latest) !== hash;
    console.log(`✅ SCB saved (${size} bytes)${changed ? ' — ⚠️  CHANGED (new channel?)' : ' — unchanged'}`);
    execSync(`cp ${dst} ${latest}`);
    pruneDir(SCB_DIR, 'channel.backup.2', KEEP);
    console.log(`📁 SCB versions: ${readdirSync(SCB_DIR).filter(f => f.startsWith('channel.backup.2')).length} (max ${KEEP})`);
  } catch (e) {
    console.error(`❌ SCB backup failed: ${e.message}`);
  }
}

// ── 2. TLS cert check ─────────────────────────────────────────────────────────

console.log(`\n🔐 TLS cert check`);

const tmpCert = '/tmp/lnd-tls-check.cert';
try {
  scpFrom(REMOTE_CERT, tmpCert);
  const remoteHash = md5(tmpCert);
  const localHash  = existsSync(LOCAL_CERT) ? md5(LOCAL_CERT) : null;

  if (remoteHash === localHash) {
    console.log('✅ TLS cert unchanged');
  } else {
    console.log('⚠️  TLS cert changed on Umbrel!');
    if (!DRY_RUN) {
      execSync(`cp ${tmpCert} ${LOCAL_CERT}`);
      console.log(`✅ New cert saved: ${LOCAL_CERT}`);
      execSync('sudo systemctl restart lnbits', { stdio: 'inherit' });
      console.log('✅ LNbits restarted with new cert');
    }
  }
  execSync(`rm -f ${tmpCert}`);
} catch (e) {
  console.error(`❌ Cert check failed: ${e.message}`);
}

// ── 3. LNbits database backup ─────────────────────────────────────────────────

console.log(`\n🗄  LNbits database backup`);

if (!existsSync(LNBITS_DIR)) mkdirSync(LNBITS_DIR, { recursive: true });

const dbDir = '/home/deploy/lnbits/data';
const dbs = readdirSync(dbDir).filter(f => f.endsWith('.sqlite3'));

if (DRY_RUN) {
  console.log(`   Dry-run — would backup: ${dbs.join(', ')}`);
} else {
  for (const db of dbs) {
    const src  = join(dbDir, db);
    const name = db.replace('.sqlite3', '');
    const dest = join(LNBITS_DIR, `${name}.${ts}.sqlite3`);
    try {
      // sqlite3 .backup is safe even while DB is open/writing
      execSync(`sqlite3 ${src} ".backup '${dest}'"`, { stdio: 'pipe' });
      const size = statSync(dest).size;
      console.log(`  ✅ ${db} → ${size} bytes`);
      pruneDir(LNBITS_DIR, `${name}.`, KEEP);
    } catch (e) {
      console.error(`  ❌ ${db} failed: ${e.message}`);
    }
  }
}

// ── 4. LNbits config backup ───────────────────────────────────────────────────

console.log(`\n⚙️  LNbits config backup`);

const configFiles = [
  '/home/deploy/lnbits/.env',
  '/home/deploy/lnbits/lnd-certs/tls.cert',
  '/home/deploy/lnbits/lnd-certs/admin.macaroon',
];

if (DRY_RUN) {
  console.log(`   Dry-run — would backup: .env, tls.cert, admin.macaroon`);
} else {
  for (const src of configFiles) {
    if (!existsSync(src)) continue;
    const name = src.split('/').pop();
    const dest = join(LNBITS_DIR, `${name}.${ts}`);
    try {
      execSync(`cp ${src} ${dest}`);
      // Protect sensitive files
      if (name === 'admin.macaroon') execSync(`chmod 600 ${dest}`);
      console.log(`  ✅ ${name}`);
      pruneDir(LNBITS_DIR, `${name}.`, KEEP);
    } catch (e) {
      console.error(`  ❌ ${name}: ${e.message}`);
    }
  }
}

// ── 4b. Cashu mint ledger backup ──────────────────────────────────────────────
// The nutshell mint ledger records every outstanding ecash liability (Welcome's
// 21-sat welcome tokens, onboarding rewards). Lose it and every token ever issued
// becomes permanently unredeemable. sqlite3 .backup is safe while the mint runs.

console.log(`\n🥜 Cashu mint ledger backup`);

if (!existsSync(MINT_DIR)) mkdirSync(MINT_DIR, { recursive: true });

if (DRY_RUN) {
  console.log(`   Dry-run — would backup: ${MINT_DB}`);
} else if (!existsSync(MINT_DB)) {
  console.error(`  ❌ mint ledger not found: ${MINT_DB}`);
} else {
  const dest = join(MINT_DIR, `mint.${ts}.sqlite3`);
  try {
    execSync(`sqlite3 ${MINT_DB} ".backup '${dest}'"`, { stdio: 'pipe' });
    const size = statSync(dest).size;
    mintBackupDest = dest; // offsite the atomic copy, not the live file
    console.log(`  ✅ mint.sqlite3 → ${size} bytes`);
    pruneDir(MINT_DIR, 'mint.', KEEP);
  } catch (e) {
    console.error(`  ❌ mint backup failed: ${e.message}`);
  }
}

// ── 5. Offsite copy to Umbrel ─────────────────────────────────────────────────
// Second physical location — if DigitalOcean goes down, recovery is possible from Umbrel.

console.log(`\n🏠 Offsite copy to Umbrel`);

const UMBREL_BACKUP_DIR = '/home/umbrel/lnbits-backup';
const OFFSITE_FILES = [
  { src: '/home/deploy/lnbits/data/database.sqlite3',          name: 'database.sqlite3' },
  { src: '/home/deploy/lnbits/data/ext_splitpayments.sqlite3', name: 'ext_splitpayments.sqlite3' },
  { src: '/home/deploy/lnbits/.env',                           name: 'lnbits.env' },
  // Offsite the atomic mint backup made in §4b (not the live file).
  ...(mintBackupDest ? [{ src: mintBackupDest, name: 'nutshell-mint.sqlite3' }] : []),
];

if (DRY_RUN) {
  console.log(`   Dry-run — would copy to ${UMBREL_HOST}:${UMBREL_BACKUP_DIR}/`);
} else {
  try {
    // Ensure backup dir exists on Umbrel
    execFileSync('ssh', [
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ConnectTimeout=10',
      UMBREL_HOST,
      `mkdir -p ${UMBREL_BACKUP_DIR}`,
    ]);
    for (const { src, name } of OFFSITE_FILES) {
      if (!existsSync(src)) continue;
      execFileSync('scp', [
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'ConnectTimeout=10',
        src,
        `${UMBREL_HOST}:${UMBREL_BACKUP_DIR}/${name}`,
      ]);
      console.log(`  ✅ ${name} → Umbrel`);
    }
    console.log(`  📍 Location: ${UMBREL_HOST}:${UMBREL_BACKUP_DIR}/`);
  } catch (e) {
    console.error(`  ❌ Offsite copy failed: ${e.message}`);
  }
}

console.log('\n✅ scb-backup done\n');
