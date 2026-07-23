#!/usr/bin/env node
/**
 * publish-homepage.mjs
 *
 * Publishes goosielabs.com as a decentralized nsite under Perry's Nostr key.
 *
 * Pages published:
 *   /index.html     — homepage (tiles + V-Formation, regenerated from tile.json)
 *   /mcp.html       — MCP article (EN, from scripts/pages/mcp_en.html)
 *   /bitcoin.html   — Bitcoin article (EN, generated from code)
 *
 * Usage:
 *   PERRY_NSEC=nsec1... node publish-homepage.mjs
 *   # or if stored in ~/.bashrc.local:
 *   source ~/.bashrc.local && node publish-homepage.mjs
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync } from 'fs';
import path from 'path';
import WebSocket from '/home/deploy/nsite-gateway/node_modules/ws/lib/websocket.js';

const {
  finalizeEvent,
  nip19,
} = await import('/var/www/goosielabs/apps/bookwriter/node_modules/nostr-tools/lib/esm/index.js');

// ── Config ───────────────────────────────────────────────────────────────────
const BLOSSOM    = 'http://127.0.0.1:3339';
const { INTERNAL_RELAY, PUBLISH_RELAYS: PUBLIC_RELAYS } = await import('./relay-config.mjs');
const RELAY      = INTERNAL_RELAY;
const NSITE_BASE = 'https://nsite.goosielabs.com';
const APPS_DIR   = '/var/www/goosielabs/apps';
const PAGES_DIR  = '/home/deploy/scripts/pages';
const KEYS_DIR   = '/home/deploy/agents';
const CLAUDE_DIR = '/home/deploy/.claude/agents';

// ── Get Perry's nsec ─────────────────────────────────────────────────────────
const PERRY_NSEC = process.env.PERRY_NSEC;
if (!PERRY_NSEC || !PERRY_NSEC.startsWith('nsec1')) {
  console.error('\x1b[31m✗\x1b[0m PERRY_NSEC not set or invalid.');
  console.error('  Run: bash /home/deploy/scripts/update-tiles.sh');
  process.exit(1);
}

const nsecBytes = nip19.decode(PERRY_NSEC).data;
const nsecHex   = Buffer.from(nsecBytes).toString('hex');
const pubkeyHex = await (async () => {
  const { getPublicKey } = await import('/var/www/goosielabs/apps/bookwriter/node_modules/nostr-tools/lib/esm/index.js');
  return getPublicKey(nsecBytes);
})();
const npub = nip19.npubEncode(pubkeyHex);

console.log(`\x1b[1m\n🪿 Publishing goosielabs.com to nsite\x1b[0m`);
console.log(`\x1b[36m→\x1b[0m  npub: ${npub}`);
console.log(`\x1b[36m→\x1b[0m  site: https://goosielabs.com (after nginx switch)\n`);

// ── Helpers ───────────────────────────────────────────────────────────────────
function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}
function base64url(str) {
  return Buffer.from(str).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function buildUploadAuth(nsecHex, sha256hex, filename) {
  const sk  = Buffer.from(nsecHex, 'hex');
  const now = Math.floor(Date.now() / 1000);
  return finalizeEvent({
    kind: 24242,
    created_at: now,
    tags: [['t','upload'],['x',sha256hex],['expiration',String(now+3600)]],
    content: `Upload ${filename}`,
  }, sk);
}

async function uploadToBlossom(buf, contentType, filename) {
  const hash = sha256(buf);
  const head = await fetch(`${BLOSSOM}/${hash}`, { method: 'HEAD' });
  if (head.ok) {
    console.log(`\x1b[36m→\x1b[0m  already on Blossom: ${filename} (${hash.slice(0,8)}…)`);
    return hash;
  }
  const auth = buildUploadAuth(nsecHex, hash, filename);
  const res  = await fetch(`${BLOSSOM}/upload`, {
    method: 'PUT',
    headers: {
      'Authorization': `Nostr ${base64url(JSON.stringify(auth))}`,
      'Content-Type': contentType,
      'Content-Length': String(buf.length),
      'X-SHA-256': hash,
    },
    body: buf,
  });
  if (!res.ok) throw new Error(`Blossom ${res.status}: ${await res.text()}`);
  console.log(`\x1b[32m✓\x1b[0m  uploaded: ${filename} (${(buf.length/1024).toFixed(1)}KB, ${hash.slice(0,8)}…)`);
  return hash;
}

function publishToRelay(ev, relayUrl) {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(relayUrl);
      const t  = setTimeout(() => { ws.terminate(); resolve({ url: relayUrl, ok: false, err: 'timeout' }); }, 8000);
      ws.on('open', () => ws.send(JSON.stringify(['EVENT', ev])));
      ws.on('message', raw => {
        const m = JSON.parse(raw.toString());
        if (m[0] === 'OK') { clearTimeout(t); ws.close(); resolve({ url: relayUrl, ok: m[2], err: m[3] }); }
      });
      ws.on('error', e => { clearTimeout(t); resolve({ url: relayUrl, ok: false, err: e.message }); });
    } catch (e) {
      resolve({ url: relayUrl, ok: false, err: e.message });
    }
  });
}

async function publishManifest(nsecHex, pubkey, files) {
  const sk   = Buffer.from(nsecHex, 'hex');
  const tags = Object.entries(files).map(([p, h]) => ['path', p, h]);
  const ev   = finalizeEvent({ kind:15128, created_at:Math.floor(Date.now()/1000), tags, content:'' }, sk);

  // Always publish to internal relay first (required for local nsite gateway)
  const internal = await publishToRelay(ev, RELAY);
  if (!internal.ok) throw new Error(`Internal relay rejected manifest: ${internal.err}`);

  // Also publish to public relays so external nsite servers can serve the site
  const pubResults = await Promise.all(PUBLIC_RELAYS.map(r => publishToRelay(ev, r)));
  const okCount = pubResults.filter(r => r.ok).length;
  console.log(`\x1b[36m→\x1b[0m  Public relays: ${okCount}/${PUBLIC_RELAYS.length} accepted manifest`);
  pubResults.filter(r => !r.ok).forEach(r => console.log(`  ⚠️  ${r.url}: ${r.err}`));

  return ev;
}

// ── Shared nav + shell wrapper ────────────────────────────────────────────────
function shell(title, bodyHtml, lang='nl', activePage='') {
  const navLinks = [
    { href: './',           label: 'Home',    key: 'home' },
    { href: '/creators.html',  label: 'Creators',   key: 'creators' },
  ];
  const nav = navLinks.map(l =>
    `<a href="${l.href}" class="nav-link${activePage===l.key?' nav-link-active':''}">${l.label}</a>`
  ).join('\n      ');

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Goosie Labs</title>
  <link rel="icon" type="image/svg+xml" href="/goosie-favicon.svg">
  <link rel="icon" href="/favicon.ico" type="image/x-icon">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
    :root {
      --blue-50:#E6F1FB; --blue-100:#B5D4F4; --blue-200:#85B7EB;
      --blue-400:#378ADD; --blue-600:#185FA5; --blue-800:#0C447C; --blue-900:#042C53;
      --gray-50:#F8F8F6; --gray-100:#EDEDEA; --gray-200:#D3D1C7;
      --gray-400:#888780; --gray-600:#5F5E5A; --gray-800:#2C2C2A; --white:#FFFFFF;
      --font-display:'Libre Baskerville',Georgia,serif;
      --font-body:'DM Sans',system-ui,sans-serif;
    }
    body { font-family:var(--font-body); background:var(--white); color:var(--gray-800); font-size:16px; line-height:1.7; -webkit-font-smoothing:antialiased; }
    nav { position:sticky; top:0; z-index:100; background:rgba(255,255,255,0.96); backdrop-filter:blur(8px); border-bottom:1px solid var(--gray-100); }
    .nav-inner { max-width:1400px; margin:0 auto; padding:0 2rem; height:64px; display:flex; align-items:center; justify-content:space-between; }
    .nav-logo { font-family:var(--font-display); font-size:18px; color:var(--blue-800); letter-spacing:-0.02em; cursor:default; display:inline-flex; align-items:center; gap:10px; }
    .nav-logo img { height:40px; width:auto; }
    @media (max-width:600px) { .nav-logo img { height:32px; } }
    .nav-links { display:flex; gap:2rem; }
    .nav-link { font-size:14px; font-weight:500; color:var(--gray-600); text-decoration:none; transition:color 0.2s; }
    .nav-link:hover, .nav-link-active { color:var(--blue-600); }
    .page-content { max-width:1400px; margin:0 auto; padding:3rem 2rem 6rem; }
    footer { border-top:1px solid var(--gray-100); padding:2rem; text-align:center; font-size:0.8rem; color:var(--gray-400); }
    footer a { color:var(--gray-400); }
    .nsite-badge { display:inline-block; background:#1e1b4b; color:#818cf8; border:1px solid #312e81; border-radius:9999px; padding:1px 8px; font-size:0.65rem; font-weight:700; margin-left:0.5rem; vertical-align:middle; }
  </style>
</head>
<body>
  <nav>
    <div class="nav-inner">
      <span class="nav-logo"><img src="/goosie-mark.svg" alt="" aria-hidden="true" width="40" height="40">Goosie Labs</span>
      <div class="nav-links">
      ${nav}
      </div>
    </div>
  </nav>
  ${bodyHtml}
  <footer>
    <a href="https://goosielabs.com">goosielabs.com</a> ·
    <a href="https://nsite.goosielabs.com">nsite</a>
    <span class="nsite-badge">nsite</span> ·
    <a href="nostr:perry@goosielabs.com">Nostr DM</a> ·
    <a href="lightning:perry@goosielabs.com">⚡ perry@goosielabs.com</a> ·
    <a href="https://goosielabs.com/creators.html">About the creators</a>
  </footer>
</body>
</html>`;
}

// ── Homepage generator (from tile.json + nostr keys) ─────────────────────────
async function generateHomepage() {
  const STATUS_LABELS  = { live:'Live', 'in-bouw':'In progress', experiment:'Experiment', archief:'Archive' };
  const STATUS_CLASSES = { live:'badge-live', 'in-bouw':'badge-building', experiment:'badge-experiment', archief:'badge-idea' };
  const AGENT_COLORS   = { assistenty:'#6366f1', devy:'#0ea5e9', finny:'#10b981', ay:'#f59e0b', jurry:'#8b5cf6', secury:'#ef4444', testy:'#ec4899', commy:'#f97316', designy:'#a855f7', nosty:'#06b6d4', admitty:'#64748b', transy:'#e11d48', healthy:'#22c55e', backy:'#1e40af', coachy:'#d97706' , gander:'#374151' , cssy:'#374151' , thinky:'#374151' , creaty:'#374151'  , toddy:'#374151'  , welcome:'#374151'  , splitty:'#374151'  };

  // Read AGENT_ORDER from agents.json — all geese are included automatically
  let AGENT_ORDER = [];
  try {
    const agentsJson = JSON.parse(readFileSync('/home/deploy/agents/agents.json', 'utf8'));
    if (agentsJson.agents && Array.isArray(agentsJson.agents)) {
      AGENT_ORDER = agentsJson.agents.map(a => a.name);
    }
  } catch (e) {
    console.warn('Could not read agents.json, falling back to empty order');
  }

  // Read tiles from tile.json directly
  const tiles = [];
  try {
    for (const entry of readdirSync(APPS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const appDir    = path.join(APPS_DIR, entry.name);
      const tileFile  = path.join(appDir, 'tile.json');
      const archived  = path.join(appDir, '.archived');
      if (!existsSync(tileFile) || existsSync(archived)) continue;
      try {
        const d = JSON.parse(readFileSync(tileFile, 'utf8'));
        if (d.visible === false) continue;
        tiles.push(d);
      } catch {}
    }
  } catch {}
  tiles.sort((a, b) => (a.order ?? 50) - (b.order ?? 50));

  // Read agents from nostr-key.json + .md descriptions
  const agents = [];
  try {
    for (const name of readdirSync(KEYS_DIR)) {
      const keyFile = path.join(KEYS_DIR, name, 'nostr-key.json');
      if (!existsSync(keyFile)) continue;
      try {
        const key = JSON.parse(readFileSync(keyFile, 'utf8'));
        if (!key.npub) continue;
        let description = '';
        let quote = '';
        const mdFile = path.join(CLAUDE_DIR, `${name}.md`);
        if (existsSync(mdFile)) {
          const src = readFileSync(mdFile, 'utf8');
          const m = src.match(/^description:\s*(.+)$/m);
          if (m) description = m[1].trim().replace(/^['"]|['"]$/g, '');
          const q = src.match(/^quote:\s*(.+)$/m);
          if (q) quote = q[1].trim().replace(/^['"]|['"]$/g, '');
        }
        // Read LNbits wallet info for balance display (inkey = read-only, safe to expose)
        let inkey = '', walletId = '';
        const walletFile = path.join(KEYS_DIR, name, 'lnbits-wallet.json');
        if (existsSync(walletFile)) {
          try {
            const w = JSON.parse(readFileSync(walletFile, 'utf8'));
            inkey    = w.inkey    ?? '';
            walletId = w.wallet_id ?? '';
          } catch {}
        }
        agents.push({ name, npub: key.npub, pubkey: key.pubkey || '', description, quote, blockbirth: key.blockbirth || null, inkey, walletId });
      } catch {}
    }
  } catch {}
  // Sort agents by AGENT_ORDER (which comes from agents.json) — all agents are included automatically
  agents.sort((a, b) => {
    const ai = AGENT_ORDER.indexOf(a.name), bi = AGENT_ORDER.indexOf(b.name);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  // Check which agents have a published nsite
  await Promise.all(agents.map(async a => {
    try {
      const res = await fetch(`http://127.0.0.1:3340/${a.npub}/index.html`, { method: 'HEAD', signal: AbortSignal.timeout(2000) });
      a.hasNsite = res.ok;
    } catch { a.hasNsite = false; }
  }));

  // Generate tile cards HTML — agent-card style: large icon left, info right
  const tilesHtml = tiles.map(t => {
    const status   = t.status ?? 'experiment';
    const label    = STATUS_LABELS[status] ?? status;
    const cssClass = STATUS_CLASSES[status] ?? 'badge-idea';
    const links = [];
    const isStart = t.url === 'https://start.goosielabs.com';
    if (t.url) links.push(`<a href="${t.url}" class="project-link">${isStart ? 'Start here' : 'Open app'}</a>`);
    if (t.github) links.push(`<a href="${t.github}" class="project-link project-link-github" target="_blank" rel="noopener" aria-label="GitHub" title="GitHub"></a>`);
    if (t.juridischadvies) links.push(`<a href="${t.juridischadvies}" class="project-link project-link-juridisch" target="_blank" rel="noopener">${isStart ? 'More background' : 'Legal review'}</a>`);
    if (t.lnbits_inkey) links.push(`<button class="project-link project-link-donate" onclick="openDonate(this)" data-inkey="${t.lnbits_inkey}" data-lnaddr="${t.donation_lnaddress ?? ''}" data-app="${t.title ?? ''}">⚡ Donate</button>`);
    const linksHtml = links.length ? `<div class="project-links">${links.join('\n          ')}</div>` : '';
    const bg = t.icon_bg ?? '#6366f1';
    const iconHtml = t.icon
      ? `<div class="project-avatar" style="background:${bg}"><img src="${t.icon}" alt="${t.title ?? ''}" width="72" height="72"></div>`
      : `<div class="project-avatar" style="background:${bg}">🪿</div>`;
    const desc = isStart ? (t.description ?? '') : ((t.description ?? '').length > 100 ? (t.description ?? '').slice(0, 100) + '…' : (t.description ?? ''));
    return `      <div class="project-card">
        ${iconHtml}
        <div class="project-info">
          <div class="project-card-top">
            <div class="project-name">${t.title ?? ''}</div>
            <span class="badge ${cssClass}">${label}</span>
          </div>
          <p class="project-desc">${desc}</p>
          ${linksHtml}
        </div>
      </div>`;
  }).join('\n\n');

  // Sync agent portrait images to webroot so they're URL-accessible
  const WEBROOT_AGENTS = '/var/www/goosielabs/agents';

  // Generate agent cards HTML
  const agentCards = agents.map(a => {
    const color    = AGENT_COLORS[a.name] ?? '#6366f1';
    const nsiteUrl = `https://nsite.goosielabs.com/${a.npub}/`;
    const title    = a.name.charAt(0).toUpperCase() + a.name.slice(1);
    const tileText = a.quote || (a.description.length > 120 ? a.description.slice(0, 120) + '…' : a.description);

    // Use .png portrait (transparent bg) → .jpg portrait → icon-192.png → 🪿 emoji fallback
    const pngSrc  = `${KEYS_DIR}/${a.name}/${a.name}.png`;
    const jpgSrc  = `${KEYS_DIR}/${a.name}/${a.name}.jpg`;
    const iconSrc = `${KEYS_DIR}/${a.name}/icon-192.png`;
    const destDir = `${WEBROOT_AGENTS}/${a.name}`;
    let avatar;
    if (existsSync(pngSrc)) {
      mkdirSync(destDir, { recursive: true });
      copyFileSync(pngSrc, `${destDir}/${a.name}.png`);
      avatar = `<div class="agent-avatar"><img src="/agents/${a.name}/${a.name}.png" alt="${title}"></div>`;
    } else if (existsSync(jpgSrc)) {
      mkdirSync(destDir, { recursive: true });
      copyFileSync(jpgSrc, `${destDir}/${a.name}.jpg`);
      avatar = `<div class="agent-avatar"><img src="/agents/${a.name}/${a.name}.jpg" alt="${title}"></div>`;
    } else if (existsSync(iconSrc)) {
      mkdirSync(destDir, { recursive: true });
      copyFileSync(iconSrc, `${destDir}/icon-192.png`);
      avatar = `<div class="agent-avatar"><img src="/agents/${a.name}/icon-192.png" alt="${title}"></div>`;
    } else {
      avatar = `<div class="agent-avatar" style="background:${color}">🪿</div>`;
    }

    const promptLink = a.hasNsite
      ? `\n        <div class="agent-links"><a href="${nsiteUrl}" class="agent-link" target="_blank" rel="noopener"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="7" y1="9" x2="17" y2="9"/><line x1="7" y1="13" x2="17" y2="13"/><line x1="7" y1="17" x2="13" y2="17"/></svg></a></div>`
      : '';
    const birthLine = a.blockbirth
      ? `<div class="agent-birth" style="font-size:0.72rem;color:#888780;margin-top:0.4rem">⛏ #${a.blockbirth.toLocaleString('en')} · Age <span class="goose-age">…</span> blocks</div>`
      : '';
    const walletLine = a.inkey
      ? `<div class="agent-wallet" data-inkey="${a.inkey}" data-walletid="${a.walletId}">
          <span class="agent-balance">⚡ <span class="balance-sats">…</span> sats</span>
          <a href="lightning:${a.name}@goosielabs.com" class="agent-donate" title="Donate sats to ${title}">donate</a>
         </div>`
      : '';
    const inner = `
        ${avatar}
        <div class="agent-info">
          <div class="agent-name">${title}</div>
          <div class="agent-desc">${tileText}</div>
          ${birthLine}
          ${walletLine}
        </div>${promptLink}`;
    return `      <div class="agent-card" data-blockbirth="${a.blockbirth || ''}">${inner}\n      </div>`;
  });

  // Use WP export as base (carries full CSS + layout), then patch all Dutch text
  let html = readFileSync(`${PAGES_DIR}/homepage_base.html`, 'utf8');

  // lang + fix double-quote bugs
  html = html.replace('lang="nl"', 'lang="en"');
  // Remove link behaviour from nav-logo CSS
  html = html.replace('.nav-logo { font-family:var(--font-display); font-size:18px; color:var(--blue-800); text-decoration:none; letter-spacing:-0.02em; }',
    '.nav-logo { font-family:var(--font-display); font-size:18px; color:var(--blue-800); letter-spacing:-0.02em; cursor:default; }');


  // Nav: make logo non-clickable, remove unwanted links, translate labels
  html = html.replace(/<a href="[^"]*" class="nav-logo">([\s\S]*?)<\/a>/,
    '<span class="nav-logo">$1</span>');
  html = html.replace(/<a href="\/inloggen\/"[^>]*>.*?<\/a>/g, '');
  html = html.replace(/<a href="\/en\/"[^>]*>[^<]*<\/a>/g, '');
  html = html.replace(/<a href="#meedoen"[^>]*>Meedoen<\/a>/g, '');
  html = html.replace(/<a href="https:\/\/goosielabs\.com\/apps\/"[^>]*>Apps<\/a>/g, '');
  html = html.replace(/>Projecten<\/a>/, '>Projects</a>');
  html = html.replace(/>Het AI Ganzen Team<\/a>/, '>The AI Geese Team</a>');
  html = html.replace(/href="\/contact\/"/, 'href="/creators.html"');
  html = html.replace(/<a href="#projecten"/g, '<a href="#projects"');
  html = html.replace(/id="projecten"/g, 'id="projects"');

  // Hero
  html = html.replace(
    '<h1>Een open lab voor Bitcoin, Nostr en AI</h1>',
    '<h1>Exploring what decentralized tech can do!</h1>\n    <p class="hero-sub">Who really owns your Instagram account, your PayPal balance, your followers? Not you. Here you can feel what it&rsquo;s like when you do.</p>'
  );
  html = html.replace(
    /Ganzen vliegen in V-formatie[^<]+/,
    'Goosie Labs builds working prototypes with Bitcoin, Nostr, and AI — the kind of tech that removes intermediaries and actually works for regular people. Everything here is open, experimental, and free to build on. We also measure time differently: it is currently block <span id="blocky-block" style="font-weight:600;font-variant-numeric:tabular-nums">…</span>.'
  );
  html = html.replace(
    'Dit is geen product. Dit is een lab. Alles hier is in ontwikkeling — gebruik het, bouw erop verder, of neem contact op.',
    ''
  );
  // Hero CTAs — two buttons: View experiments (primary) / Fly along?
  // (the newcomer card's [Start here] is now the single newcomer entrance — we no
  // longer promise "own 3 things" in-page, since that flow no longer delivers it)
  html = html.replace(
    /<div class="hero-cta">[\s\S]*?<\/div>/,
    `<div class="hero-cta">
      <a href="#projects" class="btn-primary">View experiments</a>
      <a href="#meedoen" class="btn-ghost">Fly along?</a>
    </div>`
  );

  // Projects section headings
  html = html.replace(/>Experimenten<\/div>/, '>Experiments</div>');
  html = html.replace(/>Wat er vliegt<\/h2>/, ">What's flying</h2>");
  html = html.replace(
    '>Experimenten in verschillende stadia — van idee tot werkend prototype<',
    '>Experiments in various stages — from idea to working prototype<'
  );

  // Regenerate tiles between markers from live tile.json data
  const tilesReplacement = `<!-- APPS-TILES-START -->\n${tilesHtml}\n      <!-- APPS-TILES-END -->`;
  html = html.replace(/<!-- APPS-TILES-START -->[\s\S]*?<!-- APPS-TILES-END -->/, tilesReplacement);

  // Write tiles back to homepage_base.html so the file stays in sync with published content
  const baseHtml = readFileSync(`${PAGES_DIR}/homepage_base.html`, 'utf8');
  writeFileSync(
    `${PAGES_DIR}/homepage_base.html`,
    baseHtml.replace(/<!-- APPS-TILES-START -->[\s\S]*?<!-- APPS-TILES-END -->/, tilesReplacement),
    'utf8'
  );

  // ── Geese live feed — inject before V-Formation section ─────────────────────
  // Relay requires hex pubkeys in authors filter — npubs are silently ignored
  const goosePubkeys = agents.filter(a => a.pubkey).map(a => a.pubkey);
  const gooseNames   = Object.fromEntries(agents.filter(a => a.pubkey).map(a => [a.pubkey, a.name.charAt(0).toUpperCase() + a.name.slice(1)]));
  const gooseAvatars = Object.fromEntries(agents.filter(a => a.pubkey).map(a => [a.pubkey, `/agents/${a.name}/${a.name}.jpg`]));
  const gooseColors  = Object.fromEntries(agents.filter(a => a.pubkey).map(a => [a.pubkey, AGENT_COLORS[a.name] ?? '#6366f1']));

  const geeseFeedHtml = `
<section class="geese-live" id="geese-live">
  <style>
    .geese-live { padding:4rem 2rem; background:#fff; border-top:1px solid #f0f0ec; }
    .geese-live-inner { max-width:1400px; margin:0 auto; display:grid; grid-template-columns:1fr 2fr; gap:4rem; align-items:start; }
    @media(max-width:720px){ .geese-live-inner { grid-template-columns:1fr; gap:2rem; } }
    .geese-live-label { font-size:0.72rem; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; color:#378add; margin-bottom:0.75rem; }
    .geese-live-title { font-size:1.75rem; font-weight:700; line-height:1.2; color:#0a0a08; margin-bottom:1rem; }
    .geese-live-sub { font-size:0.9rem; color:#6b6b64; line-height:1.6; }
    .geese-feed { display:flex; flex-direction:column; gap:0; max-height:480px; overflow-y:auto; border:1px solid #e8e8e4; border-radius:0.75rem; background:#fafaf8; scroll-behavior:smooth; }
    .geese-feed::-webkit-scrollbar { width:4px; } .geese-feed::-webkit-scrollbar-thumb { background:#d0d0c8; border-radius:2px; }
    .geese-post { display:flex; gap:0.75rem; padding:0.875rem 1rem; border-bottom:1px solid #f0f0ec; animation:feedIn 0.3s ease; }
    .geese-post:last-child { border-bottom:none; }
    @keyframes feedIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }
    .geese-post-avatar { width:32px; height:32px; border-radius:50%; flex-shrink:0; object-fit:cover; }
    .geese-post-avatar-fallback { width:32px; height:32px; border-radius:50%; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:0.9rem; color:white; font-weight:600; }
    .geese-post-body { flex:1; min-width:0; }
    .geese-post-meta { display:flex; align-items:center; gap:0.5rem; margin-bottom:0.2rem; }
    .geese-post-name { font-size:0.78rem; font-weight:600; color:#0a0a08; }
    .geese-post-time { font-size:0.7rem; color:#9b9b93; }
    .geese-post-content { font-size:0.82rem; color:#3c3c38; line-height:1.5; word-break:break-word; }
    .geese-feed-empty { padding:2rem; text-align:center; color:#9b9b93; font-size:0.85rem; }
    .geese-feed-dot { display:inline-block; width:6px; height:6px; background:#22c55e; border-radius:50%; margin-right:6px; animation:pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  </style>
  <div class="geese-live-inner">
    <div class="geese-live-left">
      <div class="geese-live-label"><span class="geese-feed-dot"></span>Live</div>
      <h2 class="geese-live-title">What are the geese doing?</h2>
      <p class="geese-live-sub">The V-Formation is always in motion. These are the latest public updates from the flock — health checks, block announcements, security reports, and whatever else honks.</p>
    </div>
    <div class="geese-feed" id="geese-feed">
      <div class="geese-feed-empty">Connecting to relay…</div>
    </div>
  </div>
  <script>
  window.GEESE_DATA=${JSON.stringify({ pubkeys: goosePubkeys, names: gooseNames, avatars: gooseAvatars, colors: gooseColors })};
  </script>
  <script src="/geese-feed.js?v=${Date.now()}" defer></script>
  <script src="/donate.js?v=${Date.now()}" defer></script>
  <!-- inline script intentionally minimal — logic lives in /geese-feed.js -->
</section>
`;

  html = html.replace('<section class="formation"', geeseFeedHtml + '\n<section class="formation"');

  // V-Formation section
  html = html.replace('>V-Formatie<', '>V-Formation<');
  html = html.replace(/>Het team</, '>The team<');
  html = html.replace(
    '>AI-ganzen met elk een eigen identiteit op Nostr — klik om hun rol en instructies te lezen.<',
    '>AI geese each with their own Nostr identity — click to read their role and instructions.<'
  );
  // Perry's founder card — second, right after Splitty
  const perryCard = `      <div class="agent-card agent-card-founder" data-blockbirth="360285">
        <div class="agent-avatar"><img src="/perry/perry-goose.png" alt="Perry"></div>
        <div class="agent-info">
          <div class="agent-name">Perry</div>
          <div class="agent-desc">Founder &amp; Lead Goose — builder at the intersection of Bitcoin, Nostr and AI.</div>
          <div class="agent-birth" style="font-size:0.72rem;color:#888780;margin-top:0.4rem">⛏ #360,285 · Age <span class="goose-age">…</span> blocks</div>
          <div class="agent-wallet" data-inkey="02b25e836ae5480eb087b93f6b3ab41a" data-walletid="c9ac4e7c136e4fa49e8ee2b7471382e2" style="margin-top:0.35rem">
            <span class="agent-balance">⚡ <span class="balance-sats">…</span> sats</span>
          </div>
        </div>
        <div class="agent-links"><a href="/creators.html" class="agent-link" target="_blank" rel="noopener"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="7" y1="9" x2="17" y2="9"/><line x1="7" y1="13" x2="17" y2="13"/><line x1="7" y1="17" x2="13" y2="17"/></svg></a></div>
      </div>`;

  // Order the V-Formation: Splitty's tile top-left, Perry second, then the rest
  const splittyIdx = agents.findIndex(a => a.name === 'splitty');
  const orderedCards = [];
  if (splittyIdx !== -1) orderedCards.push(agentCards[splittyIdx]);
  orderedCards.push(perryCard);
  agents.forEach((a, i) => { if (i !== splittyIdx) orderedCards.push(agentCards[i]); });

  // Regenerate agent cards
  html = html.replace(
    /<!-- AGENTS-TILES-START -->[\s\S]*?<!-- AGENTS-TILES-END -->/,
    `<!-- AGENTS-TILES-START -->\n${orderedCards.join('\n')}\n<!-- AGENTS-TILES-END -->`
  );

  // Join / contact section
  html = html.replace(/<h2>Mee vliegen\?<\/h2>/, '<h2>Fly along?</h2>');
  html = html.replace(
    'Zie je een experiment dat je wil afmaken? Een idee dat aansluit? Of wil je gewoon weten hoe iets werkt? Stuur een Nostr DM of een Lightning zap — beide zijn welkom.',
    'See an experiment you want to finish? An idea that fits? Or just want to know how something works? Send a Nostr DM or a Lightning zap — both are welcome.'
  );

  // Footer
  html = html.replace('open experimenten in Bitcoin, Nostr en AI', 'open experiments in Bitcoin, Nostr and AI');
  html = html.replace('Alles hier mag worden hergebruikt.', 'Everything here is free to reuse.');

  // Project card redesign: agent-card style with large icon left, info right
  html = html.replace(
    '.project-card { background:var(--white); border:1px solid var(--gray-100); border-radius:16px; padding:1.75rem; display:flex; flex-direction:column; gap:0.75rem; transition:box-shadow 0.2s, transform 0.2s; }',
    '.project-card { background:var(--white); border:1px solid var(--gray-100); border-radius:12px; padding:0.875rem 1rem; display:flex; flex-direction:row; align-items:flex-start; gap:0.875rem; transition:border-color 0.15s, box-shadow 0.15s; }'
  );
  html = html.replace(
    '.project-card:hover { box-shadow:0 8px 32px rgba(12,68,124,0.1); transform:translateY(-2px); }',
    '.project-card:hover { border-color:#c8dff6; box-shadow:0 2px 12px rgba(12,68,124,0.08); }'
  );
  html = html.replace(
    '.project-card-top { display:flex; justify-content:space-between; align-items:flex-start; }',
    '.project-card-top { display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem; } .project-info { flex:1; min-width:0; display:flex; flex-direction:column; gap:0.3rem; } .project-avatar { width:72px; height:72px; border-radius:14px; flex-shrink:0; display:flex; align-items:center; justify-content:center; overflow:hidden; font-size:2rem; } .project-avatar img { width:100%; height:100%; object-fit:contain; display:block; }'
  );
  html = html.replace(
    '.project-name { font-family:var(--font-display); font-size:1.1rem; font-weight:700; color:var(--blue-900); }',
    '.project-name { font-family:var(--font-display); font-size:1rem; font-weight:700; color:var(--blue-900); }'
  );
  html = html.replace(
    '.project-desc { font-size:0.92rem; line-height:1.65; color:var(--gray-600); flex:1; }',
    '.project-desc { font-size:0.82rem; line-height:1.5; color:var(--gray-600); margin:0; }'
  );
  html = html.replace(
    '.project-links { display:flex; gap:1.25rem; margin-top:0.5rem; flex-wrap:wrap; align-items:center; }',
    '.project-links { display:flex; gap:0.75rem; margin-top:0.35rem; flex-wrap:wrap; align-items:center; }'
  );

  // Wallet balance CSS + JS — fetches balances live from LNbits
  html = html.replace('</style>\n    <div class="agents-grid">', `</style>
    <style>
      .agent-wallet { display:flex; align-items:center; gap:0.5rem; margin-top:0.35rem; }
      .agent-balance { font-size:0.7rem; color:#f7931a; font-weight:600; }
      .agent-donate { font-size:0.65rem; color:#378add; text-decoration:none; border:1px solid #b5d4f4; border-radius:4px; padding:1px 6px; transition:background 0.15s; }
      .agent-donate:hover { background:#e6f1fb; }
    </style>
    <div class="agents-grid">`);

  html = html.replace(/<\/body>/, `<script src="/qr.js" defer></script><script src="/goose-balances.js" defer></script><script src="/blocky-block.js" defer></script>\n</body>`);

  // nsite marker
  html = html.replace(
    /<\/body>/,
    `<script>document.documentElement.dataset.nsite='${npub.slice(0,20)}…';</script>\n</body>`
  );

  return html;
}

// ── Contact page (NL) — strip form, keep info ────────────────────────────────
function generateContactNl() {
  const fragment = readFileSync(`${PAGES_DIR}/contact_nl.html`, 'utf8');
  // Remove WPForms form block
  const cleaned = fragment
    .replace(/<!-- wp:html -->/g, '')
    .replace(/<form[\s\S]*?<\/form>/gi, `
      <div class="contact-nostr">
        <p>Stuur een DM op Nostr of een Lightning zap. We bellen terug.</p>
        <div class="contact-badges">
          <a href="nostr:perry@goosielabs.com" class="contact-badge">🟣 Nostr DM</a>
          <a href="lightning:perry@goosielabs.com" class="contact-badge">⚡ perry@goosielabs.com</a>
        </div>
      </div>
      <style>
        .contact-nostr { margin:2rem 0; padding:2rem; background:var(--gray-50,#f8f8f6); border-radius:12px; }
        .contact-nostr p { color:#5f5e5a; margin-bottom:1rem; }
        .contact-badges { display:flex; gap:1rem; flex-wrap:wrap; }
        .contact-badge { display:inline-flex; align-items:center; gap:8px; background:white; border:1px solid #e8e8e4; border-radius:8px; padding:10px 18px; text-decoration:none; color:#2c2c2a; font-weight:500; font-size:0.9rem; transition:border-color 0.2s; }
        .contact-badge:hover { border-color:#378add; }
      </style>
    `)
    .replace(/<script[\s\S]*?<\/script>/gi, '');

  return shell('Contact', `<div class="page-content">${cleaned}</div>`, 'nl', 'contact');
}

// ── Contact page (EN) ────────────────────────────────────────────────────────
function generateContactEn() {
  const fragment = readFileSync(`${PAGES_DIR}/contact_en.html`, 'utf8');
  const cleaned = fragment
    .replace(/<!-- wp:html -->/g, '')
    .replace(/<form[\s\S]*?<\/form>/gi, `
      <div class="contact-nostr">
        <p>Send a Nostr DM or a Lightning zap. We'll call you back.</p>
        <div class="contact-badges">
          <a href="nostr:perry@goosielabs.com" class="contact-badge">🟣 Nostr DM</a>
          <a href="lightning:perry@goosielabs.com" class="contact-badge">⚡ perry@goosielabs.com</a>
        </div>
      </div>
      <style>
        .contact-nostr { margin:2rem 0; padding:2rem; background:var(--gray-50,#f8f8f6); border-radius:12px; }
        .contact-nostr p { color:#5f5e5a; margin-bottom:1rem; }
        .contact-badges { display:flex; gap:1rem; flex-wrap:wrap; }
        .contact-badge { display:inline-flex; align-items:center; gap:8px; background:white; border:1px solid #e8e8e4; border-radius:8px; padding:10px 18px; text-decoration:none; color:#2c2c2a; font-weight:500; font-size:0.9rem; transition:border-color 0.2s; }
        .contact-badge:hover { border-color:#378add; }
      </style>
    `)
    .replace(/<script[\s\S]*?<\/script>/gi, '');

  return shell('Contact', `<div class="page-content">${cleaned}</div>`, 'en', 'contact');
}

// ── Article pages ─────────────────────────────────────────────────────────────
function generateArticle(file, title, lang) {
  const fragment = readFileSync(file, 'utf8').replace(/<!-- wp:[^>]+-->/g, '');
  return shell(title, `
    <div class="page-content">
      <article style="max-width:720px">
        ${fragment}
      </article>
    </div>
    <style>
      article h1,article h2,article h3 { font-family:'Libre Baskerville',Georgia,serif; margin:1.5rem 0 0.75rem; color:#0c447c; }
      article h1 { font-size:2rem; }
      article h2 { font-size:1.4rem; }
      article p { margin-bottom:1rem; color:#5f5e5a; line-height:1.8; }
      article a { color:#185fa5; }
    </style>
  `, lang);
}

// ── Bitcoin article (EN) ──────────────────────────────────────────────────────
function generateBitcoinEn() {
  return shell('Bitcoin', `
    <div class="page-content">
      <article style="max-width:720px">
        <h1>Bitcoin</h1>
        <p>Bitcoin is the first and only truly scarce digital money. Launched in 2009 by the pseudonymous Satoshi Nakamoto, it lets anyone send value anywhere in the world without asking permission from a bank, government, or anyone else.</p>

        <h2>What is Bitcoin?</h2>
        <p>Bitcoin is a digital currency that works without banks or governments as intermediaries. Transactions are recorded on the blockchain — a decentralised, public ledger maintained by thousands of computers worldwide. No single party controls it. No one can print more of it.</p>
        <p>There will only ever be 21 million bitcoin. That cap is enforced by code, not by a promise.</p>

        <h2>Why does it have value?</h2>
        <p>Bitcoin is scarce, durable, portable, divisible, and censorship-resistant. It has no CEO, no headquarters, and no off switch. That combination — hard money with no counterparty risk — is something that has never existed before.</p>
        <p>At Goosie Labs we see Bitcoin not as speculation but as infrastructure: a neutral settlement layer anyone can build on, and a way to hold value without asking for permission.</p>

        <h2>Lightning Network</h2>
        <p>Bitcoin on-chain transactions are final and secure but not instant. The Lightning Network is a second layer that enables payments in milliseconds for fractions of a cent — ideal for apps. All the Goosie Labs apps that handle payments use Lightning via <a href="https://getalby.com" target="_blank" rel="noopener">Alby</a> and <a href="https://www.bolt12.org/" target="_blank" rel="noopener">NWC</a>.</p>

        <h2>Cashu — ecash on Bitcoin</h2>
        <p>Cashu is an ecash protocol that runs on top of Lightning. You deposit sats into a mint and receive bearer tokens — untraceable, instant, no accounts required. Goosie Labs runs its own mint at <a href="https://mint.goosielabs.com">mint.goosielabs.com</a> and uses Cashu inside apps like ZapHunt and CatchZaps for anonymous micro-payments.</p>

        <h2>Austrian Economics</h2>
        <p>Bitcoin makes sense if you understand money. Central banks expand the money supply, which transfers purchasing power from savers to debtors. Bitcoin inverts that: fixed supply, no inflation, no bailouts. The Austrian school of economics — Mises, Hayek, Rothbard — described this kind of hard money long before Satoshi built it.</p>

        <p style="margin-top:2rem;font-size:0.9rem;color:#888780;">Bitcoin · Lightning · Cashu · Self-sovereign money</p>
      </article>
    </div>
    <style>
      article h1,article h2,article h3 { font-family:'Libre Baskerville',Georgia,serif; margin:1.5rem 0 0.75rem; color:#0c447c; }
      article h1 { font-size:2rem; }
      article h2 { font-size:1.4rem; }
      article p { margin-bottom:1rem; color:#5f5e5a; line-height:1.8; }
      article a { color:#185fa5; }
    </style>
  `, 'en');
}
// ── Manifest page (EN) — "Why we build this" ─────────────────────────────────
// Dark long-form reading page. Text is verbatim from GOOSIE-LABS-MANIFEST.md —
// typography is ours, the words are not. Self-contained (own fonts + styles +
// live block-height script) so it renders identically whether served through the
// nginx nsite proxy at goosielabs.com/manifest or directly via the nsite gateway.
function generateManifest() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Why we build this — The Goosie Labs Manifest</title>
  <meta name="description" content="Why we build what we build — and why you can try every word of it. The Goosie Labs Manifest.">
  <link rel="icon" type="image/svg+xml" href="/goosie-favicon.svg">
  <link rel="icon" href="/favicon.ico" type="image/x-icon">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
    :root {
      --bg:#042C53; --bg-soft:#063a6b; --ink:#EAF2FB; --ink-soft:#AFC8E4;
      --ink-dim:#7FA2C6; --line:rgba(174,200,232,0.18); --accent:#7FB2F0;
      --owning:#8FE3C4; --renting:#F0A9A0;
      --font-display:'Libre Baskerville',Georgia,serif;
      --font-body:'DM Sans',system-ui,sans-serif;
    }
    html { -webkit-text-size-adjust:100%; }
    body { font-family:var(--font-body); background:var(--bg); color:var(--ink); font-size:18px; line-height:1.8; -webkit-font-smoothing:antialiased; }
    a { color:var(--accent); }
    .mf-nav { border-bottom:1px solid var(--line); }
    .mf-nav-inner { max-width:1100px; margin:0 auto; padding:1.1rem 1.5rem; display:flex; align-items:center; gap:12px; }
    .mf-nav-inner img { height:34px; width:auto; }
    .mf-nav-inner span { font-family:var(--font-display); font-size:17px; color:var(--ink); letter-spacing:-0.02em; }
    .mf-nav-inner a { margin-left:auto; font-size:14px; color:var(--ink-soft); text-decoration:none; font-weight:500; }
    .mf-nav-inner a:hover { color:var(--ink); }
    .mf { max-width:68ch; margin:0 auto; padding:4.5rem 1.5rem 3rem; }
    .mf-eyebrow { font-size:0.78rem; font-weight:600; letter-spacing:0.14em; text-transform:uppercase; color:var(--accent); margin-bottom:1.2rem; }
    h1 { font-family:var(--font-display); font-weight:700; font-size:clamp(2.2rem,6vw,3.2rem); line-height:1.15; letter-spacing:-0.01em; margin-bottom:0.6rem; color:#fff; }
    .mf-subtitle { font-family:var(--font-display); font-style:italic; font-size:1.25rem; color:var(--ink-soft); margin-bottom:1.6rem; }
    .mf-lede { font-size:1.15rem; color:var(--ink-soft); line-height:1.7; border-left:2px solid var(--line); padding-left:1.1rem; margin-bottom:2.5rem; }
    h2 { font-family:var(--font-display); font-weight:700; font-size:1.6rem; line-height:1.3; color:#fff; margin:3.5rem 0 1.1rem; }
    p { margin-bottom:1.4rem; color:var(--ink); }
    .mf p strong { color:#fff; }
    section:first-of-type h2 { margin-top:1rem; }
    .mf-callout { font-family:var(--font-display); font-size:1.35rem; line-height:1.5; color:#fff; text-align:center; padding:1.8rem 1.4rem; margin:2rem 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line); }
    .mf-callout-em { font-family:var(--font-display); font-weight:700; font-size:1.55rem; line-height:1.4; color:var(--owning); text-align:center; padding:1.6rem 1rem; margin:2.2rem 0; }
    .mf-table-wrap { margin:2.2rem -0.5rem; overflow-x:auto; -webkit-overflow-scrolling:touch; }
    table.mf-table { width:100%; border-collapse:collapse; font-size:0.95rem; min-width:520px; }
    table.mf-table caption { text-align:left; color:var(--ink-dim); font-size:0.9rem; padding:0 0.5rem 0.9rem; }
    table.mf-table th, table.mf-table td { text-align:left; vertical-align:top; padding:0.85rem 0.9rem; border-bottom:1px solid var(--line); line-height:1.55; }
    table.mf-table thead th { font-family:var(--font-body); font-weight:600; font-size:0.82rem; letter-spacing:0.02em; color:#fff; border-bottom:1px solid rgba(174,200,232,0.35); }
    table.mf-table thead th.col-rent { color:var(--renting); }
    table.mf-table thead th.col-own { color:var(--owning); }
    table.mf-table tbody th { font-weight:600; color:#fff; width:26%; background:rgba(255,255,255,0.02); }
    table.mf-table td.col-rent { color:var(--ink-soft); }
    table.mf-table td.col-own { color:var(--owning); }
    table.mf-table tbody tr:last-child th, table.mf-table tbody tr:last-child td { border-bottom:none; }
    table.mf-table tbody tr.row-last { background:rgba(143,227,196,0.05); }
    .mf-closing { font-family:var(--font-display); font-weight:700; font-size:clamp(1.5rem,4vw,2rem); line-height:1.45; color:#fff; text-align:center; margin:3.5rem 0 1.2rem; letter-spacing:-0.01em; }
    .mf-signoff { text-align:center; font-family:var(--font-display); font-style:italic; font-size:1.05rem; color:var(--ink-soft); margin-bottom:1rem; }
    .mf-appendix { margin-top:4.5rem; padding-top:2rem; border-top:1px solid var(--line); font-size:0.92rem; color:var(--ink-soft); line-height:1.7; }
    .mf-appendix h2 { font-size:1.15rem; color:var(--ink-soft); font-style:italic; margin:0 0 1.2rem; }
    .mf-appendix p { color:var(--ink-soft); font-size:0.92rem; margin-bottom:1.1rem; }
    .mf-appendix ul { list-style:none; padding:0; margin:0 0 1.4rem; }
    .mf-appendix li { margin-bottom:1.3rem; padding-left:0; }
    .mf-appendix li b { color:var(--ink); font-weight:600; font-style:italic; }
    .mf-src { display:block; margin-top:0.35rem; font-size:0.82rem; color:var(--ink-dim); }
    .mf-src a { color:var(--accent); text-decoration:none; }
    .mf-src a:hover { text-decoration:underline; }
    footer.mf-foot { border-top:1px solid var(--line); padding:2rem 1.5rem; text-align:center; font-size:0.82rem; color:var(--ink-dim); }
    footer.mf-foot a { color:var(--ink-soft); }
    @media (max-width:600px) { body { font-size:16.5px; } .mf { padding:3rem 1.25rem 2.5rem; } }
  </style>
</head>
<body>
  <nav class="mf-nav">
    <div class="mf-nav-inner">
      <img src="/goosie-mark.svg" alt="" aria-hidden="true" width="34" height="34">
      <span>Goosie Labs</span>
      <a href="/">← Home</a>
    </div>
  </nav>

  <main class="mf">
    <div class="mf-eyebrow">The Goosie Labs Manifesto</div>
    <h1>Why we build this</h1>
    <div class="mf-subtitle">The Goosie Labs Manifesto</div>
    <p class="mf-lede">Why we build what we build — and why you can try every word of it.</p>

    <section>
      <h2>1. You don&rsquo;t own anything online</h2>
      <p>Check your pockets. Your account names, your followers, your photos, your messages, your game coins, your reputation — none of it is yours. You rent it all. The landlord is whichever company runs the server, and the rent you pay is your attention and your data.</p>
      <p>Renting feels fine until the day it doesn&rsquo;t. An account gets locked and ten years of photos are gone. A payment gets frozen &ldquo;for review.&rdquo; A post disappears, or the whole platform does, and your name, your work, and everyone you knew there go with it. You did nothing wrong. You just never held the keys.</p>
      <p>We are not angry about this. Most of the internet was built this way because it was the easiest way to build it. But easiest is not the same as best, and it is certainly not the only way. There is another way, and it is not a theory. It runs. We run it.</p>
    </section>

    <section>
      <h2>2. What we mean by decentralization</h2>
      <p>The word sounds technical. The idea is not.</p>
      <p class="mf-callout">Something is decentralized when no single party can take it from you, block you from it, or delete it behind your back.</p>
      <p>That&rsquo;s the whole definition. Not &ldquo;runs on a blockchain.&rdquo; Not &ldquo;has a token.&rdquo; One test, three parts: Can someone take it? Can someone lock you out? Can someone erase it? If all three answers are no, it&rsquo;s yours in a way nothing on a normal platform ever is.</p>
      <p>The difference in one table:</p>
      <div class="mf-table-wrap">
        <table class="mf-table">
          <thead>
            <tr>
              <th scope="col"></th>
              <th scope="col" class="col-rent">Renting (the normal internet)</th>
              <th scope="col" class="col-own">Owning (what we build with)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Your identity</th>
              <td class="col-rent">A row in their database. They can ban it.</td>
              <td class="col-own">A key only you hold. Nobody can revoke it.</td>
            </tr>
            <tr>
              <th scope="row">Your money</th>
              <td class="col-rent">A number in their computer. They can freeze it.</td>
              <td class="col-own">Coins in your pocket. Spendable by you alone.</td>
            </tr>
            <tr>
              <th scope="row">Your words &amp; pictures</th>
              <td class="col-rent">Stored on their server. They can delete them.</td>
              <td class="col-own">Signed by you, copied across many servers.</td>
            </tr>
            <tr>
              <th scope="row">Your proof &amp; reputation</th>
              <td class="col-rent">Granted by them. They can take it back.</td>
              <td class="col-own">Stamped on an open network. Unrevokable.</td>
            </tr>
            <tr class="row-last">
              <th scope="row">When you lose your password</th>
              <td class="col-rent">&ldquo;Click here to reset.&rdquo;</td>
              <td class="col-own">Nobody can reset it. That&rsquo;s the deal.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>Notice the last row. We put it in the table on purpose. Ownership has a price, and we will name it rather than hide it.</p>
    </section>

    <section>
      <h2>3. Why it matters</h2>
      <p>Because everything that matters about you is moving online, and whoever controls your online self controls more of your real self every year.</p>
      <p>Your identity is how you enter every room on the internet. If a company holds it, every room has a bouncer you didn&rsquo;t hire. Your money is stored decisions — everything you might still choose to do. If a company holds it, your future needs their permission. Your words and pictures are your memory and your voice. If a company holds them, your past can be edited and your voice can be muted. Your proof — what you did, what you learned, what you earned — is your track record. If a company holds it, your track record has an expiry date you don&rsquo;t control.</p>
      <p>None of this requires a villain. The people running platforms are mostly decent, and most bans are boring. That&rsquo;s exactly the point: a system where your things can be taken is a system where your things will, eventually, sometimes, be taken — by mistake, by policy change, by acquisition, by bankruptcy, by a moderator having a bad day. Ownership is not paranoia about bad people. It&rsquo;s architecture that doesn&rsquo;t need anyone to be good.</p>
      <p>Those who came before us saw this early. The cypherpunks wrote in 1993 that nobody would grant us privacy — we would have to build it ourselves, in code. The self-sovereign identity movement turned that spirit into ten testable principles: your identity must exist, persist, and travel with you, under your control. Bitcoin proved money could work this way at planetary scale. Nostr proved your social self could too: no platform, so no deplatforming. We didn&rsquo;t invent any of this. We stand on it — and we notice that one thing is still missing.</p>
    </section>

    <section>
      <h2>4. What&rsquo;s missing: nobody can feel it</h2>
      <p>Manifestos argue. Whitepapers specify. Podcasts explain. And after thirty years of brilliant arguing, the average person still can&rsquo;t tell you what a key is, has never held a sat, and doesn&rsquo;t know that owning your digital life is even possible.</p>
      <p>The problem is not that people don&rsquo;t get it. The problem is that reading about ownership is like reading about swimming. There is exactly one way to learn what it feels like when nobody can take your things: hold your things.</p>
      <p>So here is our contribution, and our only real rule:</p>
      <p class="mf-callout-em">If you can&rsquo;t demo it, it doesn&rsquo;t exist.</p>
      <p>We don&rsquo;t ask you to believe decentralization is better. We point you to a real app, you make a key that is yours alone, and you say one word into an open network — and a goose you&rsquo;ve never met honks back, from no company&rsquo;s server. Then check the three questions on what you just made. Can we take your key? Can we lock you out of it? Can we delete what you said? Go ahead. Try. That failure to control you is the entire lesson, and no essay can teach it.</p>
      <p>Every experiment on this site follows the same rule. Each one is a working answer to one question: honest feedback with no middleman holding the names. An agreement that pays out with no bank in the middle. A last will with no notary. Proof-you-did-it with no institution that can revoke it. Small, real, clickable. Some are rough. All of them run.</p>
    </section>

    <section>
      <h2>5. What it costs (the part other manifestos skip)</h2>
      <p>We will not sell you a fairy tale. Ownership is a trade, and you should see both sides before you choose.</p>
      <p><strong>There is no &ldquo;forgot password.&rdquo;</strong> If you hold the only key, then losing the key means losing the thing. No company to call is the feature and the responsibility.</p>
      <p><strong>The edges are rougher.</strong> Platforms are smooth because a thousand employees sand them down. Open networks are built by volunteers and stubborn people. It gets better every month. It is not Instagram-smooth yet.</p>
      <p><strong>Decentralization is a direction, not a badge.</strong> Even open networks drift toward convenient middlemen when everyone uses the same three servers — the builders of these protocols say so themselves, and we respect them more for it. Staying decentralized takes ongoing effort. Ours included: when you try our apps, some training wheels (like the mint that makes your first coins) are still points of trust. We label them instead of hiding them, and we show you the door to remove them.</p>
      <p>If, knowing all this, you&rsquo;d rather rent — that is a fine and honest choice. We only insist that it be a choice. Right now, almost nobody has ever seen the alternative. That&rsquo;s what this site is for.</p>
    </section>

    <section>
      <h2>6. Why geese</h2>
      <p>Geese fly thousands of kilometers in a V with no boss. The lead position rotates — whoever is fresh takes the front, and the honking from behind is encouragement, not command. No goose owns the formation; the formation exists because each goose flies its own wings in the same direction. That is the most honest picture of decentralization we know, and it&rsquo;s why our experiments are called goosies and why you&rsquo;ll hear honking around here. Serious ideas don&rsquo;t require solemn packaging.</p>
    </section>

    <section>
      <h2>7. Try it</h2>
      <p>Don&rsquo;t take our word for any of this. Words are cheap — they can walk you to the edge of the pool, but they can&rsquo;t get you wet. So don&rsquo;t leave having only read.</p>
      <p><a href="https://start.goosielabs.com">Start here</a>: install a real Nostr app, make a key that&rsquo;s yours alone, and say hello — a goose will honk back from an open network no company controls. About three minutes. Then ask the three questions of what you made.</p>
      <p>After that, the experiments are open, the code is free, and the flock has room.</p>
      <p class="mf-closing">Own your keys. Own your money. Own your words. And if you can&rsquo;t demo it, it doesn&rsquo;t exist.</p>
      <p class="mf-signoff">— Goosie Labs, Schiedam<span id="mf-bh-clause">, block height <span id="mf-block">#&hellip;</span></span></p>
    </section>

    <div class="mf-appendix">
      <h2>Lineage notes (appendix — for the curious, not part of the manifest)</h2>
      <p>We wrote this in our own words, but not from nothing. What we learned from each ancestor:</p>
      <ul>
        <li>
          <b>A Cypherpunk&rsquo;s Manifesto (Eric Hughes, 1993).</b> Define your terms plainly, then commit to building rather than asking. His &ldquo;cypherpunks write code&rdquo; becomes our &ldquo;if you can&rsquo;t demo it, it doesn&rsquo;t exist&rdquo; — the same spirit, one step further: code that a stranger can click.
          <span class="mf-src">&rarr; <a href="https://www.activism.net/cypherpunk/manifesto.html" target="_blank" rel="noopener">activism.net/cypherpunk/manifesto.html</a> &middot; <a href="https://nakamotoinstitute.org/library/cypherpunk-manifesto/" target="_blank" rel="noopener">mirror at nakamotoinstitute.org</a></span>
        </li>
        <li>
          <b>A Declaration of the Independence of Cyberspace (John Perry Barlow, 1996).</b> The cautionary tale. Beautiful voice, zero mechanism — and it aimed at governments while platforms quietly became the real landlords. Lessons: never declare what you can&rsquo;t demonstrate, and name the actual adversary (for a newcomer today: the login screen, not the state).
          <span class="mf-src">&rarr; <a href="https://www.eff.org/cyberspace-independence" target="_blank" rel="noopener">eff.org/cyberspace-independence</a></span>
        </li>
        <li>
          <b>The Path to Self-Sovereign Identity (Christopher Allen, 2016).</b> Principles as a testable checklist beat rhetoric. Our three questions (take it? block it? delete it?) are a folk-sized compression of his ten principles.
          <span class="mf-src">&rarr; <a href="https://www.lifewithalacrity.com/2016/04/the-path-to-self-soverereign-identity.html" target="_blank" rel="noopener">lifewithalacrity.com</a> &middot; <a href="https://github.com/WebOfTrustInfo/self-sovereign-identity" target="_blank" rel="noopener">mirror at WebOfTrustInfo on GitHub</a></span>
        </li>
        <li>
          <b>Nostr (fiatjaf, 2020).</b> Identity as a key: no platform, so no deplatforming. And crucially, fiatjaf&rsquo;s own honesty that decentralization degrades in practice when everyone uses the same relays — which is why our Section 5 exists.
          <span class="mf-src">&rarr; <a href="https://fiatjaf.com/nostr.html" target="_blank" rel="noopener">fiatjaf.com/nostr.html</a> &middot; <a href="https://github.com/nostr-protocol/nostr" target="_blank" rel="noopener">protocol repo</a> &middot; <a href="https://fiatjaf.com/87a208d9.html" target="_blank" rel="noopener">his self-critique</a></span>
        </li>
      </ul>
      <p>The structural choice: every ancestor manifesto argues. Ours ends every claim with something clickable. That&rsquo;s the only originality we claim, and it&rsquo;s enough.</p>
    </div>
  </main>

  <footer class="mf-foot">
    <a href="/">goosielabs.com</a> &middot; <a href="/creators.html">About the creators</a> &middot; <a href="https://start.goosielabs.com">Start here</a>
  </footer>

  <script>
  // Live block height in the signature — same data source as the homepage counter
  // (Blocky's kind:1 #t=block note on the relay). On failure, drop the clause so
  // the signature reads a clean "— Goosie Labs, Schiedam" (never a broken placeholder).
  (function(){
    var RELAY='wss://relay.goosielabs.com';
    var BLOCKY='d4e2e205c8e1437b40b635a88ca85c44f5f4b18539e8c09551d9ce0f200ff71b';
    var clause=document.getElementById('mf-bh-clause');
    var el=document.getElementById('mf-block');
    var settled=false, ws;
    function hide(){ if(settled) return; settled=true; if(clause) clause.style.display='none'; try{ ws&&ws.close(); }catch(e){} }
    function show(h){ if(settled) return; settled=true; if(el) el.textContent='#'+h.toLocaleString('en'); try{ ws&&ws.close(); }catch(e){} }
    var to=setTimeout(hide, 6000);
    try { ws=new WebSocket(RELAY); } catch(e){ hide(); return; }
    var sub='mf'+Math.random().toString(36).slice(2,7);
    ws.onopen=function(){ ws.send(JSON.stringify(['REQ',sub,{kinds:[1],authors:[BLOCKY],'#t':['block'],limit:1}])); };
    ws.onmessage=function(e){
      try {
        var m=JSON.parse(e.data);
        if(m[0]==='EVENT'){
          var t=(m[2].tags||[]).find(function(x){ return x[0]==='block_height'; });
          if(t){ clearTimeout(to); show(parseInt(t[1],10)); }
        }
      } catch(err){}
    };
    ws.onerror=function(){ clearTimeout(to); hide(); };
  })();
  </script>
</body>
</html>`;
}

// ── Main ─────────────────────────────────────────────────────────────────────
console.log('Generating pages…\n');

const pages = {
  '/index.html':      Buffer.from(await generateHomepage(), 'utf8'),
  '/mcp.html':        Buffer.from(generateArticle(`${PAGES_DIR}/mcp_en.html`, 'What is MCP?', 'en'), 'utf8'),
  '/bitcoin.html':    Buffer.from(generateBitcoinEn(), 'utf8'),
  '/sats.html':       Buffer.from(generateArticle(`${PAGES_DIR}/sats_en.html`, 'Your first sats', 'en'), 'utf8'),
  '/manifest.html':   Buffer.from(generateManifest(), 'utf8'),
};

console.log('Uploading to Blossom…\n');
const manifest = {};
for (const [pagePath, buf] of Object.entries(pages)) {
  try {
    const hash = await uploadToBlossom(buf, 'text/html', path.basename(pagePath));
    manifest[pagePath] = hash;
  } catch (e) {
    console.error(`\x1b[31m✗\x1b[0m  ${pagePath}: ${e.message}`);
  }
}

console.log(`\nPublishing Kind 15128 manifest (${Object.keys(manifest).length} files)…`);
try {
  await publishManifest(nsecHex, pubkeyHex, manifest);
  console.log(`\x1b[32m✓\x1b[0m  Manifest published\n`);
} catch (e) {
  console.error(`\x1b[31m✗\x1b[0m  Manifest failed: ${e.message}`);
  process.exit(1);
}

const nsiteUrl = `${NSITE_BASE}/${npub}/`;
console.log(`\x1b[1m✅ Site live at: ${nsiteUrl}\x1b[0m`);
console.log(`   Also at: https://goosielabs.com/ (nginx → nsite proxy)`);
