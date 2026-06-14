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

// ── Per-app prompts ───────────────────────────────────────────────────────────
const apps = [
  {
    name: 'gameofthegoose',
    prompt: `${BASE} Bird's-eye view looking straight down at a colourful spiral board game path winding across a lush green landscape — numbered tiles, a small castle, a bridge over a river, a tiny tavern, rolling hills. The kind of destination a flying bird spots from above and thinks "let's land there". Vibrant greens, warm golds, terracotta reds. Top-down map aesthetic, rich and inviting. No birds, no animals, no characters — only the landscape and the path.`,
  },
  {
    name: 'catchzaps',
    prompt: `${BASE} A glowing orange lightning bolt striking a location pin on a stylised city map. Electric energy radiating outward. Bold orange and deep navy.`,
  },
  {
    name: 'zaphunt',
    prompt: `${BASE} A golden magnifying glass with a lightning bolt inside it, surrounded by small glowing sats coins. Treasure-hunt energy. Deep orange and gold tones.`,
  },
  {
    name: 'honkbadge',
    prompt: `${BASE} A shiny award medal with a goose silhouette embossed in the centre, hanging from a vibrant ribbon. Amber and gold tones. Prestigious and clean.`,
  },
  {
    name: 'honkference',
    prompt: `${BASE} A stylised microphone with sound waves forming the shape of a flock of geese flying outward. Purple and indigo tones. Conference energy.`,
  },
  {
    name: 'honkensus',
    prompt: `${BASE} Three overlapping speech bubbles forming a Venn diagram, each with a small checkmark. Consensus and agreement visualised. Dark slate blue with white accents.`,
  },
  {
    name: 'swarm',
    prompt: `${BASE} A V-formation of glowing bird silhouettes flying in perfect formation, viewed from slightly below against a dark sky. Deep navy and electric blue.`,
  },
  {
    name: 'vformation',
    prompt: `${BASE} Abstract circuit-board pattern shaped like a V-formation of birds, with glowing nodes at each position. Dark background, neon teal and purple accents.`,
  },
  {
    name: 'lastwill',
    prompt: `${BASE} A sealed envelope with a wax seal, partially wrapped in a golden chain with a padlock. Dark navy background feel, gold and white tones. Secure, solemn.`,
  },
  {
    name: 'mint',
    prompt: `${BASE} A gleaming gold coin with a lightning bolt on one face, minting sparks around it. Teal and gold tones. Clean monetary energy.`,
  },
  {
    name: 'weddendat',
    prompt: `${BASE} Two cartoon hands about to shake, each holding a glowing lightning bolt token. Bold purple and electric white. A bet being sealed.`,
  },
  {
    name: 'proofofread',
    prompt: `${BASE} An open book with a glowing NFC/badge seal floating above the page, small lightning bolts as page markers. Dark green and gold tones. Knowledge verified.`,
  },
  {
    name: 'proofofmove',
    prompt: `${BASE} A human silhouette in motion with a glowing green overlay perfectly matching the pose. Movement-detection energy. Dark green and bright lime.`,
  },
  {
    name: 'feedback',
    prompt: `${BASE} A speech bubble with a small lightning bolt inside, floating above a simplified star rating. Teal and white. Clean feedback energy.`,
  },
  {
    name: 'dilemma',
    prompt: `${BASE} A fork in a glowing path, one branch gold and one branch purple, with a question mark hovering at the split. Deep purple tones.`,
  },
  {
    name: 'satquiz',
    prompt: `${BASE} A glowing question mark made of stacked Bitcoin sats coins. Orange and deep amber. Quiz-meets-lightning energy.`,
  },
  {
    name: 'toddy',
    prompt: `${BASE} A clean checklist with three items, the top one ticked in bright green with a small lightning bolt beside it. Fresh green and white. Satisfying productivity.`,
  },
  {
    name: 'gooseprogrammer',
    prompt: `${BASE} A cartoon goose head wearing developer headphones and tiny glasses, with a glowing code bracket </ > as a halo. Indigo and white. Nerdy and fun.`,
  },
  {
    name: 'georgie',
    prompt: `${BASE} A stylised hand-drawn map fragment with a glowing location pin, mountains and a winding road. Earthy terracotta and parchment tones. Adventure and place.`,
  },
  {
    name: 'sofia',
    prompt: `${BASE} A paper airplane made of a boarding pass, trailing a small flock of bird icons. Sky blue and white. Group travel lightness.`,
  },
  {
    name: 'zinin',
    prompt: `${BASE} Two glowing thought bubbles drifting together and merging into one bright shared bubble with a small heart spark. Warm rose and white. Serendipitous connection.`,
  },
  {
    name: 'bookwriter',
    prompt: `${BASE} A quill pen writing glowing text that trails off into a Nostr lightning-zap pattern. Dark amber and gold on deep brown. Creative and electric.`,
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
const cliArg = process.argv[2];
const targets = cliArg ? apps.filter(a => a.name === cliArg) : apps;

if (targets.length === 0) {
  console.error(`❌ Unknown app: ${cliArg}`);
  console.error(`   Available: ${apps.map(a => a.name).join(', ')}`);
  process.exit(1);
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
