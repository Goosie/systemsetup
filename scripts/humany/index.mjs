#!/usr/bin/env node
/**
 * Humany — Formation HR & Onboarding goose
 *
 * Commands:
 *   newgoose <name>   Onboard a new goose into the V-Formation
 *   status            Formation health overview
 */

import 'websocket-polyfill';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
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
const WEBROOT_AGENTS     = `${GOOSIELABS_DIR}/agents`;
const PERRY_NPUB_HEX     = 'a8364bf8e5b828bd722a6dc71882ff4ee8d379e64fbf4584f0c6f1b393f8058c';

const astridKey  = JSON.parse(readFileSync(resolve(AGENTS_DIR, 'astrid/nostr-key.json'), 'utf8'));
const ASTRID_SK  = new Uint8Array(astridKey.nsecHex.match(/.{2}/g).map(b => parseInt(b, 16)));
const ASTRID_PK  = astridKey.pubkey;
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

async function publishKind0ForGoose(pool, sk, name, about) {
  const displayName = capitalize(name);
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
      bot: true,
    }),
  }, sk);
  await Promise.allSettled(pool.publish(ALL_RELAYS, event));
  console.log(`  📛 Kind 0 published for ${displayName} (${ALL_RELAYS.length} relays)`);
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
  const newEntry = `  { name: '${name}', bg: '#6366f1', symbol: 'uni2B50', label: '${label}' }, // indigo — ⭐ placeholder — update bg+symbol via @designy`;
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
    `    prompt: \`\${BASE_STYLE}. Professional Goosie Labs agent — ${label}. Warm, capable, confident team player.\`,\n` +
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

function generatePortrait(name) {
  const key = process.env.OPENAI_API_KEY;
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

  // 6. Publish kind 0 metadata for the new goose
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
  console.log(`   5. Add a script at /home/deploy/scripts/${name}/index.js`);
  console.log(`   6. Restart goose-runner: sudo systemctl restart goose-runner`);
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
  case 'status':
    status();
    break;
  default:
    console.log('Commands:');
    console.log('  newgoose <name>   Onboard a new goose into the V-Formation');
    console.log('  status            Formation health overview');
}
