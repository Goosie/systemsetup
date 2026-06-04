#!/usr/bin/env node
/**
 * Humany — Formation HR & Onboarding goose
 *
 * Commands:
 *   newgoose <name>         Onboard a new goose into the V-Formation
 *   renamegoose <old> <new> Rename an existing goose across all systems
 *   status                  Formation health overview
 *
 * ── MAINTENANCE NOTE ────────────────────────────────────────────────────────
 * When adding a new step to newGoose() that stores or embeds the goose name,
 * you MUST also add the corresponding rename step in renameGoose() below.
 * Both functions are kept in sync intentionally — they are mirrors of each other.
 * Search for "// ── RENAME MIRROR ──" comments to find the rename equivalents.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'websocket-polyfill';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync, copyFileSync, rmSync } from 'fs';
import { resolve, join } from 'path';
import { execSync } from 'child_process';
import http from 'http';
import { generateSecretKey, getPublicKey, finalizeEvent, SimplePool } from 'nostr-tools';

// ── Config ────────────────────────────────────────────────────────────────────

const RELAY          = process.env.RELAY_URL ?? 'ws://127.0.0.1:7778';
const EXTERNAL_RELAYS = ['wss://relay.damus.io', 'wss://relay.primal.net'];
const ALL_RELAYS     = [RELAY, ...EXTERNAL_RELAYS];
const AGENTS_DIR     = '/home/deploy/agents';
const AGENTS_JSON    = `${AGENTS_DIR}/agents.json`;
const NIP05_FILE     = '/var/www/goosielabs/.well-known/nostr.json';
const SCRIPTS_DIR        = '/home/deploy/systemsetup/scripts';
const WHITELIST_PATH     = '/home/deploy/whitelist.json';
const GOOSE_CONFIG       = '/var/www/goosielabs/apps/vformation/src/lib/gooseConfig.ts';
const GOOSE_RUNNER       = `${SCRIPTS_DIR}/goose-runner/index.mjs`;
const VFORMATION_DIR     = '/var/www/goosielabs/apps/vformation';
const GOOSIELABS_DIR     = '/var/www/goosielabs';
const GENERATE_ICONS_MJS = `${GOOSIELABS_DIR}/generate-agent-icons.mjs`;
const GENERATE_PORTRAITS = '/home/deploy/scripts/generate-agent-portraits.mjs';
const PUBLISH_HOMEPAGE   = `${SCRIPTS_DIR}/publish-homepage.mjs`;
const PUBLISH_AGENT_PAGES = `${SCRIPTS_DIR}/publish-agent-pages.mjs`;
const GENERATE_AGENTS_HTML = `${SCRIPTS_DIR}/generate-agents-html.py`;
const HOMEPAGE_BASE      = `${SCRIPTS_DIR}/pages/homepage_base.html`;
const WEBROOT_AGENTS     = `${GOOSIELABS_DIR}/agents`;
const LNBITS_URL         = 'http://127.0.0.1:5000';
const PERRY_NPUB_HEX     = 'a8364bf8e5b828bd722a6dc71882ff4ee8d379e64fbf4584f0c6f1b393f8058c';

const assistentyKey = JSON.parse(readFileSync(resolve(AGENTS_DIR, 'assistenty/nostr-key.json'), 'utf8'));
const ASTRID_SK  = new Uint8Array(assistentyKey.nsecHex.match(/.{2}/g).map(b => parseInt(b, 16)));
const ASTRID_PK  = assistentyKey.pubkey;
const BADGE_REF  = `30009:${ASTRID_PK}:vformation-member`;

const keyData    = JSON.parse(readFileSync(resolve(AGENTS_DIR, 'humany/nostr-key.json'), 'utf8'));
const SECRET_KEY = new Uint8Array(keyData.nsecHex.match(/.{2}/g).map(b => parseInt(b, 16)));
const PUBKEY     = keyData.pubkey;

// ── Relay helpers ─────────────────────────────────────────────────────────────

async function publish(pool, template) {
  const event = finalizeEvent(template, SECRET_KEY);
  await Promise.allSettled(pool.publish([RELAY], event));
  return event;
}

async function publishChat(pool, content) {
  return publish(pool, {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['t', 'vformation'], ['t', 'vformation-chat']],
    content,
  });
}

function createLnbitsWallet(name, displayName) {
  try {
    const result = execSync(
      `python3 /home/deploy/scripts/create-wallet.py "${name}" "${displayName}"`,
      { encoding: 'utf8' }
    );
    return JSON.parse(result.trim());
  } catch (e) {
    console.error('  ⚠️  Wallet creation failed:', e.message);
    return null;
  }
}

async function publishKind0ForGoose(pool, sk, name, about) {
  const displayName = capitalize(name);
  const walletFile  = `${AGENTS_DIR}/${name}/lnbits-wallet.json`;
  const lud16       = existsSync(walletFile) ? `${name}@goosielabs.com` : undefined;
  const event = finalizeEvent({
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify({
      name,
      display_name: displayName,
      about,
      picture: `https://goosielabs.com/agents/${name}/${name}.jpg`,
      website: 'https://goosielabs.com',
      nip05: `${name}@goosielabs.com`,
      lud16,
      bot: true,
    }),
  }, sk);
  await Promise.allSettled(pool.publish(ALL_RELAYS, event));
  console.log(`  📛 Kind 0 published for ${displayName} (${ALL_RELAYS.length} relays)${lud16 ? ' ⚡ ' + lud16 : ''}`);
}

async function issueBadgeAward(pool, goosePubkey, name) {
  const event = finalizeEvent({
    kind: 8,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['a', BADGE_REF, 'wss://relay.goosielabs.com'],
      ['p', goosePubkey, 'wss://relay.goosielabs.com'],
    ],
    content: '',
  }, ASTRID_SK);
  await Promise.allSettled(pool.publish(ALL_RELAYS, event));
  console.log(`  🏅 NIP-58 badge awarded to ${name}`);
}

function addToNip05(name, pubkeyHex) {
  const data = JSON.parse(readFileSync(NIP05_FILE, 'utf8'));
  if (data.names[name] === pubkeyHex) return false;
  data.names[name] = pubkeyHex;
  writeFileSync(NIP05_FILE, JSON.stringify(data, null, 2) + '\n');
  return true;
}

function addToIconsGenerator(name) {
  let content = readFileSync(GENERATE_ICONS_MJS, 'utf8');
  if (content.includes(`name: '${name}'`)) return false;
  const label = capitalize(name);
  const newEntry = `  { name: '${name}', bg: '#374151', symbol: 'uni2728', label: '${label}' }, // gray — ✨ placeholder — ask @designy for final bg+symbol`;
  content = content.replace(
    /(\{ name: 'admission'[^\n]+\n)/,
    `$1${newEntry}\n`
  );
  writeFileSync(GENERATE_ICONS_MJS, content);
  return true;
}

function addToPortraitsGenerator(name) {
  let content = readFileSync(GENERATE_PORTRAITS, 'utf8');
  if (content.includes(`name: '${name}'`)) return false;
  const label = capitalize(name);
  const newEntry =
    `  {\n` +
    `    name: '${name}',\n` +
    `    // TODO: replace outfit description with something role-specific\n` +
    `    prompt: \`\${BASE_STYLE}. ${label} — V-formation agent. Wearing a neat professional outfit that fits their role.\`,\n` +
    `  },`;
  content = content.replace(/^(\];)/m, `${newEntry}\n$1`);
  writeFileSync(GENERATE_PORTRAITS, content);
  return true;
}

function generateIcon(name) {
  try {
    execSync(`cd ${GOOSIELABS_DIR} && node generate-agent-icons.mjs 2>&1 | grep "✓ ${name}" || true`, { stdio: 'pipe' });
    const src = `${AGENTS_DIR}/${name}/icon-192.png`;
    const dst = `${WEBROOT_AGENTS}/${name}`;
    if (existsSync(src)) {
      mkdirSync(dst, { recursive: true });
      execSync(`cp ${src} ${dst}/`);
      return true;
    }
  } catch {}
  return false;
}

function getOpenAIKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const rc = readFileSync('/home/deploy/.bashrc.local', 'utf8');
    const m = rc.match(/export\s+OPENAI_API_KEY=([^\s\n]+)/);
    return m ? m[1] : null;
  } catch { return null; }
}

function generatePortrait(name) {
  const key = getOpenAIKey();
  if (!key) return false;
  try {
    execSync(`OPENAI_API_KEY=${key} node ${GENERATE_PORTRAITS} ${name}`, { stdio: 'pipe' });
    const src = `${AGENTS_DIR}/${name}/${name}.jpg`;
    const dst = `${WEBROOT_AGENTS}/${name}`;
    if (existsSync(src)) {
      mkdirSync(dst, { recursive: true });
      execSync(`cp ${src} ${dst}/`);
      return true;
    }
  } catch {}
  return false;
}

function addToAgentsJson(name, about) {
  const data = JSON.parse(readFileSync(AGENTS_JSON, 'utf8'));
  if (data.agents.some(a => a.name === name)) return false;
  data.agents.push({
    name,
    displayName: capitalize(name),
    about,
    nip05: `${name}@goosielabs.com`,
    website: 'https://goosielabs.com',
    picture: `https://goosielabs.com/agents/${name}/${name}.jpg`,
  });
  writeFileSync(AGENTS_JSON, JSON.stringify(data, null, 2) + '\n');
  return true;
}

// ── newgoose ──────────────────────────────────────────────────────────────────

async function newGoose(name) {
  // ── MAINTENANCE NOTE ──────────────────────────────────────────────────────
  // When adding a new step here that stores or embeds the goose name,
  // add the corresponding rename step in renameGoose() and tag it with
  // "// Mirror of newGoose step N" so the two functions stay in sync.
  // ─────────────────────────────────────────────────────────────────────────

  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(`Invalid name "${name}" — use lowercase letters, digits, hyphens only`);
  }

  const agentDir = resolve(AGENTS_DIR, name);
  if (existsSync(agentDir)) {
    throw new Error(`Goose "${name}" already exists at ${agentDir}`);
  }

  console.log(`\n🤝 Humany: onboarding "${name}"...\n`);

  const about = `Goosie Labs V-formation agent — ${capitalize(name)}. Role: to be defined.`;

  // 1. Generate keypair
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const nsecHex = Buffer.from(sk).toString('hex');
  const { nip19 } = await import('nostr-tools');
  const npub = nip19.npubEncode(pk);
  const nsec = nip19.nsecEncode(sk);
  console.log(`  🔑 Pubkey: ${pk}`);
  console.log(`  🔑 Npub:   ${npub}`);

  // 2. Create agent directory
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    resolve(agentDir, 'nostr-key.json'),
    JSON.stringify({ pubkey: pk, npub, nsec, nsecHex }, null, 2) + '\n'
  );
  writeFileSync(
    resolve(agentDir, `${name}.md`),
    `# ${capitalize(name)} — Role\n\n_Role description to be filled in._\n\n**Pubkey:** ${pk}\n`
  );
  console.log(`  📁 Agent directory created: ${agentDir}`);

  // 2b. NIP-05 — add to nostr.json
  const nip05Added = addToNip05(name, pk);
  console.log(`  🌐 NIP-05: ${name}@goosielabs.com ${nip05Added ? 'added' : '(already exists)'}`);

  // 2c. agents.json — add metadata entry
  const agentsAdded = addToAgentsJson(name, about);
  console.log(`  📋 agents.json: ${capitalize(name)} ${agentsAdded ? 'added' : '(already exists)'}`);

  // 2d. @Designy — agent icon (goose + symbol composite)
  console.log(`  🎨 @Designy: generating icon for ${capitalize(name)}...`);
  addToIconsGenerator(name);
  const iconOk = generateIcon(name);
  console.log(iconOk
    ? `  🎨 Icon generated → /agents/${name}/icon-192.png (placeholder — update bg+symbol in generate-agent-icons.mjs)`
    : `  ⚠️  Icon generation failed — run manually: cd /var/www/goosielabs && node generate-agent-icons.mjs`
  );

  // 2e. @Designy — portrait (AI-illustrated goose character)
  addToPortraitsGenerator(name);
  if (process.env.OPENAI_API_KEY) {
    console.log(`  🎨 @Designy: generating portrait for ${capitalize(name)}...`);
    const portraitOk = generatePortrait(name);
    console.log(portraitOk
      ? `  🎨 Portrait generated → /agents/${name}/${name}.jpg`
      : `  ⚠️  Portrait generation failed — retry: OPENAI_API_KEY=sk-... node /home/deploy/scripts/generate-agent-portraits.mjs ${name}`
    );
  } else {
    console.log(`  🎨 Portrait: OPENAI_API_KEY not set — run when ready:`);
    console.log(`     OPENAI_API_KEY=sk-... node /home/deploy/scripts/generate-agent-portraits.mjs ${name}`);
  }

  // 3. Update whitelist.json
  const wl = JSON.parse(readFileSync(WHITELIST_PATH, 'utf8'));
  wl[name] = pk;
  writeFileSync(WHITELIST_PATH, JSON.stringify(wl, null, 2) + '\n');
  console.log(`  ✅ Added to whitelist`);

  // 4. Update goose-runner — KEYS dict
  let runner = readFileSync(GOOSE_RUNNER, 'utf8');
  runner = runner.replace(
    '  // ── NEW GEESE ──\n};',
    `  ${name}: loadKey('${name}'),\n  // ── NEW GEESE ──\n};`
  );
  // Add dispatcher case
  runner = runner.replace(
    '      // ── NEW CASES ──',
    `      case '${name}': await handleScript(pool, '${name}', event, command); break;\n      // ── NEW CASES ──`
  );
  writeFileSync(GOOSE_RUNNER, runner);
  console.log(`  ✅ Registered in goose-runner`);

  // 5. Update gooseConfig.ts — pick a color from the palette
  const colors = [
    { color: '#a78bfa', bgColor: '#2e1065' }, // violet
    { color: '#34d399', bgColor: '#022c22' }, // emerald
    { color: '#fb923c', bgColor: '#431407' }, // orange
    { color: '#60a5fa', bgColor: '#1e3a5f' }, // blue
    { color: '#f472b6', bgColor: '#500724' }, // pink
    { color: '#facc15', bgColor: '#422006' }, // yellow
  ];
  const existing = JSON.parse(readFileSync(WHITELIST_PATH, 'utf8'));
  const idx = (Object.keys(existing).length - 2) % colors.length;
  const { color, bgColor } = colors[idx];

  let config = readFileSync(GOOSE_CONFIG, 'utf8');
  const newEntry =
    `  '${pk}': {\n` +
    `    name: '${capitalize(name)}',\n` +
    `    emoji: '🪿',\n` +
    `    color: '${color}',\n` +
    `    bgColor: '${bgColor}',\n` +
    `    role: 'Pending',\n` +
    `  },\n` +
    `  // ── NEW GEESE ──`;
  config = config.replace('  // ── NEW GEESE ──', newEntry);
  writeFileSync(GOOSE_CONFIG, config);
  console.log(`  ✅ Registered in gooseConfig.ts`);

  // 2f. LNbits wallet + Lightning Address
  console.log(`  ⚡ Creating LNbits wallet for ${capitalize(name)}...`);
  const wallet = createLnbitsWallet(name, capitalize(name));
  if (wallet) {
    console.log(`  ⚡ Wallet created: ${wallet.wallet_id.slice(0, 8)}… → ⚡ ${name}@goosielabs.com`);
    try {
      execSync('sudo systemctl restart lnaddress', { stdio: 'pipe' });
      console.log(`  ⚡ lnaddress service restarted — Lightning Address live`);
    } catch {
      console.log(`  ⚠️  lnaddress restart failed — run: sudo systemctl restart lnaddress`);
    }
  } else {
    console.log(`  ⚠️  Wallet skipped — run manually: python3 /home/deploy/scripts/create-wallet.py ${name} "${capitalize(name)}"`);
  }

  // 6. Publish kind 0 metadata for the new goose (includes lud16 if wallet exists)
  const pool = new SimplePool();
  await publishKind0ForGoose(pool, sk, name, about);

  // 6b. Issue NIP-58 formation badge from Astrid
  await issueBadgeAward(pool, pk, capitalize(name));

  // 7. Rebuild vformation dashboard
  console.log(`  🏗️  Rebuilding vformation...`);
  execSync('NODE_OPTIONS=--max-old-space-size=1024 npm run build', {
    cwd: VFORMATION_DIR,
    stdio: 'pipe',
  });
  console.log(`  ✅ Dashboard rebuilt`);

  // 7b. Update nsite homepage tiles
  console.log(`  🏠 Updating homepage tiles...`);
  try {
    execSync('bash /home/deploy/update-tiles.sh', { stdio: 'pipe' });
    console.log(`  ✅ Homepage tiles updated`);
  } catch (e) {
    console.log(`  ⚠️  Tiles update failed — run manually: bash /home/deploy/update-tiles.sh`);
  }

  // 8. Announce in formation chat
  await publishChat(pool, `🎉 New goose onboarded: ${capitalize(name)}\nPubkey: ${pk.slice(0, 16)}...\nAdd role description to: ${agentDir}/${name}.md`);

  pool.close([RELAY]);

  console.log(`\n✅ ${capitalize(name)} is now part of the V-Formation!`);
  console.log(`   NIP-05: ${name}@goosielabs.com`);
  console.log(`   npub:   ${npub}`);
  console.log(`\n📝 Next steps:`);
  console.log(`   1. Edit ${agentDir}/${name}.md — add role description`);
  console.log(`   2. Update about in ${AGENTS_JSON} once role is defined`);
  console.log(`   3. Re-publish profile: node /home/deploy/agents/publish-profiles.js ${name}`);
  console.log(`   4. Customise icon bg+symbol in ${GENERATE_ICONS_MJS} → @designy`);
  console.log(`   5. Update portrait prompt in /home/deploy/scripts/generate-agent-portraits.mjs → re-run for ${name}`);
  console.log(`   6. Add a script at /home/deploy/scripts/${name}/index.js`);
  console.log(`   7. Restart goose-runner: sudo systemctl restart goose-runner`);
}

// ── renamegoose ───────────────────────────────────────────────────────────────

function lnbitsRenameWallet(adminkey, newDisplayName) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 5000,
      path: `/api/v1/wallet/${encodeURIComponent(newDisplayName)}`,
      method: 'PUT',
      headers: { 'X-Api-Key': adminkey },
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function renameGoose(oldName, newName) {
  // ── MAINTENANCE NOTE ──────────────────────────────────────────────────────
  // This function is the rename mirror of newGoose().
  // When you add a new name-bearing step to newGoose(), add a rename step here.
  // Each step below is tagged with the corresponding newGoose step number.
  // ─────────────────────────────────────────────────────────────────────────

  if (!/^[a-z][a-z0-9-]*$/.test(newName)) {
    throw new Error(`Invalid new name "${newName}" — use lowercase letters, digits, hyphens only`);
  }

  const oldDir = resolve(AGENTS_DIR, oldName);
  const newDir = resolve(AGENTS_DIR, newName);

  if (!existsSync(oldDir)) throw new Error(`Goose "${oldName}" not found at ${oldDir}`);
  if (existsSync(newDir))  throw new Error(`A goose named "${newName}" already exists at ${newDir}`);

  const oldDisplay = capitalize(oldName);
  const newDisplay = capitalize(newName);

  console.log(`\n🔄 Humany: renaming "${oldName}" → "${newName}"...\n`);

  // ── Step 1: Rename agent directory ─────────────────────────────────────────
  // Mirror of newGoose step 2 (create agent directory)
  renameSync(oldDir, newDir);
  console.log(`  📁 Directory renamed: agents/${oldName} → agents/${newName}`);

  // Rename files inside the directory that embed the old name
  for (const file of readdirSync(newDir)) {
    if (file.includes(oldName)) {
      const newFile = file.replace(new RegExp(oldName, 'g'), newName);
      renameSync(join(newDir, file), join(newDir, newFile));
    }
  }
  console.log(`  📄 Files renamed (portraits, .md)`);

  // ── Step 2: Update lnbits-wallet.json ──────────────────────────────────────
  // Mirror of newGoose step 2f (createLnbitsWallet)
  const walletFile = join(newDir, 'lnbits-wallet.json');
  let wallet = null;
  if (existsSync(walletFile)) {
    wallet = JSON.parse(readFileSync(walletFile, 'utf8'));
    wallet.name             = newName;
    wallet.displayName      = newDisplay;
    wallet.lightning_address = `${newName}@goosielabs.com`;
    writeFileSync(walletFile, JSON.stringify(wallet, null, 2) + '\n');
    console.log(`  ⚡ lnbits-wallet.json updated → ${newName}@goosielabs.com`);

    // Rename wallet in LNbits live
    try {
      await lnbitsRenameWallet(wallet.adminkey, newDisplay);
      console.log(`  ⚡ LNbits wallet renamed to "${newDisplay}"`);
    } catch (e) {
      console.log(`  ⚠️  LNbits API rename failed: ${e.message}`);
    }

    // Restart lnaddress so it picks up the new name mapping
    try {
      execSync('sudo systemctl restart lnaddress', { stdio: 'pipe' });
      console.log(`  ⚡ lnaddress restarted — ${newName}@goosielabs.com is live`);
    } catch {
      console.log(`  ⚠️  lnaddress restart failed — run: sudo systemctl restart lnaddress`);
    }
  }

  // ── Step 3: Update NIP-05 nostr.json ───────────────────────────────────────
  // Mirror of newGoose step 2b (addToNip05)
  const nip05 = JSON.parse(readFileSync(NIP05_FILE, 'utf8'));
  if (nip05.names[oldName]) {
    nip05.names[newName] = nip05.names[oldName];
    delete nip05.names[oldName];
    writeFileSync(NIP05_FILE, JSON.stringify(nip05, null, 2) + '\n');
    console.log(`  🌐 NIP-05: ${oldName}@goosielabs.com → ${newName}@goosielabs.com`);
  }

  // ── Step 4: Update agents.json ─────────────────────────────────────────────
  // Mirror of newGoose step 2c (addToAgentsJson)
  const agentsData = JSON.parse(readFileSync(AGENTS_JSON, 'utf8'));
  const agentEntry = agentsData.agents.find(a => a.name === oldName);
  if (agentEntry) {
    agentEntry.name         = newName;
    agentEntry.displayName  = newDisplay;
    agentEntry.nip05        = `${newName}@goosielabs.com`;
    agentEntry.picture      = `https://goosielabs.com/agents/${newName}/${newName}.jpg`;
    writeFileSync(AGENTS_JSON, JSON.stringify(agentsData, null, 2) + '\n');
    console.log(`  📋 agents.json updated`);
  }

  // ── Step 5: Update whitelist.json ──────────────────────────────────────────
  // Mirror of newGoose step 3 (whitelist)
  const wl = JSON.parse(readFileSync(WHITELIST_PATH, 'utf8'));
  if (wl[oldName]) {
    wl[newName] = wl[oldName];
    delete wl[oldName];
    writeFileSync(WHITELIST_PATH, JSON.stringify(wl, null, 2) + '\n');
    console.log(`  ✅ whitelist.json updated`);
  }

  // ── Step 6: Update goose-runner ────────────────────────────────────────────
  // Mirror of newGoose step 4 (goose-runner)
  let runner = readFileSync(GOOSE_RUNNER, 'utf8');
  runner = runner.replace(new RegExp(`\\b${oldName}\\b`, 'g'), newName);
  writeFileSync(GOOSE_RUNNER, runner);
  console.log(`  ✅ goose-runner updated`);

  // ── Step 7: Update gooseConfig.ts ──────────────────────────────────────────
  // Mirror of newGoose step 5 (gooseConfig.ts)
  let config = readFileSync(GOOSE_CONFIG, 'utf8');
  config = config
    .replace(new RegExp(`name: '${oldDisplay}'`, 'g'), `name: '${newDisplay}'`);
  writeFileSync(GOOSE_CONFIG, config);
  console.log(`  ✅ gooseConfig.ts updated`);

  // ── Step 8: Update generate-agent-icons.mjs ────────────────────────────────
  // Mirror of newGoose step 2d (addToIconsGenerator)
  let icons = readFileSync(GENERATE_ICONS_MJS, 'utf8');
  icons = icons
    .replace(new RegExp(`name: '${oldName}'`, 'g'), `name: '${newName}'`)
    .replace(new RegExp(`label: '${oldDisplay}'`, 'g'), `label: '${newDisplay}'`);
  writeFileSync(GENERATE_ICONS_MJS, icons);
  console.log(`  ✅ generate-agent-icons.mjs updated`);

  // ── Step 9: Update generate-agent-portraits.mjs ────────────────────────────
  // Mirror of newGoose step 2e (addToPortraitsGenerator)
  let portraits = readFileSync(GENERATE_PORTRAITS, 'utf8');
  portraits = portraits.replace(new RegExp(`name: '${oldName}'`, 'g'), `name: '${newName}'`);
  writeFileSync(GENERATE_PORTRAITS, portraits);
  console.log(`  ✅ generate-agent-portraits.mjs updated`);

  // ── Step 10: Update publish-homepage.mjs ───────────────────────────────────
  // Mirror of publish-homepage AGENT_COLORS + AGENT_ORDER maps
  let homepage = readFileSync(PUBLISH_HOMEPAGE, 'utf8');
  homepage = homepage
    .replace(new RegExp(`(?<![a-z])${oldName}(?![a-z])`, 'g'), newName);
  writeFileSync(PUBLISH_HOMEPAGE, homepage);
  console.log(`  ✅ publish-homepage.mjs updated`);

  // ── Step 10b: Update publish-agent-pages.mjs ───────────────────────────────
  if (existsSync(PUBLISH_AGENT_PAGES)) {
    let agentPages = readFileSync(PUBLISH_AGENT_PAGES, 'utf8');
    agentPages = agentPages.replace(new RegExp(`(?<![a-z])${oldName}(?![a-z])`, 'g'), newName);
    writeFileSync(PUBLISH_AGENT_PAGES, agentPages);
    console.log(`  ✅ publish-agent-pages.mjs updated`);
  }

  // ── Step 10c: Update generate-agents-html.py ───────────────────────────────
  if (existsSync(GENERATE_AGENTS_HTML)) {
    let genHtml = readFileSync(GENERATE_AGENTS_HTML, 'utf8');
    genHtml = genHtml.replace(new RegExp(`(?<![a-z])${oldName}(?![a-z])`, 'g'), newName);
    writeFileSync(GENERATE_AGENTS_HTML, genHtml);
    console.log(`  ✅ generate-agents-html.py updated`);
  }

  // ── Step 10d: Update pages/homepage_base.html ──────────────────────────────
  if (existsSync(HOMEPAGE_BASE)) {
    let base = readFileSync(HOMEPAGE_BASE, 'utf8');
    base = base
      .replace(new RegExp(oldDisplay, 'g'), newDisplay)
      .replace(new RegExp(`(?<![a-z])${oldName}(?![a-z])`, 'g'), newName);
    writeFileSync(HOMEPAGE_BASE, base);
    console.log(`  ✅ pages/homepage_base.html updated`);
  }

  // ── Step 10e: Update other agent .md files that reference the old name ──────
  // e.g. agents/designy/designy.md has a color table listing all agent names
  for (const agentName of readdirSync(AGENTS_DIR)) {
    const mdPath = join(AGENTS_DIR, agentName, `${agentName}.md`);
    if (!existsSync(mdPath)) continue;
    const mdContent = readFileSync(mdPath, 'utf8');
    if (!mdContent.includes(oldDisplay) && !mdContent.includes(oldName)) continue;
    const updated = mdContent
      .replace(new RegExp(oldDisplay, 'g'), newDisplay)
      .replace(new RegExp(`(?<![a-z])${oldName}(?![a-z])`, 'g'), newName);
    writeFileSync(mdPath, updated);
    console.log(`  ✅ agents/${agentName}/${agentName}.md updated`);
  }

  // ── Step 11: Move webroot portrait copy ────────────────────────────────────
  const oldWebroot = join(WEBROOT_AGENTS, oldName);
  const newWebroot = join(WEBROOT_AGENTS, newName);
  if (existsSync(oldWebroot)) {
    renameSync(oldWebroot, newWebroot);
    // Rename portrait files in webroot too
    for (const file of readdirSync(newWebroot)) {
      if (file.includes(oldName)) {
        const newFile = file.replace(new RegExp(oldName, 'g'), newName);
        renameSync(join(newWebroot, file), join(newWebroot, newFile));
      }
    }
    console.log(`  🖼️  Webroot portrait moved: /agents/${oldName} → /agents/${newName}`);
  }

  // ── Step 11b: Rename .claude/agents/<name>.md ─────────────────────────────
  // This file holds the agent's role description used by publish-homepage.mjs
  const CLAUDE_AGENTS_DIR = '/home/deploy/.claude/agents';
  const oldClaudeMd = join(CLAUDE_AGENTS_DIR, `${oldName}.md`);
  const newClaudeMd = join(CLAUDE_AGENTS_DIR, `${newName}.md`);
  if (existsSync(oldClaudeMd)) {
    let mdContent = readFileSync(oldClaudeMd, 'utf8');
    mdContent = mdContent
      .replace(new RegExp(`^name: ${oldName}$`, 'm'), `name: ${newName}`)
      .replace(new RegExp(`# ${oldDisplay}`, 'g'), `# ${newDisplay}`);
    writeFileSync(newClaudeMd, mdContent);
    rmSync(oldClaudeMd);
    console.log(`  📄 .claude/agents/${oldName}.md → ${newName}.md`);
  }

  // ── Step 12: Re-publish kind:0 with new name/nip05/lud16 ──────────────────
  // Mirror of newGoose step 6 (publishKind0ForGoose)
  const keyFile = join(newDir, 'nostr-key.json');
  const pool = new SimplePool();
  if (existsSync(keyFile)) {
    const keyData = JSON.parse(readFileSync(keyFile, 'utf8'));
    const sk = new Uint8Array(keyData.nsecHex.match(/.{2}/g).map(b => parseInt(b, 16)));
    const about = agentEntry?.about ?? `Goosie Labs V-formation agent — ${newDisplay}.`;
    await publishKind0ForGoose(pool, sk, newName, about);
  }

  // ── Step 13: Rebuild vformation + homepage ─────────────────────────────────
  // Mirror of newGoose step 7 + 7b
  console.log(`  🏗️  Rebuilding vformation...`);
  execSync('NODE_OPTIONS=--max-old-space-size=1024 npm run build', {
    cwd: VFORMATION_DIR,
    stdio: 'pipe',
  });
  console.log(`  ✅ Dashboard rebuilt`);

  // ── Step 13b: Re-publish agent nsite page ──────────────────────────────────
  // publish-agent-pages.mjs regenerates the HTML from .claude/agents/<name>.md
  // and uploads it to Blossom — this is what shows when clicking the agent card
  console.log(`  🌐 Re-publishing nsite agent page for ${newDisplay}...`);
  try {
    execSync(`node ${SCRIPTS_DIR}/publish-agent-pages.mjs --agent ${newName}`, { stdio: 'pipe' });
    console.log(`  ✅ Nsite agent page updated`);
  } catch {
    console.log(`  ⚠️  Agent page publish failed — run: node ${SCRIPTS_DIR}/publish-agent-pages.mjs --agent ${newName}`);
  }

  console.log(`  🏠 Updating homepage tiles...`);
  try {
    execSync('bash /home/deploy/update-tiles.sh', { stdio: 'pipe' });
    console.log(`  ✅ Homepage tiles updated`);
  } catch {
    console.log(`  ⚠️  Tiles update failed — run manually: bash /home/deploy/update-tiles.sh`);
  }

  pool.close([RELAY]);

  console.log(`\n✅ Rename complete: "${oldName}" is now "${newName}"`);
  console.log(`   NIP-05: ${newName}@goosielabs.com`);
  console.log(`   Lightning: ${newName}@goosielabs.com`);
  console.log(`\n⚠️  Manual follow-up:`);
  console.log(`   • Old NIP-05 ${oldName}@goosielabs.com is dead — notify clients if used externally`);
  console.log(`   • Old Lightning Address ${oldName}@goosielabs.com is dead — update any saved addresses`);
  console.log(`   • Update CLAUDE.md (personal + project) — agent name in tables`);
  console.log(`   • Update ${newDir}/${newName}.md if it mentions the old name`);
  console.log(`   • Rebuild agent icons if needed: cd /var/www/goosielabs && node generate-agent-icons.mjs ${newName}`);
}

// ── status ────────────────────────────────────────────────────────────────────

function status() {
  const wl   = JSON.parse(readFileSync(WHITELIST_PATH, 'utf8'));
  const cfg  = readFileSync(GOOSE_CONFIG, 'utf8');

  console.log('\n🤝 Humany — Formation Status\n');
  console.log('Registered geese (whitelist):');

  const skip = ['_comment', 'perry_zoomer', 'perry_goosie'];
  for (const [name, pubkey] of Object.entries(wl)) {
    if (skip.includes(name)) continue;
    const inDashboard = cfg.includes(pubkey);
    const hasKey      = existsSync(resolve(AGENTS_DIR, name, 'nostr-key.json'));
    const hasScript   = existsSync(resolve('/home/deploy/scripts', name, 'index.js'))
                     || existsSync(resolve('/home/deploy/scripts', name, 'index.mjs'));
    const flags = [
      inDashboard ? '📊' : '  ',
      hasKey      ? '🔑' : '  ',
      hasScript   ? '📜' : '  ',
    ].join('');
    console.log(`  ${flags}  ${name.padEnd(12)} ${pubkey.slice(0, 16)}...`);
  }

  console.log('\nLegend: 📊=dashboard  🔑=keypair  📜=script');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const [cmd, ...args] = process.argv.slice(2);

console.log('🤝 Humany — Formation HR & Onboarding');
console.log('──────────────────────────────────────');

switch (cmd) {
  case 'newgoose': {
    const name = args[0];
    if (!name) { console.error('Usage: humany newgoose <name>'); process.exit(1); }
    await newGoose(name);
    break;
  }
  case 'renamegoose': {
    const [oldName, newName] = args;
    if (!oldName || !newName) { console.error('Usage: humany renamegoose <oldname> <newname>'); process.exit(1); }
    await renameGoose(oldName, newName);
    break;
  }
  case 'status':
    status();
    break;
  default:
    console.log('Commands:');
    console.log('  newgoose <old> <new>  Onboard a new goose into the V-Formation');
    console.log('  renamegoose <old> <new>  Rename a goose across all systems');
    console.log('  status                Formation health overview');
}
