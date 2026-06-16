#!/usr/bin/env node
/**
 * generate-app-icons-ai.mjs
 *
 * Generates fancy AI-illustrated app icons using gpt-image-1 (OpenAI/DALL-E).
 * Style: transparent background, clean vector-style illustration, no text.
 * Output: 1024x1024 PNG → resized to 192x192 and 512x512 via sharp.
 *
 * Usage:
 *   node generate-app-icons-ai.mjs gameofthegoose   # single app
 *   node generate-app-icons-ai.mjs                  # all apps in list
 *
 * Output lands in:
 *   /var/www/goosielabs/apps/<name>/public/icons/icon-192.png
 *   /var/www/goosielabs/apps/<name>/public/icons/icon-512.png
 *   /var/www/goosielabs/apps/<name>/dist/icons/
 *   /var/www/goosielabs/apps/<name>/icons/
 *
 * After running: bash /home/deploy/update-tiles.sh
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import https from 'https';
import sharp from '/var/www/goosielabs/node_modules/sharp/lib/index.js';

const APPS_DIR  = '/var/www/goosielabs/apps';
const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_KEY) {
  console.error('❌ OPENAI_API_KEY not set.');
  console.error('   Source ~/.env.services or pass OPENAI_API_KEY=sk-...');
  process.exit(1);
}

// ── Style baseline ────────────────────────────────────────────────────────────
// Transparent background, clean illustration — no text, no badges, no borders.
const BASE = 'Clean vector-style digital illustration, transparent background, ' +
  'no text, no labels, no UI elements, no borders, no drop shadows. ' +
  'Centred subject filling ~90% of the canvas, edge to edge, almost no empty space around it. Bold flat colours with subtle ' +
  'shading, crisp outlines. App icon aesthetic — immediately recognisable at small size.';

// ── Aerial diorama style (new series) ────────────────────────────────────────
// Perry's recipe: bird's-eye diorama, goose shadow, same flat hand as the geese portraits.
const AERIAL = 'flat 2D cartoon illustration, thick black outlines, cel shading, vector art style, warm cream background, high quality. High-angle bird\'s-eye view, looking down at a small scene from above — what a goose sees while flying over it. In one corner of the icon, three small semi-transparent goose-shaped shadows flying together in a V-formation — a light grey silhouette of three geese, barely-there, drifting across the corner of the scene. Always three geese in V-formation, never one. Centred composition with even empty space around it so it reads cleanly as a square app icon. Classic cartoon animation style, the same flat look as the Goosie Labs geese. NOT realistic, NOT 3D render, NOT photo, no text, no letters — flat cartoon only.';

// ── Per-app prompts ───────────────────────────────────────────────────────────
const apps = [
  {
    name: 'gameofthegoose',
    prompt: `flat 2D cartoon illustration, thick black outlines, cel shading, vector art style, warm cream background, high quality. A simple spiral board game path on a calm green field, seen slightly from above. Just the winding path with a few numbered tiles — calm, minimal, lots of breathing room. Warm greens and soft golds. In the bottom-left corner, very small and subtle, three small goose silhouettes flying in a V-formation — noticeable but still secondary, like a charming detail rather than the main element. NOT realistic, NOT 3D render, NOT photo, no text — flat cartoon only.`,
  },
  {
    name: 'zaphunt',
    prompt: `${AERIAL} The scene: an old weathered treasure map laid out flat on the ground, with a bold red X marking the spot, a dotted route winding across it, and a few golden sats coins scattered around the edges of the map. Warm parchment tones, deep orange and gold accents. Adventure and treasure-hunt energy.`,
  },
  {
    name: 'honkbadge',
    prompt: `${AERIAL} The scene: a shiny round award medal resting on a soft surface, with a small goose silhouette embossed in the centre of the medal and a vibrant amber ribbon laid out in a gentle curve beside it. A few tiny golden sparkles around the edge. Warm amber, gold and cream tones. Prestigious, earned, celebratory.`,
  },
  {
    name: 'honkference',
    prompt: `${AERIAL} The scene: a small stage podium with a microphone standing on top, viewed from above, with three rows of tiny audience seats arranged in a soft curve in front of it, and a few sound-wave arcs radiating from the mic. Warm indigo, soft purple and cream tones with a hint of gold on the microphone. Conference and shared-attention energy.`,
  },
  {
    name: 'honkensus',
    prompt: `${AERIAL} The scene: three small wooden voting tokens arranged in a triangle on a soft surface, each marked with a tiny checkmark, with three speech bubbles meeting and overlapping at a single point in the centre where a small gold star sits — the moment of agreement. Calm slate-blue, warm cream and soft gold tones. Consensus and quiet decision-making.`,
  },
  {
    name: 'lastwill',
    prompt: `${AERIAL} The scene: an elegant hourglass standing upright on a polished wooden desk, sand softly flowing from the top chamber to the bottom, with a folded sealed letter resting beside it and a small brass key next to the letter. Warm cream and parchment tones with deep navy accents and a hint of gold on the hourglass frame. Solemn, timeless, the quiet weight of a legacy.`,
  },
  {
    name: 'mint',
    prompt: `${AERIAL} The scene: a small coin-mint press standing on a workshop surface, with neat stacks of golden coins beside it and a single freshly-stamped coin in the foreground showing a lightning bolt on its face. A few minting sparks around the press. Warm teal, gleaming gold, soft cream tones. Clean monetary energy.`,
  },
  {
    name: 'proofofread',
    prompt: `${AERIAL} The scene: an open book lying on a warm wooden desk, with round reading glasses resting on one page and a small ceramic mug of steaming tea or coffee beside it. Cosy and inviting. Warm browns, soft cream pages, deep green and gold accents. Knowledge and quiet study.`,
  },
  {
    name: 'proofofmove',
    prompt: `${AERIAL} The scene: a yoga or training mat laid out on a wooden floor, with the outline of a person mid-movement drawn cleanly on the mat — one limb glowing bright lime-green to show a correct alignment, another limb softly red to show needs-adjustment. A small lightning-bolt spark hovers above. Fresh greens, warm wood tones, soft red accent. Movement-coaching energy.`,
  },
  {
    name: 'feedback',
    prompt: `${AERIAL} The scene: a small wooden feedback drop-box sitting on a soft surface, with a folded paper note being slipped into the slot from above, and a row of three small gold stars floating next to it. A tiny lightning-bolt spark next to the box hints at sats. Warm teal, cream and gold tones. Clean, honest feedback energy.`,
  },
  {
    name: 'dilemma',
    prompt: `${AERIAL} The scene: a forked dirt path splitting into two directions across a soft green meadow, with a single shiny gold coin resting right at the junction where the path divides. Calm greens, warm earth tones, glinting gold. A quiet crossroads moment — which way to go?`,
  },
  {
    name: 'satquiz',
    prompt: `${AERIAL} The scene: a quiz card lying face-up on a warm surface, with a bold question mark printed on it, three small golden sats coins stacked neatly beside the card, and a tiny lightning-bolt spark hovering above the top coin. Warm orange, deep amber and cream tones. Playful quiz energy with a Bitcoin reward feel.`,
  },
  {
    name: 'toddy',
    prompt: `${AERIAL} The scene: a small wooden clipboard lying on a soft surface with a checklist of three handwritten items, the top one ticked in bright green, a tiny pencil resting diagonally across the clipboard, and a small lightning-bolt spark next to the ticked item. Fresh green, warm wood and cream tones. Satisfying, productive, calm.`,
  },
  {
    name: 'georgie',
    prompt: `${AERIAL} The scene: a hand-drawn parchment map laid flat on a soft surface, showing a winding road curving past small mountains, with a single bright red location pin standing upright at the most important point on the map and a tiny compass rose in one corner. Warm terracotta, soft cream parchment and deep forest-green accents. Place, journey and discovery.`,
  },
  {
    name: 'zinin',
    prompt: `${AERIAL} The scene: two winding footpaths approaching each other through a soft green meadow and meeting in the middle at a small clearing, where two speech bubbles float above the meeting point and overlap to form a single shared heart-spark in their overlap. Calm greens, warm rose and cream tones. Serendipitous connection — two people landing on the same thought at the same moment.`,
  },
  {
    name: 'skein',
    prompt: `${AERIAL} The scene: several translucent weekly calendar grids gently overlapping on a soft surface, most cells lightly shaded as busy, and one single cell at the centre glowing warm gold where all the calendars line up — the shared free moment. A tiny bicycle and a tiny doorway icon rest near the glowing cell, hinting at the resources being matched. Calm sky-blue, warm cream, soft slate and a single bright gold accent. Quiet coordination, privacy, the moment of overlap.`,
  },
  {
    name: 'bookwriter',
    prompt: `${AERIAL} The scene: a writer's wooden desk seen from above, with a half-finished manuscript page in the centre, a quill pen resting across it mid-stroke leaving a trail of ink that curls into a small lightning-zap spark, a small stack of finished pages beside it and an ink-pot in the corner. Deep amber, warm brown and soft gold tones. Creative, focused, slightly electric.`,
  },
];

// ── API call ──────────────────────────────────────────────────────────────────
async function generateImage(prompt) {
  const body = JSON.stringify({
    model: 'gpt-image-1',
    prompt,
    n: 1,
    size: '1024x1024',
    quality: 'medium',
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/images/generations',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const parsed = JSON.parse(data);
        if (parsed.error) return reject(new Error(parsed.error.message));
        resolve(parsed.data[0].b64_json || parsed.data[0].url);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Resize and save ───────────────────────────────────────────────────────────
async function saveIcon(appName, imageB64OrUrl) {
  const appDir = join(APPS_DIR, appName);
  for (const subdir of ['public/icons', 'dist/icons', 'icons']) {
    mkdirSync(join(appDir, subdir), { recursive: true });
  }

  let buf;
  if (imageB64OrUrl.startsWith('http')) {
    buf = await new Promise((resolve, reject) => {
      https.get(imageB64OrUrl, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });
    });
  } else {
    buf = Buffer.from(imageB64OrUrl, 'base64');
  }

  for (const [size, filename] of [[192, 'icon-192.png'], [512, 'icon-512.png']]) {
    const resized = await sharp(buf)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    for (const subdir of ['public/icons', 'dist/icons', 'icons']) {
      writeFileSync(join(appDir, subdir, filename), resized);
    }
  }
  console.log(`  ✓ ${appName} — saved 192px + 512px to public/icons, dist/icons, icons`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
// Two modes:
//   node generate-app-icons-ai.mjs <appname>              # from `apps` array
//   node generate-app-icons-ai.mjs --name <n> --scene "…"  # ad-hoc AERIAL scene
const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}
const adHocName  = flag('--name');
const adHocScene = flag('--scene');

let targets;
if (adHocName && adHocScene) {
  targets = [{
    name: adHocName,
    prompt: `${AERIAL} The scene: ${adHocScene}`,
  }];
} else {
  const cliArg = argv[0];
  targets = cliArg ? apps.filter(a => a.name === cliArg) : apps;
  if (targets.length === 0) {
    console.error(`❌ Unknown app: ${cliArg}`);
    console.error(`   Available: ${apps.map(a => a.name).join(', ')}`);
    console.error(`   Or use ad-hoc: --name <n> --scene "<one-line scene>"`);
    process.exit(1);
  }
}

console.log(`\n🎨 Generating ${targets.length} AI app icon(s) via gpt-image-1\n`);

for (const { name, prompt } of targets) {
  process.stdout.write(`  → ${name} … `);
  try {
    const result = await generateImage(prompt);
    await saveIcon(name, result);
  } catch (e) {
    console.error(`\n  ✗ ${name}: ${e.message}`);
  }
}

console.log('\n✅ Done. Run: bash /home/deploy/update-tiles.sh\n');
