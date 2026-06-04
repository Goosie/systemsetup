#!/usr/bin/env node
/**
 * generate-agent-portraits.mjs
 *
 * Generates flat 2D cartoon goose portraits for V-formation agents
 * using gpt-image-1 (OpenAI API).
 *
 * Style: flat 2D cartoon, thick black outlines, cel shading — same look
 * as astrid.jpg, danky.jpg, finny.jpg etc. BASE_STYLE enforces this.
 * Do NOT change BASE_STYLE without regenerating all portraits.
 *
 * Usage:
 *   node generate-agent-portraits.mjs              # all agents
 *   node generate-agent-portraits.mjs directory    # single agent
 *   (OPENAI_API_KEY is auto-loaded from ~/.bashrc.local if not in env)
 *
 * Output: /home/deploy/agents/<name>/<name>.jpg  (+ adult_<name>.jpg)
 * Deploy: update-tiles.sh copies portraits to webroot automatically.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import https from 'https';

const AGENTS_DIR = '/home/deploy/agents';
const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_KEY) {
  console.error('❌ OPENAI_API_KEY not set.');
  console.error('   Run: OPENAI_API_KEY=sk-... node generate-agent-portraits.mjs');
  process.exit(1);
}

const BASE_STYLE = 'flat 2D cartoon character illustration, thick black outlines, cel shading, vector art style, warm cream background, full body standing pose, adult white goose with expressive cartoon eyes, orange beak, orange feet, white feathers, high quality. Classic cartoon animation style — same look as Assistenty the lab-coat goose, Danky the hard-hat goose, Finny the top-hat goose. NOT realistic, NOT 3D render, NOT photo — flat cartoon only';

const agents = [
  {
    name: 'assistenty',
    prompt: `${BASE_STYLE}. Wearing a neat white lab coat with a stethoscope, holding a leather-bound clipboard, reading glasses perched on beak. Wise, composed, the senior researcher who has seen it all.`,
  },
  {
    name: 'danky',
    prompt: `${BASE_STYLE}. Wearing a worn orange hard hat and a tool belt loaded with wrenches and screwdrivers, holding a large wrench. Gruff, capable, sleeves rolled up — the engineer who ships things.`,
  },
  {
    name: 'finny',
    prompt: `${BASE_STYLE}. Wearing a sharp black three-piece suit with a black top hat, monocle in one eye, holding a Bitcoin gold coin with one wing and a leather ledger in the other. Distinguished, wealthy, sharp-eyed financier.`,
  },
  {
    name: 'haitje',
    prompt: `${BASE_STYLE}. Wearing a black academic mortarboard and dark university robes with a gold chain of office, holding a thick audit report. Authoritative professor, experienced examiner, sharp scrutinising expression.`,
  },
  {
    name: 'jurry',
    prompt: `${BASE_STYLE}. Wearing a full traditional judge's white curled wig and flowing black judicial robes, holding a wooden gavel. Imposing, unsmiling, the weight of the law behind every glance.`,
  },
  {
    name: 'ruby',
    prompt: `${BASE_STYLE}. Wearing a deep red turtleneck and a bold red plaid scarf, arms crossed, looking directly at you with a raised eyebrow and a no-nonsense expression. The goose who asks the hard questions.`,
  },
  {
    name: 'tessa',
    prompt: `${BASE_STYLE}. Wearing large round tortoiseshell glasses and a white QA engineer polo shirt, holding a tablet showing a test report with red and green indicators. Focused, methodical, nothing escapes her.`,
  },
  {
    name: 'secury',
    prompt: `${BASE_STYLE}. Wearing a dark green security guard uniform with a badge and epaulettes, holding a shield with authority. Strong, experienced, trustworthy pose.`,
  },
  {
    name: 'checky',
    prompt: `${BASE_STYLE}. Wearing sharp reading glasses, holding a magnifying glass in one hand and a clipboard with a checklist in the other. Sharp, analytical, no-nonsense expression.`,
  },
  {
    name: 'commy',
    prompt: `${BASE_STYLE}. Holding a rose-pink professional microphone, standing tall with an open confident beak as if addressing a crowd. Charismatic, commanding presence.`,
  },
  {
    name: 'designy',
    prompt: `${BASE_STYLE}. Wearing a stylish purple beret and a modern design studio apron, holding a paint palette in one hand and a fine brush in the other. Creative, composed, artistic authority.`,
  },
  {
    name: 'nosty',
    prompt: `${BASE_STYLE}. Wearing a deep purple robe with subtle cryptographic symbols, holding a large ornate key with a knowing expression. Wise, mysterious, experienced.`,
  },
  {
    name: 'blocky',
    prompt: `${BASE_STYLE}. Wearing a sharp orange blazer with a subtle Bitcoin ₿ pin on the lapel, holding a gold coin. Confident, successful, seasoned financier.`,
  },
  {
    name: 'admission',
    prompt: `${BASE_STYLE}. Wearing a crisp dark grey business suit with a tie, holding a golden ticket in one hand and a pen in the other. Authoritative, composed, professional gatekeeper.`,
  },
  {
    name: 'directory',
    prompt: `${BASE_STYLE}. Wearing a sharp navy-blue tailored suit with a crisp white shirt and a subtle compass-rose tie pin, holding a leather portfolio under one wing and a golden compass in the other. Distinguished, approachable, the visionary director who sees the big horizon — a goose you would call for a serious conversation.`,
  },
  {
    name: 'supporty',
    prompt: `${BASE_STYLE}. Wearing a light blue polo shirt with a small headset on one ear and a friendly open-winged pose as if welcoming someone. Holds a clipboard with a checklist. Warm, approachable smile — the goose who always has time for your question.`,
  },
];

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

async function downloadImage(urlOrB64) {
  // b64_json response
  if (!urlOrB64.startsWith('http')) {
    return Buffer.from(urlOrB64, 'base64');
  }
  return new Promise((resolve, reject) => {
    https.get(urlOrB64, (res) => {
      // follow redirect if needed
      if (res.statusCode === 301 || res.statusCode === 302) {
        return https.get(res.headers.location, (r) => {
          const chunks = [];
          r.on('data', chunk => chunks.push(chunk));
          r.on('end', () => resolve(Buffer.concat(chunks)));
          r.on('error', reject);
        });
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
  });
}

const targetName = process.argv[2];
const targets = targetName
  ? agents.filter(a => a.name === targetName)
  : agents;

if (targetName && targets.length === 0) {
  console.error(`❌ Unknown agent: ${targetName}`);
  console.error(`   Known: ${agents.map(a => a.name).join(', ')}`);
  process.exit(1);
}

console.log(`🎨 Designy — generating ${targets.length} adult portrait(s) via gpt-image-1\n`);

for (const { name, prompt } of targets) {
  process.stdout.write(`  ${name.padEnd(12)} generating… `);
  try {
    const url = await generateImage(prompt);
    const buf = await downloadImage(url);
    const dir = join(AGENTS_DIR, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `adult_${name}.jpg`), buf);
    writeFileSync(join(dir, `${name}.jpg`), buf);  // active portrait used by homepage
    console.log(`✓  saved to agents/${name}/adult_${name}.jpg`);
  } catch (err) {
    console.log(`❌  ${err.message}`);
  }
}

console.log('\nDone. Run: bash /home/deploy/update-tiles.sh  (copies portraits to webroot + republishes homepage)');
