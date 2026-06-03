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
const AGENTS_DIR     = '/home/deploy/agents';
const SCRIPTS_DIR    = '/home/deploy/systemsetup/scripts';
const WHITELIST_PATH = '/home/deploy/whitelist.json';
const GOOSE_CONFIG   = '/var/www/goosielabs/apps/vformation/src/lib/gooseConfig.ts';
const GOOSE_RUNNER   = `${SCRIPTS_DIR}/goose-runner/index.mjs`;
const VFORMATION_DIR = '/var/www/goosielabs/apps/vformation';
const PERRY_NPUB_HEX = 'a8364bf8e5b828bd722a6dc71882ff4ee8d379e64fbf4584f0c6f1b393f8058c';

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

async function publishKind0ForGoose(pool, sk, name, emoji) {
  const event = finalizeEvent({
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify({
      name,
      display_name: name,
      about: `${emoji} V-Formation goose — ${name}. Part of Goosie Labs.`,
      picture: `https://goosielabs.com/apps/vformation/icons/icon-192.png`,
      website: 'https://goosielabs.com',
    }),
  }, sk);
  await Promise.allSettled(pool.publish([RELAY], event));
  console.log(`  📛 Kind 0 published for ${name}`);
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

  // 1. Generate keypair
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const nsecHex = Buffer.from(sk).toString('hex');
  console.log(`  🔑 Pubkey: ${pk}`);

  // 2. Create agent directory
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    resolve(agentDir, 'nostr-key.json'),
    JSON.stringify({ pubkey: pk, nsecHex }, null, 2) + '\n'
  );
  writeFileSync(
    resolve(agentDir, `${name}.md`),
    `# ${capitalize(name)} — Role\n\n_Role description to be filled in._\n\n**Pubkey:** ${pk}\n`
  );
  console.log(`  📁 Agent directory created: ${agentDir}`);

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
  await publishKind0ForGoose(pool, sk, capitalize(name), '🪿');

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
  console.log(`\n📝 Next steps:`);
  console.log(`   1. Edit ${agentDir}/${name}.md — add role description`);
  console.log(`   2. Add a script at /home/deploy/scripts/${name}/index.js`);
  console.log(`   3. Restart goose-runner: sudo systemctl restart goose-runner`);
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
