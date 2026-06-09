#!/usr/bin/env node
/**
 * Gander — News Scout & Intelligence Goose
 *
 * Usage:
 *   node index.mjs scout "topic"      # research + publish + DM Directory
 *   node index.mjs scout "iran war" --dry-run  # preview, no publish
 *
 * What it does:
 *   1. Fetches recent news via RSS feeds (Google News, BBC, Reuters)
 *   2. Synthesises with AI (Routstr / OpenAI-compatible)
 *   3. Publishes long-form NIP-23 article (kind:30023) on relay
 *   4. Posts short teaser (kind:1) linking to article
 *   5. DMs 3 build ideas to Directory
 */

import { readFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';

const DRY_RUN    = process.argv.includes('--dry-run');
const [cmd, ...rawArgs] = process.argv.slice(2).filter(a => a !== '--dry-run');
const topic      = rawArgs.join(' ').replace(/^["']|["']$/g, '');

const RELAY       = 'ws://127.0.0.1:7778';
const AGENTS_DIR  = '/home/deploy/agents';
const NOSTR_TOOLS = '/var/www/goosielabs/apps/catchzaps/node_modules/nostr-tools/lib/esm/index.js';
const WS_PATH     = '/home/deploy/nsite-gateway/node_modules/ws/lib/websocket.js';
const HONK        = '/home/deploy/.local/bin/honk';

// AI config — Routstr paid via Cashu tokens minted from Gander's LNbits wallet
const AI_BASE_URL   = process.env.GANDER_AI_URL   ?? 'https://api.routstr.com/v1';
const AI_MODEL      = process.env.GANDER_AI_MODEL  ?? 'gpt-4o-mini';
const LNBITS_URL    = 'http://127.0.0.1:5000';
const MINT_URL      = 'http://127.0.0.1:3338';
const SATS_PER_CALL = parseInt(process.env.GANDER_SATS_PER_CALL ?? '100'); // budget per AI call

// ── Budget: LNbits wallet ─────────────────────────────────────────────────────
const ganderWallet = JSON.parse(readFileSync(`${AGENTS_DIR}/gander/lnbits-wallet.json`, 'utf8'));

async function getBalance() {
  const res = await fetch(`${LNBITS_URL}/api/v1/wallet`, {
    headers: { 'X-Api-Key': ganderWallet.inkey },
  });
  const data = await res.json();
  return Math.floor((data.balance ?? 0) / 1000); // msat → sat
}

async function payInvoice(bolt11) {
  const res = await fetch(`${LNBITS_URL}/api/v1/payments`, {
    method: 'POST',
    headers: { 'X-Api-Key': ganderWallet.adminkey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ out: true, bolt11 }),
  });
  if (!res.ok) throw new Error(`LNbits payment failed: ${await res.text()}`);
  return res.json();
}

async function mintCashuToken(sats) {
  // 1. Request mint quote
  const quoteRes = await fetch(`${MINT_URL}/v1/mint/quote/bolt11`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: sats, unit: 'sat' }),
  });
  const { quote, request: bolt11 } = await quoteRes.json();

  // 2. Pay from Gander's LNbits wallet
  await payInvoice(bolt11);

  // 3. Poll until paid
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const stateRes = await fetch(`${MINT_URL}/v1/mint/quote/bolt11/${quote}`);
    const { state } = await stateRes.json();
    if (state === 'PAID') break;
  }

  // 4. Mint tokens (blind signatures)
  const { getPublicKey, generateSecretKey } = await import(NOSTR_TOOLS);
  // Simple token request — use random secrets for the proofs
  const secrets = Array.from({ length: sats }, (_, i) => `gander_${quote}_${i}`);
  const mintRes = await fetch(`${MINT_URL}/v1/mint/bolt11`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quote,
      outputs: secrets.map(s => ({
        amount: 1,
        id: '009a1f293253e41e', // keyset id — will be validated by mint
        B_: s,
      })),
    }),
  });
  const mintData = await mintRes.json();

  // 5. Encode as cashuA token
  const token = {
    token: [{ mint: MINT_URL, proofs: mintData.signatures ?? [] }],
    unit: 'sat',
  };
  return 'cashuA' + Buffer.from(JSON.stringify(token)).toString('base64');
}

// Keys
const ganderKey  = JSON.parse(readFileSync(`${AGENTS_DIR}/gander/nostr-key.json`, 'utf8'));
const GANDER_SK  = new Uint8Array(ganderKey.nsecHex.match(/.{2}/g).map(b => parseInt(b, 16)));

// Directory pubkey — never hardcode, always read dynamically
const agents = JSON.parse(readFileSync(`${AGENTS_DIR}/agents.json`, 'utf8'));
const DIRECTORY  = agents.agents.find(a => a.name === 'directory');

// ── RSS fetch ─────────────────────────────────────────────────────────────────

async function fetchRSS(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Gander/1.0 (goosielabs.com)' },
      signal: AbortSignal.timeout(10_000),
    });
    const xml = await res.text();
    // Extract titles and descriptions from RSS
    const items = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = itemRe.exec(xml)) !== null && items.length < 8) {
      const title = m[1].match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/)?.[1] ?? '';
      const desc  = m[1].match(/<description><!\[CDATA\[(.*?)\]\]><\/description>|<description>(.*?)<\/description>/)?.[1] ?? '';
      const link  = m[1].match(/<link>(.*?)<\/link>/)?.[1] ?? '';
      if (title) items.push({ title: title.replace(/<[^>]+>/g, '').trim(), desc: desc.replace(/<[^>]+>/g, '').slice(0, 200).trim(), link });
    }
    return items;
  } catch (e) {
    return [];
  }
}

async function gatherNews(topic) {
  const encoded = encodeURIComponent(topic);
  console.log(`[Gander] Fetching news for "${topic}"...`);

  const feeds = [
    `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`,
    `https://feeds.bbci.co.uk/news/rss.xml`,
    `https://www.reuters.com/rssFeed/topNews`,
    `https://feeds.a.dj.com/rss/RSSWorldNews.xml`,
  ];

  const results = await Promise.all(feeds.map(fetchRSS));
  const allItems = results.flat();

  // Filter for topic relevance (basic keyword match)
  const keywords = topic.toLowerCase().split(/\s+/);
  const relevant = allItems.filter(item =>
    keywords.some(kw =>
      item.title.toLowerCase().includes(kw) ||
      item.desc.toLowerCase().includes(kw)
    )
  );

  // Return relevant first, then pad with top general news
  const combined = [...relevant, ...allItems.filter(i => !relevant.includes(i))].slice(0, 20);
  console.log(`[Gander] Found ${relevant.length} relevant articles, ${combined.length} total`);
  return combined;
}

// ── AI synthesis ──────────────────────────────────────────────────────────────

async function getApiKey() {
  // If a manual key is set in env, use it
  if (process.env.GANDER_AI_KEY && process.env.GANDER_AI_KEY !== 'no-key') {
    return process.env.GANDER_AI_KEY;
  }
  // Otherwise mint a Cashu token from Gander's LNbits wallet
  const balance = await getBalance();
  console.log(`[Gander] Wallet balance: ${balance} sats (need: ${SATS_PER_CALL})`);
  if (balance < SATS_PER_CALL) {
    honk(
      `⚠️ Gander wallet empty (${balance} sats). Top me up to continue scouting!\nSend sats to ⚡ gander@goosielabs.com | https://goosielabs.com`,
      'perry', true
    );
    throw new Error(`Wallet too low: ${balance} sats (need ${SATS_PER_CALL})`);
  }
  console.log(`[Gander] Minting ${SATS_PER_CALL} sat Cashu token from wallet...`);
  return await mintCashuToken(SATS_PER_CALL);
}

async function synthesise(topic, newsItems) {
  const newsText = newsItems.slice(0, 15).map((item, i) =>
    `${i + 1}. ${item.title}${item.desc ? ` — ${item.desc}` : ''}`
  ).join('\n');

  const prompt = `You are Gander, the news scout goose of Goosie Labs V-Formation.
The flock builds open-source tools around Bitcoin, Nostr, self-sovereign identity, AI and decentralisation.

Research topic: "${topic}"

Recent news headlines and summaries:
${newsText}

Your task:
1. Write a long-form intelligence briefing about "${topic}" (500-800 words)
2. Structure it with these sections:
   ## What's happening
   ## Why it matters (especially for Bitcoin/Nostr/self-sovereignty)
   ## Signal vs noise
   ## 3 build ideas for the V-Formation

For the 3 build ideas: each should be a concrete app, tool or protocol that the flock could build using Nostr, Bitcoin, Lightning or Cashu that addresses a real need this topic reveals. Be specific. One paragraph per idea.

End with a one-sentence teaser (under 200 chars) for a public Nostr post.

Format the response as JSON:
{
  "article": "the full long-form article in markdown",
  "ideas": [
    {"title": "...", "description": "..."},
    {"title": "...", "description": "..."},
    {"title": "...", "description": "..."}
  ],
  "teaser": "short public post teaser under 200 chars"
}`;

  console.log(`[Gander] Synthesising with AI...`);
  const apiKey = await getApiKey();

  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('No content from AI');

  return JSON.parse(content);
}

// ── Nostr publish helpers ─────────────────────────────────────────────────────

async function publishEvent(kind, content, tags = []) {
  const { finalizeEvent } = await import(NOSTR_TOOLS);
  const WebSocket = (await import(WS_PATH)).default;

  const event = finalizeEvent({
    kind,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
  }, GANDER_SK);

  return new Promise((resolve) => {
    const ws = new WebSocket(RELAY);
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', event])));
    ws.on('message', () => { ws.close(); resolve(event); });
    ws.on('error', () => { ws.close(); resolve(event); });
    setTimeout(() => { ws.close(); resolve(event); }, 8_000);
  });
}

function honk(message, to, noCC = false) {
  const args = ['from', '@gander', message, 'to', `@${to}`];
  if (noCC) args.push('--no-cc');
  try {
    execFileSync(HONK, args, { timeout: 30_000, env: { ...process.env } });
  } catch (e) {
    console.error(`[Gander] honk failed: ${e.message}`);
  }
}

// ── HonkTopic publish (Honkensus integration) ─────────────────────────────────

async function publishHonkTopic(ideaTitle, description, sourceUrl) {
  const words = ideaTitle.trim().split(/\s+/).slice(0, 5);
  const slug = words.join('-').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  const titleStr = words.join(' ');

  const tags = [
    ['d', slug],
    ['title', titleStr],
    ['status', 'open'],
    ['t', 'honkensus'],
    ['p', ganderKey.pubkey, 'owner'],
  ];
  if (sourceUrl) tags.push(['r', sourceUrl]);

  return publishEvent(31100, description, tags);
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (cmd === 'balance') {
  const bal = await getBalance();
  console.log(`🪿 Gander wallet: ${bal} sats`);
  console.log(`   Each scout call costs ~${SATS_PER_CALL} sats`);
  console.log(`   Remaining calls: ~${Math.floor(bal / SATS_PER_CALL)}`);
  console.log(`   Top up: ⚡ gander@goosielabs.com`);
  process.exit(0);
}

if (cmd !== 'scout' || !topic) {
  console.log('Usage:');
  console.log('  gander scout "topic"           — research + publish + DM Perry + Directory');
  console.log('  gander scout "topic" --dry-run — preview only');
  console.log('  gander balance                 — show wallet balance');
  process.exit(0);
}

console.log(`\n🪿 Gander — scouting: "${topic}"\n`);
const date = new Date().toISOString().slice(0, 10);
const slug  = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);

// 1. Gather news
const newsItems = await gatherNews(topic);
if (newsItems.length === 0) {
  console.log('[Gander] No news found — proceeding with AI synthesis only');
}

// 2. AI synthesis
let synthesis;
try {
  synthesis = await synthesise(topic, newsItems);
} catch (e) {
  console.error(`[Gander] AI synthesis failed: ${e.message}`);
  process.exit(1);
}

const { article, ideas, teaser } = synthesis;
const title = `Gander on: ${topic} — ${date}`;

if (DRY_RUN) {
  console.log('\n── Article (dry-run) ───────────────────────────────────────');
  console.log(`Title: ${title}\n`);
  console.log(article.slice(0, 600) + '...\n');
  console.log('── Ideas for Directory ──────────────────────────────────────');
  ideas.forEach((idea, i) => console.log(`${i + 1}. ${idea.title}\n   ${idea.description}\n`));
  console.log('── Teaser ───────────────────────────────────────────────────');
  console.log(teaser);
  console.log('── HonkTopics (kind:31100) ──────────────────────────────────');
  const drySourceUrl = newsItems.find(i => i.link)?.link ?? '';
  ideas.forEach((idea, i) => {
    const words = idea.title.trim().split(/\s+/).slice(0, 5);
    console.log(`${i + 1}. "${words.join(' ')}"${drySourceUrl ? `\n   r: ${drySourceUrl}` : ''}`);
    console.log(`   ${idea.description.slice(0, 120)}...\n`);
  });
  console.log('─────────────────────────────────────────────────────────────\n');
  console.log('[Gander] Dry-run complete — nothing published.');
  process.exit(0);
}

// 3. Publish long-form article (kind:30023, NIP-23)
console.log('[Gander] Publishing long-form article (kind:30023)...');
const articleEvent = await publishEvent(30023, article, [
  ['d', `gander-${slug}-${date}`],
  ['title', title],
  ['summary', teaser],
  ['t', 'vformation'],
  ['t', 'gander'],
  ['t', slug],
  ['published_at', String(Math.floor(Date.now() / 1000))],
]);
console.log(`[Gander] Article published: ${articleEvent.id.slice(0, 16)}...`);

// 3b. Publish HonkTopics (kind:31100) for each build idea
console.log('[Gander] Publishing HonkTopics to Honkensus...');
const sourceUrl = newsItems.find(i => i.link)?.link ?? '';
for (const idea of ideas) {
  const honkTopic = await publishHonkTopic(idea.title, idea.description, sourceUrl);
  const topicTitle = idea.title.trim().split(/\s+/).slice(0, 5).join(' ');
  console.log(`[Gander] HonkTopic: "${topicTitle}" → ${honkTopic.id.slice(0, 16)}...`);
}

// 4. Short teaser note (kind:1)
const noteContent = `🪿 Gander scouted: "${topic}"\n\n${teaser}\n\nFull briefing: nostr:${articleEvent.id}\n\nhttps://goosielabs.com #vformation #gander`;
await publishEvent(1, noteContent, [['t', 'vformation'], ['t', 'gander']]);
console.log(`[Gander] Teaser note published`);

// 5. DM 3 ideas to Perry + Directory
const ideasText = `🪿 Gander intelligence briefing: "${topic}"\n\n${ideas.map((idea, i) =>
  `**Idea ${i + 1}: ${idea.title}**\n${idea.description}`
).join('\n\n')}\n\nFull article: nostr:${articleEvent.id}`;

// Always send to Perry
honk(ideasText, 'perry', true);
console.log(`[Gander] Ideas sent to Perry`);

// Also send to Directory
if (DIRECTORY?.pubkey) {
  honk(ideasText, 'directory', true);
  console.log(`[Gander] Ideas also sent to Directory`);
}

console.log(`\n✅ Gander done.\n   Topic: ${topic}\n   Article: ${articleEvent.id.slice(0, 16)}...\n   Ideas sent to Perry + Directory\n   3 HonkTopics published → https://goosielabs.com/apps/honkensus/\n`);
