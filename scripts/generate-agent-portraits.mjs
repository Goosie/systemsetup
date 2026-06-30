#!/usr/bin/env node
/**
 * generate-agent-portraits.mjs
 *
 * Generates flat 2D cartoon goose portraits for V-formation agents
 * using gpt-image-1 (OpenAI API).
 *
 * Style: flat 2D cartoon, thick black outlines, cel shading — same look
 * as assistenty.jpg, devy.jpg, finny.jpg etc. BASE_STYLE enforces this.
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
import { execSync } from 'child_process';

// Derive icon-192/512 as a centre-cropped square of the DALL-E portrait, so the
// icon is ALWAYS the real DALL-E art — never the old composite/placeholder icon.
function writeSquareIcons(dir, name) {
  const py = [
    'from PIL import Image',
    `img = Image.open(${JSON.stringify(join(dir, `${name}.jpg`))}).convert("RGB")`,
    'w, h = img.size; s = min(w, h); l = (w - s) // 2; t = (h - s) // 2',
    'img = img.crop((l, t, l + s, t + s))',
    `for px in (192, 512): img.resize((px, px), Image.LANCZOS).save(${JSON.stringify(join(dir, 'icon-'))} + str(px) + ".png")`,
  ].join('\n');
  execSync('python3', { input: py });
}

const AGENTS_DIR = '/home/deploy/agents';
const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_KEY) {
  console.error('❌ OPENAI_API_KEY not set.');
  console.error('   Run: OPENAI_API_KEY=sk-... node generate-agent-portraits.mjs');
  process.exit(1);
}

const BASE_STYLE = 'flat 2D cartoon character illustration, thick black outlines, cel shading, vector art style, warm cream background, full body standing pose, adult white goose with expressive cartoon eyes, orange beak, orange feet, white feathers, high quality. Leave at least 20% empty space above the character\'s head. Classic cartoon animation style — same look as Assistenty the lab-coat goose, Devy the hard-hat goose, Finny the top-hat goose. NOT realistic, NOT 3D render, NOT photo — flat cartoon only';

const agents = [
  {
    name: 'assistenty',
    prompt: `${BASE_STYLE}. Wearing a neat white lab coat with a stethoscope, holding a leather-bound clipboard, reading glasses perched on beak. Wise, composed, the senior researcher who has seen it all.`,
  },
  {
    name: 'devy',
    prompt: `${BASE_STYLE}. Wearing a worn orange hard hat and a tool belt loaded with wrenches and screwdrivers, holding a large wrench. Gruff, capable, sleeves rolled up — the engineer who ships things.`,
  },
  {
    name: 'finny',
    prompt: `${BASE_STYLE}. Wearing a sharp black three-piece suit with a black top hat, monocle in one eye, holding a Bitcoin gold coin with one wing and a leather ledger in the other. Distinguished, wealthy, sharp-eyed financier.`,
  },
  {
    name: 'ay',
    prompt: `${BASE_STYLE}. Wearing a black academic mortarboard and dark university robes with a gold chain of office, holding a thick audit report. Authoritative professor, experienced examiner, sharp scrutinising expression.`,
  },
  {
    name: 'jurry',
    prompt: `${BASE_STYLE}. Wearing a full traditional judge's white curled wig and flowing black judicial robes, holding a wooden gavel. Imposing, unsmiling, the weight of the law behind every glance.`,
  },
  {
    name: 'transy',
    prompt: `${BASE_STYLE}. Wearing a deep red turtleneck and a bold red plaid scarf, arms crossed, looking directly at you with a raised eyebrow and a no-nonsense expression. The goose who asks the hard questions.`,
  },
  {
    name: 'testy',
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
    name: 'docy',
    prompt: `${BASE_STYLE}. Wearing a crisp dark grey business suit with a tie, holding a golden ticket in one hand and a pen in the other. Authoritative, composed, professional gatekeeper.`,
  },
  {
    name: 'directory',
    prompt: `${BASE_STYLE}. Wearing a sharp navy-blue tailored suit with a crisp white shirt and a subtle compass-rose tie pin, holding a leather portfolio under one wing and a golden compass in the other. Distinguished, approachable, the visionary director who sees the big horizon — a goose you would call for a serious conversation.`,
  },
  {
    name: 'backy',
    prompt: `${BASE_STYLE}. Wearing a sturdy utility vest with multiple pockets stuffed with hard drives and USB sticks, holding a silver portable hard drive in one wing and pressing a large "BACKUP" button with the other. Dependable, prepared, the goose who makes sure nothing is ever lost.`,
  },
  {
    name: 'gitea',
    prompt: `${BASE_STYLE}. Wearing a dark olive server-admin hoodie with a small tea-cup logo on the chest, sitting at a miniature rack server with glowing LED lights, one wing resting on a mechanical keyboard. Calm, focused, the reliable keeper of all the code.`,
  },
  {
    name: 'gitty',
    prompt: `${BASE_STYLE}. Wearing a casual dark denim jacket covered in colourful git-branch sticker patches, holding a tablet showing a branching git graph in bright colours. Sharp, fast, always knows where every branch leads.`,
  },
  {
    name: 'humany',
    prompt: `${BASE_STYLE}. Wearing a smart coral-pink blazer with a "WELCOME" name badge pinned on, holding a golden onboarding folder in one wing and extending the other wing in a warm handshake greeting. Warm, professional, the goose every new recruit meets first.`,
  },
  {
    name: 'healthy',
    prompt: `${BASE_STYLE}. Healthy — server health monitor goose. Wearing a green paramedic vest with a red cross, holding a clipboard with vital signs chart, stethoscope around neck. Alert, dependable, always on watch.`,
  },
  {
    name: 'coachy',
    prompt: `${BASE_STYLE}. Wearing a warm golden-yellow sports coach jacket with a whistle on a lanyard, holding a clipboard with encouragement notes and a sparkly pom-pom in the other wing. Warm, radiant smile with eyes that genuinely care — the goose who believes in you and shows up exactly when you need motivation.`,
  },
  {
    name: 'gander',
    // TODO: replace outfit description with something role-specific
    prompt: `${BASE_STYLE}. Gander — V-formation agent. Wearing a neat professional outfit that fits their role.`,
  },
  {
    name: 'cssy',
    prompt: `${BASE_STYLE}. Wearing a sleek mint-green and teal technical outfit with glowing CSS variable symbols embroidered in gold, holding a colour palette in one wing with vibrant swatches arranged perfectly, a luminous design token in the other. Calm, precise, confident expression — the architect of beauty and order who makes everything work together.`,
  },
  {
    name: 'thinky',
    prompt: `${BASE_STYLE}. Wearing a dark charcoal turtleneck and round wire-rimmed philosopher's glasses, arms folded with one wing raised and a single raised eyebrow — the classic Socratic pose of someone about to ask a devastating question. Holding a simple worn notebook. Sharp, sceptical, and entirely unimpressed.`,
  },
  {
    name: 'creaty',
    prompt: `${BASE_STYLE}. Wearing a vibrant kaleidoscopic artist's smock splattered with bright rainbow paint colours, holding a glowing paintbrush in one wing and a magical lightbulb that looks like an idea in the other. Playful, curious expression with a mischievous sparkle in the eye — the creative goose who sees connections everywhere and says "yes, and..." to every idea.`,
  },
  {
    name: 'prompty',
    prompt: `${BASE_STYLE}. Wearing a crisp white shirt with rolled-up sleeves and a craftsman's apron covered in precisely arranged words and symbols, holding a glowing quill pen in one wing and a polished magnifying glass in the other. Expression: focused and precise, the artisan who chooses every word with intention.`,
  },
  {
    name: 'toddy',
    prompt: `${BASE_STYLE}. Wearing a cosy olive-green cardigan with a small checklist badge pinned on, holding a tall steaming mug of tea in one wing and a neat paper to-do list in the other with several items already ticked off. Relaxed, organised, quietly satisfied expression — the goose who gets things done without making a fuss.`,
  },
  {
    name: 'welcome',
    prompt: `${BASE_STYLE}. Wearing a cheerful orange welcome vest with a glowing golden name tag that reads "Welcome". Holding a small gift envelope with a lightning bolt symbol on it. Warm, friendly smile — the goose you'd want to meet first at any door.`,
  },
  {
    name: 'skeiny',
    prompt: `${BASE_STYLE}. Wearing a cozy knitted purple cardigan, gathering several colourful strands of yarn with one wing that weave together into a single neat thread, holding a small wall calendar with a tiny padlock charm clipped to it in the other wing. Gentle, organised, thoughtful expression — the goose who quietly weaves everyone's free moments into one shared time while keeping each calendar private.`,
  },
  {
    name: 'splitty',
    prompt: `${BASE_STYLE}. Wearing an emerald-green money-changer's eyeshade visor and a green leather coin-apron with rows of little pouches, cheerfully fanning out a spray of shiny gold Bitcoin coins from one wing so they split and fly off in several directions, a small brass balance scale balanced in the other wing. Generous, fair, beaming smile — the flock's treasurer goose who shares every sat that comes in equally with the whole flock.`,
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
    try { writeSquareIcons(dir, name); } catch (e) { console.log(`  ⚠️ icon-derive: ${e.message}`); }
    console.log(`✓  saved to agents/${name}/${name}.jpg (+ icon-192/512 from portrait)`);
  } catch (err) {
    console.log(`❌  ${err.message}`);
  }
}

console.log('\nDone. Run: bash /home/deploy/update-tiles.sh  (copies portraits to webroot + republishes homepage)');
