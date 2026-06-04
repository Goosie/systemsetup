#!/usr/bin/env node
/**
 * create-nostr-account.mjs
 * Interactive script to create a Nostr identity for one app or agent.
 *
 * Usage:
 *   node /home/deploy/scripts/create-nostr-account.mjs
 *   node /home/deploy/scripts/create-nostr-account.mjs app catchzaps
 *   node /home/deploy/scripts/create-nostr-account.mjs agent assistenty
 */

import { createInterface } from 'readline/promises';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { stdin as input, stdout as output } from 'process';

// ── paths ─────────────────────────────────────────────────────────────────────
const NOSTR_TOOLS = '/var/www/goosielabs/apps/catchzaps/node_modules/nostr-tools/lib/esm/index.js';
const WS_PATH     = '/home/deploy/nsite-gateway/node_modules/ws/lib/websocket.js';
const RELAY       = 'ws://127.0.0.1:7778';
const WHITELIST   = '/home/deploy/whitelist.json';
const BLOSSOM_CFG = '/home/deploy/blossom/config.yml';
const NIP05_FILE  = '/var/www/goosielabs/.well-known/nostr.json';
const APPS_DIR    = '/var/www/goosielabs/apps';
const AGENTS_DIR  = '/home/deploy/agents';

// ── colours ───────────────────────────────────────────────────────────────────
const c = {
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
  green:  s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  blue:   s => `\x1b[34m${s}\x1b[0m`,
};

const ok    = msg => console.log(c.green('  ✓ ') + msg);
const warn  = msg => console.log(c.yellow('  ⚠ ') + msg);
const info  = msg => console.log(c.cyan('  → ') + msg);
const err   = msg => console.log(c.red('  ✗ ') + msg);
const sep   = ()  => console.log(c.dim('  ' + '─'.repeat(60)));
const blank = ()  => console.log();

// ── readline helper ───────────────────────────────────────────────────────────
const rl = createInterface({ input, output });

async function ask(question, defaultVal = '') {
  const hint = defaultVal ? c.dim(` [${defaultVal}]`) : '';
  const answer = await rl.question(c.bold('  ? ') + question + hint + ' ');
  return answer.trim() || defaultVal;
}

async function confirm(question, defaultYes = true) {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = await rl.question(c.bold('  ? ') + question + c.dim(` (${hint}) `));
  if (!answer.trim()) return defaultYes;
  return answer.trim().toLowerCase().startsWith('y');
}

// ── nostr helpers (dynamic import) ───────────────────────────────────────────
async function loadNostr() {
  const { generateSecretKey, getPublicKey, finalizeEvent, nip19 } =
    await import(NOSTR_TOOLS);
  return { generateSecretKey, getPublicKey, finalizeEvent, nip19 };
}

function publishToRelay(event) {
  return new Promise(async (resolve, reject) => {
    const { default: WebSocket } = await import(WS_PATH);
    const ws = new WebSocket(RELAY);
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('Relay timeout')); }, 6000);
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', event])));
    ws.on('message', raw => {
      const msg = JSON.parse(raw);
      if (msg[0] === 'OK') { clearTimeout(timer); ws.close(); resolve(msg); }
    });
    ws.on('error', e => { clearTimeout(timer); reject(e); });
  });
}

// ── file updaters ─────────────────────────────────────────────────────────────
function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJSON(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

function addToWhitelist(pubkeyHex) {
  const list = readJSON(WHITELIST);
  if (list.includes(pubkeyHex)) return false; // already there
  list.push(pubkeyHex);
  writeJSON(WHITELIST, list);
  return true;
}

function addToNip05(name, pubkeyHex) {
  const data = readJSON(NIP05_FILE);
  const existing = data.names[name];
  if (existing === pubkeyHex) return false; // already correct
  data.names[name] = pubkeyHex;
  writeJSON(NIP05_FILE, data);
  return true;
}

function addToBlossomConfig(pubkeyHex, label) {
  let content = readFileSync(BLOSSOM_CFG, 'utf8');
  if (content.includes(pubkeyHex)) return false; // already there

  const newLine = `        - "${pubkeyHex}"  # ${label}`;

  // Each permanent pubkeys block ends with a pubkey line immediately before "    - type:"
  // Insert new entry before each such transition
  const updated = content.replace(
    /(        - "[0-9a-f]{64}"[^\n]*)\n(    - type:)/g,
    `$1\n${newLine}\n$2`
  );

  if (updated === content) {
    // Fallback: append at end of each pubkeys: block using a looser pattern
    warn('Could not find insertion point in blossom config — manual edit needed.');
    return false;
  }

  writeFileSync(BLOSSOM_CFG, updated);
  return true;
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  blank();
  console.log(c.bold('🪿 Goosie Labs — Create Nostr Account'));
  console.log(c.dim('   One careful step at a time. Ctrl+C to abort at any point.'));
  sep();
  blank();

  // ── 1. type (app or agent)
  let type = process.argv[2];
  if (!type) {
    type = await ask('App or agent?', 'app');
  }
  if (!['app', 'agent'].includes(type)) {
    err(`Unknown type "${type}". Use "app" or "agent".`);
    process.exit(1);
  }

  // ── 2. name
  let name = process.argv[3];
  if (!name) {
    if (type === 'app') {
      info('Available apps:');
      const { readdirSync, statSync } = await import('fs');
      const apps = readdirSync(APPS_DIR)
        .filter(d => statSync(`${APPS_DIR}/${d}`).isDirectory() && !existsSync(`${APPS_DIR}/${d}/.archived`));
      console.log('     ' + apps.join('  '));
      blank();
    } else {
      info('Available agents: assistenty ay danky finny jurry ruby secury testy');
      blank();
    }
    name = await ask(`Name of the ${type}?`);
  }

  if (!name) { err('No name given.'); process.exit(1); }

  const dir = type === 'app'
    ? `${APPS_DIR}/${name}`
    : `${AGENTS_DIR}/${name}`;

  const keyFile = `${dir}/nostr-key.json`;

  if (!existsSync(dir)) {
    err(`Directory not found: ${dir}`);
    process.exit(1);
  }

  blank();
  console.log(c.bold(`  Setting up Nostr account for ${type}: ${name}`));
  sep();

  // ── 3. check if key already exists
  let existingKey = null;
  if (existsSync(keyFile)) {
    existingKey = readJSON(keyFile);
    blank();
    warn(`Key file already exists at ${keyFile}`);
    info(`Existing npub: ${existingKey.npub}`);
    blank();
    const overwrite = await confirm('Generate a NEW keypair? (old key will be overwritten)', false);
    if (!overwrite) {
      info('Keeping existing key. Will continue with registration steps only.');
    } else {
      existingKey = null; // will generate new
    }
  }

  // ── 4. profile details
  blank();
  console.log(c.bold('  Profile details'));
  sep();

  const defaultTitle   = name.charAt(0).toUpperCase() + name.slice(1);
  const defaultAbout   = type === 'app'
    ? `Goosie Labs app — ${name}`
    : `Goosie Labs V-formation agent — ${name}`;
  const defaultPicture = type === 'app'
    ? `https://goosielabs.com/apps/${name}/icons/icon-192.png`
    : `https://goosielabs.com`; // placeholder until agent icon is on Blossom
  const defaultWebsite = type === 'app'
    ? `https://goosielabs.com/apps/${name}`
    : `https://goosielabs.com`;

  const displayName = await ask('Display name?', defaultTitle);
  const about       = await ask('Description (about)?', defaultAbout);
  const picture     = await ask('Picture URL?', defaultPicture);
  const website     = await ask('Website URL?', defaultWebsite);
  const nip05name   = await ask('NIP-05 identifier (the part before @goosielabs.com)?', name);

  blank();
  console.log(c.bold('  Summary — here is what will happen:'));
  sep();
  console.log(`  ${c.cyan('type')}       ${type}`);
  console.log(`  ${c.cyan('name')}       ${name}`);
  console.log(`  ${c.cyan('key file')}   ${keyFile}`);
  console.log(`  ${c.cyan('NIP-05')}     ${nip05name}@goosielabs.com`);
  blank();
  console.log(`  ${c.bold('Steps:')}`);
  if (!existingKey) console.log(`  ${c.dim('1.')} Generate new keypair → ${keyFile}`);
  else              console.log(`  ${c.dim('1.')} ${c.dim('Skip keypair (keeping existing)')}`);
  console.log(`  ${c.dim('2.')} Add pubkey to ${WHITELIST}`);
  console.log(`  ${c.dim('3.')} Add pubkey to ${BLOSSOM_CFG} (both permanent rules)`);
  console.log(`  ${c.dim('4.')} Add ${nip05name}@goosielabs.com to ${NIP05_FILE}`);
  console.log(`  ${c.dim('5.')} Publish kind 0 profile event to relay`);
  console.log(`  ${c.dim('6.')} Verify NIP-05 resolves correctly`);
  blank();

  const proceed = await confirm('Looks good — start?', true);
  if (!proceed) { info('Aborted. Nothing changed.'); rl.close(); process.exit(0); }

  // ── load nostr tools
  const { generateSecretKey, getPublicKey, finalizeEvent, nip19 } = await loadNostr();

  // ── step 1: keypair
  blank();
  console.log(c.bold('  Step 1 — Keypair'));
  sep();

  let keyData;
  if (existingKey) {
    keyData = existingKey;
    ok(`Using existing key: ${keyData.npub}`);
  } else {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    keyData = {
      pubkey:   pk,
      npub:     nip19.npubEncode(pk),
      nsec:     nip19.nsecEncode(sk),
      nsecHex:  Buffer.from(sk).toString('hex'),
    };
    blank();
    console.log(`  ${c.bold('New keypair generated:')}`);
    console.log(`  npub  : ${c.green(keyData.npub)}`);
    console.log(`  pubkey: ${keyData.pubkey}`);
    console.log(`  ${c.red('nsec  : *** shown once — write it down if you need it ***')}`);
    console.log(`  ${c.yellow(keyData.nsec)}`);
    blank();

    const save = await confirm('Write keypair to key file?', true);
    if (!save) { info('Aborted. Nothing changed.'); rl.close(); process.exit(0); }
    writeFileSync(keyFile, JSON.stringify(keyData, null, 2) + '\n');
    ok(`Keypair saved to ${keyFile}`);
  }

  const sk = Buffer.from(keyData.nsecHex, 'hex');

  // ── step 2: whitelist
  blank();
  console.log(c.bold('  Step 2 — Relay whitelist'));
  sep();
  info(`Adding ${keyData.pubkey.slice(0, 16)}… to ${WHITELIST}`);

  const goWhitelist = await confirm('Update whitelist.json?', true);
  if (goWhitelist) {
    const added = addToWhitelist(keyData.pubkey);
    added ? ok('Pubkey added to whitelist.json') : ok('Pubkey was already in whitelist.json — no change');
  } else {
    warn('Skipped. Add manually: edit /home/deploy/whitelist.json');
  }

  // ── step 3: blossom
  blank();
  console.log(c.bold('  Step 3 — Blossom permanent storage'));
  sep();
  info(`Adding to both permanent rules in ${BLOSSOM_CFG}`);
  info('Then you need to restart Blossom.');

  const goBlossom = await confirm('Update blossom/config.yml?', true);
  if (goBlossom) {
    const added = addToBlossomConfig(keyData.pubkey, displayName);
    if (added) {
      ok('Pubkey added to both permanent pubkeys lists in blossom/config.yml');
      warn('Blossom needs a restart:  sudo systemctl restart blossom');
      const doRestart = await confirm('Restart Blossom now?', true);
      if (doRestart) {
        const { execSync } = await import('child_process');
        try {
          execSync('sudo systemctl restart blossom', { stdio: 'inherit' });
          ok('Blossom restarted');
        } catch {
          warn('Restart failed — run manually: sudo systemctl restart blossom');
        }
      }
    } else {
      ok('Pubkey was already in blossom config — no change');
    }
  } else {
    warn('Skipped. Add manually: edit /home/deploy/blossom/config.yml');
  }

  // ── step 4: NIP-05
  blank();
  console.log(c.bold('  Step 4 — NIP-05 verification'));
  sep();
  info(`Adding "${nip05name}" → ${keyData.pubkey.slice(0, 16)}… to ${NIP05_FILE}`);
  info(`Result: ${nip05name}@goosielabs.com will resolve to this npub`);

  const goNip05 = await confirm('Update nostr.json?', true);
  if (goNip05) {
    const added = addToNip05(nip05name, keyData.pubkey);
    added ? ok(`${nip05name}@goosielabs.com added to NIP-05`) : ok('NIP-05 entry was already correct — no change');
  } else {
    warn('Skipped. Add manually: edit /var/www/goosielabs/.well-known/nostr.json');
  }

  // ── step 5: kind 0 profile
  blank();
  console.log(c.bold('  Step 5 — Publish kind 0 profile'));
  sep();
  const profile = {
    name:         name,
    display_name: displayName,
    about:        about,
    picture:      picture,
    website:      website,
    nip05:        `${nip05name}@goosielabs.com`,
  };
  info('Profile to publish:');
  for (const [k, v] of Object.entries(profile)) {
    console.log(`  ${c.dim(k.padEnd(14))} ${v}`);
  }
  blank();

  const goProfile = await confirm('Publish kind 0 to relay?', true);
  if (goProfile) {
    try {
      const event = finalizeEvent({
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: JSON.stringify(profile),
      }, sk);

      const result = await publishToRelay(event);
      if (result[2] === true) {
        ok(`Profile published — event id: ${event.id.slice(0, 16)}…`);
      } else {
        warn(`Relay responded: ${result[3] || 'unknown'}`);
      }
    } catch (e) {
      err(`Failed to publish: ${e.message}`);
      warn('You can retry later by running this script again and skipping to step 5.');
    }
  } else {
    warn('Skipped. Publish manually or rerun this script.');
  }

  // ── step 6: verify
  blank();
  console.log(c.bold('  Step 6 — Verification'));
  sep();

  try {
    const res = await fetch(`https://goosielabs.com/.well-known/nostr.json?name=${nip05name}`);
    const data = await res.json();
    const resolved = data?.names?.[nip05name];
    if (resolved === keyData.pubkey) {
      ok(`NIP-05 resolves correctly: ${nip05name}@goosielabs.com ✓`);
    } else if (resolved) {
      warn(`NIP-05 resolves to a different pubkey: ${resolved}`);
    } else {
      warn(`NIP-05 entry "${nip05name}" not found yet — DNS/cache may need a moment`);
    }
  } catch {
    warn('Could not reach goosielabs.com to verify NIP-05 — check manually later');
  }

  blank();
  console.log(`  ${c.bold('Profile on Nostr:')}`);
  console.log(`  https://njump.me/${keyData.npub}`);
  blank();

  // ── done
  console.log(c.bold(c.green('  Done.')));
  sep();
  console.log(`  ${c.cyan('npub')}      ${keyData.npub}`);
  console.log(`  ${c.cyan('pubkey')}    ${keyData.pubkey}`);
  console.log(`  ${c.cyan('NIP-05')}    ${nip05name}@goosielabs.com`);
  console.log(`  ${c.cyan('key file')}  ${keyFile}`);
  blank();
  console.log(c.dim('  Reminder: if you restarted Blossom manually, do so now.'));
  console.log(c.dim('  sudo systemctl restart blossom'));
  blank();

  rl.close();
}

main().catch(e => {
  console.error(c.red('\n  Fatal error: ') + e.message);
  process.exit(1);
});
