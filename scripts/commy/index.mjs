#!/usr/bin/env node
/**
 * Commy — Community Engagement Goose
 *
 * Verzamelt verhalen uit git commits en goose-logs, en post er elke 3 blokken één
 * als publiek Nostr kind:1 event. Houdt een queue bij zodat er altijd iets te posten is.
 *
 * Gebruik:
 *   node index.mjs run           # Blocky: collect als queue laag + post één verhaal
 *   node index.mjs collect       # Bronnen scannen + queue vullen
 *   node index.mjs post          # Post volgend verhaal uit queue
 *   node index.mjs post "tekst"  # Publiceer vrije tekst direct
 *   node index.mjs check         # Toon queue-status zonder te posten
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { execSync } from 'child_process';

const DRY_RUN  = process.argv.includes('--dry-run');
const [cmd, ...cmdArgs] = process.argv.slice(2).filter(a => a !== '--dry-run');

const RELAY       = 'ws://127.0.0.1:7778';
const NOSTR_TOOLS = '/var/www/goosielabs/apps/skein/node_modules/nostr-tools/lib/esm/index.js';
const WS_PATH     = '/home/deploy/nsite-gateway/node_modules/ws/lib/websocket.js';
const APPS_DIR    = '/var/www/goosielabs/apps';
const LOGS_DIR    = '/home/deploy/logs';
const QUEUE_FILE  = '/home/deploy/scripts/commy/queue.json';
const KEY_FILE    = '/home/deploy/agents/commy/nostr-key.json';

// Queue vullen als er minder dan deze drempel ongeposte verhalen zijn
const QUEUE_MIN   = 6;
// Hoeveel verhalen we per collect-ronde genereren
const COLLECT_MAX = 10;
// Git commits hoe ver terug ophalen
const GIT_SINCE   = '72 hours ago';

// AI config — zelfde patroon als Gander
const AI_BASE_URL = process.env.OPENAI_API_URL   ?? process.env.GANDER_AI_URL ?? 'https://api.openai.com/v1';
const AI_MODEL    = process.env.GANDER_AI_MODEL   ?? 'gpt-4o-mini';
const AI_KEY      = process.env.OPENAI_API_KEY    ?? '';

// ── Keypair ────────────────────────────────────────────────────────────────
const keyData  = JSON.parse(readFileSync(KEY_FILE, 'utf8'));
const { nip19 } = await import(NOSTR_TOOLS);
const commyPriv = nip19.decode(keyData.nsec).data;

// ── Queue ─────────────────────────────────────────────────────────────────
function loadQueue() {
  if (!existsSync(QUEUE_FILE)) return { stories: [], last_collect_at: 0 };
  return JSON.parse(readFileSync(QUEUE_FILE, 'utf8'));
}

function saveQueue(q) {
  writeFileSync(QUEUE_FILE, JSON.stringify(q, null, 2));
}

function pendingStories(q) {
  return q.stories.filter(s => !s.posted_at);
}

// ── Git bronnen ───────────────────────────────────────────────────────────
const SKIP_PATTERNS = [
  /^backy: backup status/,
  /^feat: add lnbits_inkey/,
  /^docs: add CLAUDE\.md/,
  /^docs: add Doel/,
  /^Agent memory files/,
  /^Merge branch/,
  /^chore:/,
];

function collectGitCommits() {
  const apps = readdirSync(APPS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !existsSync(`${APPS_DIR}/${d.name}/.archived`))
    .map(d => d.name);

  const items = [];

  for (const app of apps) {
    const dir = `${APPS_DIR}/${app}`;
    if (!existsSync(`${dir}/.git`)) continue;

    let raw;
    try {
      raw = execSync(
        `git -C "${dir}" log --since="${GIT_SINCE}" --format="%s" 2>/dev/null`,
        { encoding: 'utf8', timeout: 5000 }
      ).trim();
    } catch { continue; }

    if (!raw) continue;

    const commits = raw.split('\n')
      .map(s => s.trim())
      .filter(s => s && !SKIP_PATTERNS.some(p => p.test(s)));

    if (commits.length > 0) {
      items.push({ app, commits });
    }
  }

  // Ook de hoofdrepo
  try {
    const raw = execSync(
      `git -C /home/deploy log --since="${GIT_SINCE}" --format="%s" 2>/dev/null`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    const commits = raw.split('\n')
      .map(s => s.trim())
      .filter(s => s && !SKIP_PATTERNS.some(p => p.test(s)));
    if (commits.length > 0) items.push({ app: 'goosie-labs (core)', commits });
  } catch { /* ignore */ }

  return items;
}

// ── Log bronnen ───────────────────────────────────────────────────────────
function collectGooseLogs() {
  const geese = ['healthy', 'secury', 'ay', 'jurry', 'blocky'];
  const events = [];

  for (const goose of geese) {
    const dir = `${LOGS_DIR}/${goose}`;
    if (!existsSync(dir)) continue;

    const files = readdirSync(dir)
      .filter(f => f.endsWith('.log'))
      .sort()
      .slice(-3); // laatste 3 logs

    for (const file of files) {
      try {
        const content = readFileSync(`${dir}/${file}`, 'utf8');
        // Pak alleen de interessante regels
        const lines = content.split('\n')
          .filter(l => /🟢|🔴|🟡|WARN|ERROR|alert|gevonden|found|geblokkeerd|blocked|kwetsbaarheid|vulnerabilit|kritiek|critical|DM|gepubliceerd/i.test(l))
          .slice(0, 5)
          .map(l => l.trim())
          .filter(Boolean);
        if (lines.length > 0) {
          events.push({ goose, file, lines });
        }
      } catch { /* ignore */ }
    }
  }

  return events;
}

// ── AI story generatie ────────────────────────────────────────────────────
async function generateStories(commits, logEvents) {
  if (!AI_KEY) {
    console.error('[commy] Geen AI key — gebruik OPENAI_API_KEY in ~/.bashrc.local');
    return [];
  }

  const commitSummary = commits
    .map(({ app, commits: cs }) => `${app}: ${cs.slice(0, 4).join(' | ')}`)
    .join('\n');

  const logSummary = logEvents
    .map(({ goose, lines }) => `${goose}: ${lines.join(' | ')}`)
    .join('\n');

  const hasData = commitSummary.trim() || logSummary.trim();
  if (!hasData) {
    console.log('[commy] Geen verse data gevonden om verhalen van te maken.');
    return [];
  }

  const prompt = `Je bent Commy, de community goose van Goosie Labs — een Bitcoin/Nostr app lab waar ganzen (AI-agents) samenwerken.

Schrijf ${COLLECT_MAX} korte, losse Nostr posts op basis van onderstaande recente activiteit. Spreek af en toe Perry (de maker) direct aan. Gebruik af en toe een gans-grap of Bitcoin/Nostr context. Houd elke post onder de 280 tekens. Wees gevarieerd: soms technisch, soms grappig, soms inspirerend. Geen hashtags behalve af en toe #nostr of #bitcoin.

Geef de posts terug als een JSON array van strings. Geen extra uitleg.

Recente commits:
${commitSummary || '(geen nieuwe commits)'}

Goose-activiteit:
${logSummary || '(geen bijzonderheden)'}`;

  try {
    const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.9,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`AI error ${res.status}: ${err.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? '';

    // Extraheer JSON array uit response
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('Geen JSON array in AI response');
    return JSON.parse(match[0]).filter(s => typeof s === 'string' && s.trim());
  } catch (e) {
    console.error('[commy] AI generatie mislukt:', e.message);
    return [];
  }
}

// ── Nostr publish ─────────────────────────────────────────────────────────
async function publishNote(content) {
  const { finalizeEvent } = await import(NOSTR_TOOLS);
  const WebSocket = (await import(WS_PATH)).default;

  const event = finalizeEvent({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content,
  }, commyPriv);

  if (DRY_RUN) {
    console.log('[commy] DRY RUN — zou posten:', content);
    return event.id;
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY);
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', event])));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      ws.close();
      if (msg[0] === 'OK' && msg[2]) resolve(event.id);
      else reject(new Error(msg[3] ?? 'relay rejected'));
    });
    ws.on('error', (e) => { ws.close(); reject(e); });
    setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 8000);
  });
}

// ── Commands ──────────────────────────────────────────────────────────────

async function cmdCollect() {
  console.log('[commy] Bronnen scannen...');
  const commits   = collectGitCommits();
  const logEvents = collectGooseLogs();

  console.log(`[commy] ${commits.length} apps met commits, ${logEvents.length} goose-events`);

  const stories = await generateStories(commits, logEvents);
  if (stories.length === 0) {
    console.log('[commy] Geen nieuwe verhalen gegenereerd.');
    return;
  }

  const q = loadQueue();
  const now = Math.floor(Date.now() / 1000);

  for (const text of stories) {
    q.stories.push({
      id: Math.random().toString(36).slice(2),
      text,
      created_at: now,
      posted_at: null,
    });
  }

  q.last_collect_at = now;
  saveQueue(q);
  console.log(`[commy] ${stories.length} verhalen toegevoegd. Queue: ${pendingStories(q).length} klaar.`);
}

async function cmdPost(freeText) {
  if (freeText) {
    console.log('[commy] Vrije tekst posten...');
    const id = await publishNote(freeText);
    console.log(`[commy] Gepubliceerd: ${id?.slice(0, 16)}...`);
    return;
  }

  const q = loadQueue();
  const pending = pendingStories(q);

  if (pending.length === 0) {
    console.log('[commy] Queue leeg — eerst collect uitvoeren.');
    return;
  }

  const story = pending[0];
  const id = await publishNote(story.text);

  story.posted_at = Math.floor(Date.now() / 1000);
  saveQueue(q);

  console.log(`[commy] Gepost (${pending.length - 1} resterend): ${id?.slice(0, 16)}...`);
  console.log(`[commy] "${story.text.slice(0, 80)}..."`);
}

async function cmdRun() {
  const q = loadQueue();
  const pending = pendingStories(q);

  console.log(`[commy] Queue: ${pending.length} verhalen klaar.`);

  if (pending.length < QUEUE_MIN) {
    console.log(`[commy] Queue laag (< ${QUEUE_MIN}) — collect uitvoeren...`);
    await cmdCollect();
  }

  await cmdPost();
}

function cmdCheck() {
  const q = loadQueue();
  const pending = pendingStories(q);
  const posted  = q.stories.filter(s => s.posted_at);
  const lastCollect = q.last_collect_at
    ? new Date(q.last_collect_at * 1000).toLocaleString('nl-NL')
    : 'nooit';

  console.log(`\n[commy] Queue status`);
  console.log(`  Klaar om te posten: ${pending.length}`);
  console.log(`  Al gepost:          ${posted.length}`);
  console.log(`  Laatste collect:    ${lastCollect}`);

  if (pending.length > 0) {
    console.log('\n  Volgende post:');
    console.log(`  "${pending[0].text}"`);
  }

  if (pending.length > 1) {
    console.log(`\n  Daarna (${pending.length - 1} meer):`);
    pending.slice(1, 4).forEach((s, i) => {
      console.log(`  ${i + 2}. "${s.text.slice(0, 80)}..."`);
    });
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
switch (cmd) {
  case 'run':     await cmdRun();                          break;
  case 'collect': await cmdCollect();                      break;
  case 'post':    await cmdPost(cmdArgs.join(' ') || null); break;
  case 'check':   cmdCheck();                              break;
  case 'traffic-pulse': await import('./traffic-pulse.mjs'); break; // daily private visitor-pulse DM to Perry
  case 'flock-traction': await import('./flock-traction.mjs'); break; // weekly Nostr-traction DM to Perry
  default:
    console.log('Gebruik: node index.mjs [run|collect|post|post "tekst"|check|traffic-pulse] [--dry-run]');
}
