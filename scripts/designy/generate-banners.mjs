#!/usr/bin/env node
/**
 * Designy — Goose Banner Generator
 *
 * Generates DALL-E banner images for all V-Formation geese.
 * Uploads to Blossom, updates kind:0 Nostr profile with banner field.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node generate-banners.mjs              # all geese
 *   OPENAI_API_KEY=sk-... node generate-banners.mjs gander       # one goose
 *   OPENAI_API_KEY=sk-... node generate-banners.mjs --dry-run    # show prompts only
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';

const DRY_RUN    = process.argv.includes('--dry-run');
const TARGET     = process.argv.slice(2).find(a => !a.startsWith('-'));
const API_KEY    = process.env.OPENAI_API_KEY ?? process.env.GANDER_AI_KEY ?? '';
const AI_URL     = process.env.OPENAI_API_URL ?? 'https://api.openai.com/v1';

const AGENTS_DIR  = '/home/deploy/agents';
const BLOSSOM     = 'http://127.0.0.1:3339';
const RELAY       = 'ws://127.0.0.1:7778';
const NOSTR_TOOLS = '/var/www/goosielabs/apps/catchzaps/node_modules/nostr-tools/lib/esm/index.js';
const WS_PATH     = '/home/deploy/nsite-gateway/node_modules/ws/lib/websocket.js';
const { INTERNAL_RELAY, PUBLISH_RELAYS } = await import('../relay-config.mjs');
const ALL_RELAYS  = [INTERNAL_RELAY, ...PUBLISH_RELAYS];
const BANNERS_DIR = `${AGENTS_DIR}/../goose-banners`;

mkdirSync(BANNERS_DIR, { recursive: true });

// ── Prompts per goose ─────────────────────────────────────────────────────────
// Style: dark background, Goosie Labs identity, wide cinematic banner (1792x1024)
// Consistent: navy/indigo tones, subtle goose feather motif, no text

const BASE = 'Cinematic wide banner image (16:9), dark navy blue background, abstract tech aesthetic, subtle goose feather silhouette in corner, no text, no letters, photorealistic digital art style.';

const PROMPTS = {
  assistenty: `${BASE} A glowing constellation of sticky notes, todo checkboxes and calendar entries orbiting a central bright star. Teal and indigo light streams. Organized chaos becoming clarity.`,

  blocky:     `${BASE} Golden Bitcoin blocks stacking infinitely into a dark horizon, each block glowing with orange light (#f7931a). A blockchain extending like a highway into infinity. Bitcoin orange and deep navy.`,

  healthy:    `${BASE} Green EKG heartbeat line pulsing across server racks with status LEDs. One flat-line moment then strong recovery pulse. Medical precision meets data center aesthetic. Green on dark.`,

  gander:     `${BASE} A lone figure on a cliff edge looking through a telescope at a vast information horizon — streams of headlines and data flowing like auroras in the night sky. Explorer aesthetic.`,

  coachy:     `${BASE} A V-formation of geese soaring upward into a warm amber sunrise, golden light rays breaking through clouds. Uplifting, energetic, hopeful. Warm amber and gold tones on dark sky.`,

  backy:      `${BASE} A glowing deep-blue vault door half-open, emanating golden light with floating data packets and save icons orbiting it. Secure, reliable, trustworthy. Blue and gold tones.`,

  secury:     `${BASE} An emerald green glowing shield in the center, binary code and Matrix-style characters raining around it, network attack attempts deflected as sparks. Dark with green accents.`,

  jurry:      `${BASE} Ancient scales of justice illuminated by cool blue light, surrounded by floating legal documents that dissolve into code. Navy blue, authoritative, precise. Deep navy tones.`,

  ay:         `${BASE} Interlocking violet gear systems rotating perfectly, YAML and JSON configuration fragments glowing in purple, everything in perfect coherence. Dark purple, systematic beauty.`,

  finny:      `${BASE} A golden Lightning bolt splitting through a stack of glowing Bitcoin coins, sat counters flowing like water, financial streams of light. Amber gold and Bitcoin orange.`,

  testy:      `${BASE} A magnifying glass revealing hidden glowing bugs in code, test results showing green checkmarks and red X marks cascading. Orange debugging energy, circuit patterns.`,

  commy:      `${BASE} A glowing megaphone sending Nostr purple notes and lightning bolts outward across a connected network of nodes. Social, vibrant. Rose pink and purple on dark.`,

  designy:    `${BASE} A color palette explosion — gradients morphing into wireframes morphing into polished interfaces, all layered in artistic chaos. Creative purple and violet energy.`,

  cssy:       `${BASE} Flowing streams of glowing CSS code and design variables spiraling upward like liquid light, creating perfect harmony from structured code. Clean lines of pure color and light in mint green, soft cyan, and gold. Order and design made luminous.`,

  nosty:      `${BASE} Cryptographic keys rotating as constellations in deep space, NIP numbers floating like stars, a central Nostr logo pulsing purple. Identity and cosmos. Deep purple.`,

  docy:       `${BASE} An illuminated pathway leading through stages of a journey — a door, steps, guides, a welcome mat — all glowing gently. Slate blue-grey, welcoming, professional.`,

  transy:     `${BASE} A brilliant red diamond gemstone cutting through layers of illusion and fog, hard truths emerging. Sharp edges, no softness. Deep crimson and steel grey.`,

  checky:     `${BASE} A teal magnifying glass over interconnected quality checkpoints, specialists at each node passing work forward. Network of excellence. Teal and dark tones.`,

  directory:  `${BASE} A compass rose glowing gold on a dark map of horizons, formation arrows pointing to distant peaks. High vantage point, strategic vision. Amber and dark brown.`,

  humany:     `${BASE} A warm handshake between two abstract goose silhouettes, onboarding pathways branching outward like a welcome tree. Warm orange on dark, human connection.`,

  devy:       `${BASE} A glowing wrench and gear turning code into deployed infrastructure, git branches flowing like circuits. Electric blue on dark, DevOps precision.`,

  supporty:   `${BASE} A calming blue headset with gentle waves of communication flowing outward, a helping hand extended. Supportive, calm, slate blue on dark.`,

  transy:     `${BASE} A brilliant red diamond gemstone cutting through layers of illusion, hard truths emerging from fractured surfaces. Sharp, uncompromising. Deep crimson.`,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function generateImage(prompt) {
  const res = await fetch(`${AI_URL}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      n: 1,
      size: '1536x1024',
      quality: 'medium',
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`DALL-E error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  // gpt-image-1 returns b64_json, dall-e-3 returns url
  const item = data.data[0];
  if (item.url) return item.url;
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
  throw new Error('No image in response: ' + JSON.stringify(item));
}

async function downloadImage(url) {
  // Handle base64 data URLs from gpt-image-1
  if (url.startsWith('data:')) {
    const base64 = url.split(',')[1];
    return Buffer.from(base64, 'base64');
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function uploadToBlossom(buf, agentSk) {
  const { finalizeEvent } = await import(NOSTR_TOOLS);
  const sha = createHash('sha256').update(buf).digest('hex');

  // Check if already on Blossom
  const head = await fetch(`${BLOSSOM}/${sha}`, { method: 'HEAD' });
  if (head.ok) return sha;

  const now = Math.floor(Date.now() / 1000);
  const auth = finalizeEvent({
    kind: 24242, created_at: now,
    tags: [['t','upload'],['x',sha],['expiration',String(now+3600)]],
    content: 'Upload goose banner',
  }, agentSk);

  const res = await fetch(`${BLOSSOM}/upload`, {
    method: 'PUT',
    headers: {
      'Authorization': `Nostr ${Buffer.from(JSON.stringify(auth)).toString('base64')}`,
      'Content-Type': 'image/png',
      'Content-Length': String(buf.length),
      'X-SHA-256': sha,
    },
    body: buf,
  });
  if (!res.ok) throw new Error(`Blossom upload failed: ${res.status} ${await res.text()}`);
  return sha;
}

async function updateProfile(name, bannerUrl, agentSk) {
  const { finalizeEvent } = await import(NOSTR_TOOLS);
  const WebSocket = (await import(WS_PATH)).default;

  const agents = JSON.parse(readFileSync(`${AGENTS_DIR}/agents.json`, 'utf8'));
  const agent  = agents.agents.find(a => a.name === name);
  if (!agent) throw new Error(`Agent ${name} not in agents.json`);

  const lud16 = `${name}@goosielabs.com`;

  const metadata = {
    name:    agent.displayName ?? name,
    about:   agent.about ?? '',
    picture: `https://goosielabs.com/agents/${name}/${name}.jpg`,
    website: 'https://goosielabs.com',
    nip05:   `${name}@goosielabs.com`,
    banner:  bannerUrl,
    lud16,
    bot: true,
  };

  const event = finalizeEvent({
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify(metadata),
  }, agentSk);

  // Publish to local relay + external relays
  const relays = [RELAY, ...ALL_RELAYS];
  await Promise.allSettled(relays.map(url => new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', event])));
    ws.on('message', () => { ws.close(); resolve(); });
    ws.on('error', () => { ws.close(); resolve(); });
    setTimeout(() => { try { ws.close(); } catch {} resolve(); }, 8000);
  })));

  return event.id;
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (!API_KEY && !DRY_RUN) {
  console.error('❌ Set OPENAI_API_KEY=sk-... in environment');
  console.error('   Or run with --dry-run to preview prompts');
  process.exit(1);
}

// Which geese to process
const agents = JSON.parse(readFileSync(`${AGENTS_DIR}/agents.json`, 'utf8')).agents;
const toProcess = TARGET
  ? agents.filter(a => a.name === TARGET)
  : agents.filter(a => PROMPTS[a.name]);

console.log(`🎨 Designy — Goose Banner Generator`);
console.log(`   Mode: ${DRY_RUN ? 'dry-run (prompts only)' : 'generate + publish'}`);
console.log(`   Geese: ${toProcess.map(a => a.name).join(', ')}\n`);

for (const agent of toProcess) {
  const { name } = agent;
  const prompt = PROMPTS[name];
  if (!prompt) { console.log(`⏭  ${name}: no prompt defined, skipping`); continue; }

  console.log(`\n🪿 ${name}`);

  if (DRY_RUN) {
    console.log(`   Prompt: ${prompt.slice(0, 100)}...`);
    continue;
  }

  try {
    // Load agent key
    const keyFile = `${AGENTS_DIR}/${name}/nostr-key.json`;
    if (!existsSync(keyFile)) { console.log(`   ⚠️  No key file, skipping`); continue; }
    const key = JSON.parse(readFileSync(keyFile, 'utf8'));
    const sk  = new Uint8Array(key.nsecHex.match(/.{2}/g).map(b => parseInt(b, 16)));

    // Check if banner already exists locally
    const localFile = `${BANNERS_DIR}/${name}-banner.png`;
    let imageBuf;

    if (existsSync(localFile)) {
      console.log(`   📂 Using cached banner`);
      imageBuf = readFileSync(localFile);
    } else {
      console.log(`   🎨 Generating with DALL-E 3...`);
      const imageUrl = await generateImage(prompt);
      imageBuf = await downloadImage(imageUrl);
      writeFileSync(localFile, imageBuf);
      console.log(`   ✅ Generated (${Math.round(imageBuf.length / 1024)}KB)`);
    }

    // Upload to Blossom
    console.log(`   📤 Uploading to Blossom...`);
    const sha = await uploadToBlossom(imageBuf, sk);
    const bannerUrl = `https://blossom.goosielabs.com/${sha}`;
    console.log(`   ✅ Blossom: ${sha.slice(0, 16)}...`);

    // Update kind:0 profile
    console.log(`   📛 Updating Nostr profile...`);
    const eventId = await updateProfile(name, bannerUrl, sk);
    console.log(`   ✅ Profile updated: ${eventId.slice(0, 16)}...`);

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 2000));

  } catch (e) {
    console.error(`   ❌ Failed: ${e.message}`);
  }
}

console.log('\n✅ Designy done.\n');
if (!DRY_RUN) {
  console.log('Banners cached in: ~/goose-banners/');
  console.log('Re-run with a goose name to regenerate one: node generate-banners.mjs <name>');
}
