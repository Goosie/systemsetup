#!/usr/bin/env node
/**
 * publish-homepage.mjs
 *
 * Publishes goosielabs.com as a decentralized nsite under Perry's Nostr key.
 *
 * Pages published:
 *   /index.html     — homepage (tiles + V-Formation, regenerated from tile.json)
 *   /about.html     — About page (EN, generated from code)
 *   /contact.html   — Contact page (EN, generated from code)
 *   /mcp.html       — MCP article (EN, from scripts/pages/mcp_en.html)
 *   /bitcoin.html   — Bitcoin article (EN, generated from code)
 *
 * Usage:
 *   PERRY_NSEC=nsec1... node publish-homepage.mjs
 *   # or if stored in ~/.bashrc.local:
 *   source ~/.bashrc.local && node publish-homepage.mjs
 */

import { createHash } from 'crypto';
import { readFileSync, existsSync, readdirSync, mkdirSync, copyFileSync } from 'fs';
import path from 'path';
import WebSocket from '/home/deploy/nsite-gateway/node_modules/ws/lib/websocket.js';

const {
  finalizeEvent,
  nip19,
} = await import('/var/www/goosielabs/apps/catchzaps/node_modules/nostr-tools/lib/esm/index.js');

// ── Config ───────────────────────────────────────────────────────────────────
const BLOSSOM    = 'http://127.0.0.1:3339';
const RELAY      = 'ws://127.0.0.1:7778';
const NSITE_BASE = 'https://nsite.goosielabs.com';
const APPS_DIR   = '/var/www/goosielabs/apps';
const PAGES_DIR  = '/home/deploy/scripts/pages';
const KEYS_DIR   = '/home/deploy/agents';
const CLAUDE_DIR = '/home/deploy/.claude/agents';

// ── Get Perry's nsec ─────────────────────────────────────────────────────────
const PERRY_NSEC = process.env.PERRY_NSEC;
if (!PERRY_NSEC || !PERRY_NSEC.startsWith('nsec1')) {
  console.error('\x1b[31m✗\x1b[0m PERRY_NSEC not set or invalid.');
  console.error('  Run: source ~/.bashrc.local && node publish-homepage.mjs');
  console.error('  Or:  PERRY_NSEC=nsec1... node publish-homepage.mjs');
  process.exit(1);
}

const nsecBytes = nip19.decode(PERRY_NSEC).data;
const nsecHex   = Buffer.from(nsecBytes).toString('hex');
const pubkeyHex = await (async () => {
  const { getPublicKey } = await import('/var/www/goosielabs/apps/catchzaps/node_modules/nostr-tools/lib/esm/index.js');
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

function publishManifest(nsecHex, pubkey, files) {
  return new Promise((resolve, reject) => {
    const sk   = Buffer.from(nsecHex, 'hex');
    const tags = Object.entries(files).map(([p, h]) => ['path', p, h]);
    const ev   = finalizeEvent({ kind:15128, created_at:Math.floor(Date.now()/1000), tags, content:'' }, sk);
    const ws   = new WebSocket(RELAY);
    const t    = setTimeout(() => { ws.terminate(); reject(new Error('timeout')); }, 8000);
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', ev])));
    ws.on('message', raw => {
      const m = JSON.parse(raw.toString());
      if (m[0]==='OK') { clearTimeout(t); ws.close(); m[2] ? resolve(ev) : reject(new Error(m[3])); }
    });
    ws.on('error', e => { clearTimeout(t); reject(e); });
  });
}

// ── Shared nav + shell wrapper ────────────────────────────────────────────────
function shell(title, bodyHtml, lang='nl', activePage='') {
  const navLinks = [
    { href: './',           label: 'Home',    key: 'home' },
    { href: 'about.html',   label: 'About',   key: 'about' },
    { href: 'contact.html', label: 'Contact', key: 'contact' },
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
    .nav-inner { max-width:1080px; margin:0 auto; padding:0 2rem; height:64px; display:flex; align-items:center; justify-content:space-between; }
    .nav-logo { font-family:var(--font-display); font-size:18px; color:var(--blue-800); letter-spacing:-0.02em; cursor:default; }
    .nav-logo span { color:var(--blue-400); }
    .nav-links { display:flex; gap:2rem; }
    .nav-link { font-size:14px; font-weight:500; color:var(--gray-600); text-decoration:none; transition:color 0.2s; }
    .nav-link:hover, .nav-link-active { color:var(--blue-600); }
    .page-content { max-width:1080px; margin:0 auto; padding:3rem 2rem 6rem; }
    footer { border-top:1px solid var(--gray-100); padding:2rem; text-align:center; font-size:0.8rem; color:var(--gray-400); }
    footer a { color:var(--gray-400); }
    .nsite-badge { display:inline-block; background:#1e1b4b; color:#818cf8; border:1px solid #312e81; border-radius:9999px; padding:1px 8px; font-size:0.65rem; font-weight:700; margin-left:0.5rem; vertical-align:middle; }
  </style>
</head>
<body>
  <nav>
    <div class="nav-inner">
      <span class="nav-logo">Goosie<span>.</span>Labs</span>
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
    Nostr · Blossom · Bitcoin
  </footer>
</body>
</html>`;
}

// ── Homepage generator (from tile.json + nostr keys) ─────────────────────────
async function generateHomepage() {
  const STATUS_LABELS  = { live:'Live', 'in-bouw':'In progress', experiment:'Experiment', archief:'Archive' };
  const STATUS_CLASSES = { live:'badge-live', 'in-bouw':'badge-building', experiment:'badge-experiment', archief:'badge-idea' };
  const AGENT_COLORS   = { assistenty:'#6366f1', devy:'#0ea5e9', finny:'#10b981', ay:'#f59e0b', jurry:'#8b5cf6', secury:'#ef4444', testy:'#ec4899', checky:'#14b8a6', commy:'#f97316', designy:'#a855f7', nosty:'#06b6d4', docy:'#64748b', transy:'#e11d48' };
  const AGENT_ORDER    = ['assistenty','devy','finny','ay','jurry','secury','testy','checky','commy','designy','nosty','docy','transy'];

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
        agents.push({ name, npub: key.npub, description, quote });
      } catch {}
    }
  } catch {}
  agents.sort((a, b) => {
    const ai = AGENT_ORDER.indexOf(a.name), bi = AGENT_ORDER.indexOf(b.name);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  agents.splice(0, agents.length, ...agents.filter(a => AGENT_ORDER.includes(a.name)));

  // Check which agents have a published nsite
  await Promise.all(agents.map(async a => {
    try {
      const res = await fetch(`http://127.0.0.1:3340/${a.npub}/index.html`, { method: 'HEAD', signal: AbortSignal.timeout(2000) });
      a.hasNsite = res.ok;
    } catch { a.hasNsite = false; }
  }));

  // Generate tile cards HTML
  const tilesHtml = tiles.map(t => {
    const status   = t.status ?? 'experiment';
    const label    = STATUS_LABELS[status] ?? status;
    const cssClass = STATUS_CLASSES[status] ?? 'badge-idea';
    const links = [];
    if (t.url) links.push(`<a href="${t.url}" class="project-link">Open app</a>`);
    if (t.github) links.push(`<a href="${t.github}" class="project-link project-link-github" target="_blank" rel="noopener">GitHub</a>`);
    if (t.juridischadvies) links.push(`<a href="${t.juridischadvies}" class="project-link project-link-juridisch" target="_blank" rel="noopener">Legal review</a>`);
    const linksHtml = links.length ? `\n        <div class="project-links">\n          ${links.join('\n          ')}\n        </div>` : '';
    const titleHtml = t.icon
      ? `<div class="project-card-title"><img class="project-icon" src="${t.icon}" alt="${t.title ?? ''}" width="40" height="40"><div class="project-name">${t.title ?? ''}</div></div>`
      : `<div class="project-name">${t.title ?? ''}</div>`;
    return `      <div class="project-card">
        <div class="project-card-top">
          ${titleHtml}
          <span class="badge ${cssClass}">${label}</span>
        </div>
        <p class="project-desc">${t.description ?? ''}</p>${linksHtml}
      </div>`;
  }).join('\n\n');

  // Sync agent portrait images to webroot so they're URL-accessible
  const WEBROOT_AGENTS = '/var/www/goosielabs/agents';

  // Generate agent cards HTML
  const agentCardsHtml = agents.map(a => {
    const color    = AGENT_COLORS[a.name] ?? '#6366f1';
    const nsiteUrl = `https://nsite.goosielabs.com/${a.npub}/`;
    const title    = a.name.charAt(0).toUpperCase() + a.name.slice(1);
    const tileText = a.quote || (a.description.length > 120 ? a.description.slice(0, 120) + '…' : a.description);

    // Use .jpg portrait → icon-192.png → 🪿 emoji fallback
    const jpgSrc  = `${KEYS_DIR}/${a.name}/${a.name}.jpg`;
    const iconSrc = `${KEYS_DIR}/${a.name}/icon-192.png`;
    const destDir = `${WEBROOT_AGENTS}/${a.name}`;
    let avatar;
    if (existsSync(jpgSrc)) {
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
    const inner = `
        ${avatar}
        <div class="agent-info">
          <div class="agent-name">${title}</div>
          <div class="agent-desc">${tileText}</div>
        </div>${promptLink}`;
    return `      <div class="agent-card">${inner}\n      </div>`;
  }).join('\n');

  // Use WP export as base (carries full CSS + layout), then patch all Dutch text
  let html = readFileSync(`${PAGES_DIR}/homepage_base.html`, 'utf8');

  // lang + fix double-quote bugs
  html = html.replace('lang="nl"', 'lang="en"');
  // Remove link behaviour from nav-logo CSS
  html = html.replace('.nav-logo { font-family:var(--font-display); font-size:18px; color:var(--blue-800); text-decoration:none; letter-spacing:-0.02em; }',
    '.nav-logo { font-family:var(--font-display); font-size:18px; color:var(--blue-800); letter-spacing:-0.02em; cursor:default; }');


  // Nav: make logo non-clickable, remove unwanted links, translate labels
  html = html.replace(/<a href="[^"]*" class="nav-logo">([^<]*<span>[^<]*<\/span>[^<]*)<\/a>/,
    '<span class="nav-logo">$1</span>');
  html = html.replace(/<a href="\/inloggen\/"[^>]*>.*?<\/a>/g, '');
  html = html.replace(/<a href="\/en\/"[^>]*>[^<]*<\/a>/g, '');
  html = html.replace(/<a href="#meedoen"[^>]*>Meedoen<\/a>/g, '');
  html = html.replace(/<a href="https:\/\/goosielabs\.com\/apps\/"[^>]*>Apps<\/a>/g, '');
  html = html.replace(/>Projecten<\/a>/, '>Projects</a>');
  html = html.replace(/>Over ons<\/a>/, '>About</a>');
  html = html.replace(/href="\/over-ons\/"/g, 'href="about.html"');
  html = html.replace(/href="\/contact\/"/, 'href="contact.html"');
  html = html.replace(/<a href="#projecten"/g, '<a href="#projects"');
  html = html.replace(/id="projecten"/g, 'id="projects"');

  // Hero
  html = html.replace('Open experimenteer-lab', 'Open experiment lab');
  html = html.replace('Een open lab voor Bitcoin, Nostr en AI', 'An open lab for Bitcoin, Nostr and AI');
  html = html.replace(
    /Ganzen vliegen in V-formatie[^<]+/,
    'Geese fly in V-formation — the lead changes so no one gets exhausted, and they circle back for stragglers. Goosie Labs works the same way: ideas are tested in the open, the lead rotates, and no one has to finish anything alone. Perry loves landing in new places, exploring technology that makes the world fairer, and building experiments others can reuse, build on, or pick up and finish together.'
  );
  html = html.replace(
    'Dit is geen product. Dit is een lab. Alles hier is in ontwikkeling — gebruik het, bouw erop verder, of neem contact op.',
    'This is not a product. This is a lab. Everything here is in development — use it, build on it, or reach out.'
  );
  html = html.replace('>Bekijk de experimenten<', '>View experiments<');
  html = html.replace(/>Mee vliegen\?(<\/a>)/, '>Fly along?$1');

  // Projects section headings
  html = html.replace(/>Experimenten<\/div>/, '>Experiments</div>');
  html = html.replace(/>Wat er vliegt<\/h2>/, ">What's flying</h2>");
  html = html.replace(
    '>Experimenten in verschillende stadia — van idee tot werkend prototype<',
    '>Experiments in various stages — from idea to working prototype<'
  );

  // Regenerate tiles between markers from live tile.json data
  html = html.replace(
    /<!-- APPS-TILES-START -->[\s\S]*?<!-- APPS-TILES-END -->/,
    `<!-- APPS-TILES-START -->\n${tilesHtml}\n      <!-- APPS-TILES-END -->`
  );

  // V-Formation section
  html = html.replace('>V-Formatie<', '>V-Formation<');
  html = html.replace(/>Het team</, '>The team<');
  html = html.replace(
    '>AI-ganzen met elk een eigen identiteit op Nostr — klik om hun rol en instructies te lezen.<',
    '>AI geese each with their own Nostr identity — click to read their role and instructions.<'
  );
  // Regenerate agent cards
  html = html.replace(
    /<!-- AGENTS-TILES-START -->[\s\S]*?<!-- AGENTS-TILES-END -->/,
    `<!-- AGENTS-TILES-START -->\n${agentCardsHtml}\n<!-- AGENTS-TILES-END -->`
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
          <a href="https://njump.me/npub14qpe36rvq0l6m3crplsntmnkzjm04weqflq0veqc8ra5hz4lpvxqqkdffc" class="contact-badge">🟣 Nostr DM</a>
          <a href="lightning:zoomer@getalby.com" class="contact-badge">⚡ zoomer@getalby.com</a>
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
          <a href="https://njump.me/npub14qpe36rvq0l6m3crplsntmnkzjm04weqflq0veqc8ra5hz4lpvxqqkdffc" class="contact-badge">🟣 Nostr DM</a>
          <a href="lightning:zoomer@getalby.com" class="contact-badge">⚡ zoomer@getalby.com</a>
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

// ── About page (EN) — written directly, no WP dependency ─────────────────────
function generateAboutEn() {
  return shell('About', `
    <style>
      .about-hero { background:linear-gradient(160deg,#042C53 0%,#0C447C 50%,#185FA5 100%); color:#fff; padding:6rem 2rem 5rem; }
      .about-hero-inner { max-width:1080px; margin:0 auto; }
      .about-label { display:inline-flex; align-items:center; gap:8px; background:rgba(255,255,255,0.12); border:1px solid rgba(255,255,255,0.2); border-radius:20px; padding:6px 14px; font-size:12px; font-weight:500; letter-spacing:0.08em; text-transform:uppercase; color:#B5D4F4; margin-bottom:2rem; }
      .about-hero h1 { font-family:'Libre Baskerville',Georgia,serif; font-size:clamp(2.2rem,5vw,3.4rem); font-weight:700; line-height:1.1; letter-spacing:-0.03em; color:#fff; margin-bottom:1rem; }
      .about-hero-sub { font-size:1.1rem; font-weight:300; color:#85B7EB; margin-bottom:1.5rem; }
      .about-hero-text { font-size:1rem; line-height:1.85; color:rgba(255,255,255,0.8); max-width:640px; }
      .about-section { padding:5rem 2rem; }
      .about-section-inner { max-width:1080px; margin:0 auto; }
      .about-section-gray { background:#F8F8F6; }
      .about-section-dark { background:linear-gradient(135deg,#042C53 0%,#0C447C 100%); color:#fff; padding:5rem 2rem; }
      .about-label-sm { font-size:11px; font-weight:600; letter-spacing:0.12em; text-transform:uppercase; color:#378ADD; margin-bottom:0.75rem; }
      .about-label-sm-light { color:#85B7EB; }
      .about-h2 { font-family:'Libre Baskerville',Georgia,serif; font-size:clamp(1.5rem,3vw,2.2rem); font-weight:700; color:#042C53; line-height:1.2; letter-spacing:-0.02em; margin-bottom:0.75rem; }
      .about-h2-light { color:#fff; }
      .about-sub { font-size:1rem; color:#5F5E5A; max-width:580px; line-height:1.75; }
      .about-sub-light { color:rgba(255,255,255,0.75); max-width:600px; }
      .about-quote { font-family:'Libre Baskerville',Georgia,serif; font-size:clamp(1rem,2vw,1.3rem); font-style:italic; color:#0C447C; border-left:3px solid #378ADD; padding-left:1.5rem; margin:2.5rem 0; line-height:1.6; max-width:600px; }
      .perry-grid { display:grid; grid-template-columns:1fr 1fr; gap:3rem; margin-top:3rem; }
      @media(max-width:640px){ .perry-grid { grid-template-columns:1fr; } }
      .perry-block h3 { font-family:'Libre Baskerville',Georgia,serif; font-size:1.1rem; color:#042C53; margin-bottom:0.5rem; }
      .perry-block p { font-size:0.95rem; color:#5F5E5A; line-height:1.75; }
      .formation-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:1rem; margin-top:2rem; }
      .goose-card { background:#fff; border:1px solid #EDEDEA; border-radius:0.75rem; padding:1.25rem; }
      .goose-card-name { font-weight:700; font-size:0.95rem; color:#0C447C; margin-bottom:0.25rem; }
      .goose-card-role { font-size:0.75rem; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:#378ADD; margin-bottom:0.5rem; }
      .goose-card-desc { font-size:0.85rem; color:#5F5E5A; line-height:1.6; }
      .steps { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:1.5rem; margin-top:2rem; }
      .step { background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:0.75rem; padding:1.5rem; }
      .step-num { font-size:2rem; font-weight:800; color:rgba(255,255,255,0.2); margin-bottom:0.5rem; }
      .step-title { font-weight:600; color:#fff; margin-bottom:0.4rem; }
      .step-desc { font-size:0.85rem; color:rgba(255,255,255,0.65); line-height:1.6; }
      .tags { display:flex; flex-wrap:wrap; gap:0.5rem; margin-top:1.5rem; }
      .tag { background:#E6F1FB; color:#185FA5; border-radius:9999px; padding:4px 12px; font-size:0.78rem; font-weight:500; }
    </style>

    <div class="about-hero">
      <div class="about-hero-inner">
        <div class="about-label">Open experiment lab</div>
        <h1>We build what others don't dare to yet.</h1>
        <p class="about-hero-sub">An open lab for Bitcoin, Nostr and AI.</p>
        <p class="about-hero-text">Goosie Labs is not an agency. Not a startup. It is a place where technology that makes the world fairer is simply tried out. Everything here is in development — use it, build on it, or join in.</p>
      </div>
    </div>

    <div class="about-section">
      <div class="about-section-inner">
        <div class="about-label-sm">The founder</div>
        <h2 class="about-h2">Perry Smit</h2>
        <blockquote class="about-quote">"This is not a product. This is a lab. Everything here is in development."</blockquote>
        <div class="perry-grid">
          <div class="perry-block">
            <h3>Why Bitcoin</h3>
            <p>Started with Bitcoin because it's fair. Moved on to Nostr because identity should belong to you. Now deep in AI because it finally runs locally — without Google watching over your shoulder.</p>
          </div>
          <div class="perry-block">
            <h3>Outside the lab</h3>
            <p>Mountain biking in the mountains, tai chi in the garden, or just walking. The best ideas arrive when you're not at a keyboard.</p>
          </div>
        </div>
        <div class="tags">
          <span class="tag">Bitcoin</span>
          <span class="tag">Nostr</span>
          <span class="tag">Cashu</span>
          <span class="tag">Lightning</span>
          <span class="tag">Local AI</span>
          <span class="tag">Self-Sovereign Identity</span>
          <span class="tag">Austrian Economics</span>
        </div>
      </div>
    </div>

    <div class="about-section about-section-gray">
      <div class="about-section-inner">
        <div class="about-label-sm">The AI team</div>
        <h2 class="about-h2">The V-Formation</h2>
        <p class="about-sub">Geese fly in V-formation because each goose reduces air resistance for the next. They switch positions. No one always leads. The whole is faster than the sum of its parts.</p>
        <div class="formation-grid">
          <div class="goose-card"><div class="goose-card-name">🪿 Assistenty</div><div class="goose-card-role">Primary orchestrator</div><div class="goose-card-desc">Will assist the director and every goose wherever she can. When there is a party, Assistenty will do most of the honking.</div></div>
          <div class="goose-card"><div class="goose-card-name">🪿 Devy</div><div class="goose-card-role">Developer Goose</div><div class="goose-card-desc">The main developer, always busy with keys. Turns ideas into points on the horizon. Devy loves to play with Nosty's features.</div></div>
          <div class="goose-card"><div class="goose-card-name">🪿 Finny</div><div class="goose-card-role">Chief Financial Goose</div><div class="goose-card-desc">Keeps track of all the coins flying around. Makes sure API calls get paid and every goose has enough pocket money to reach the next destination.</div></div>
          <div class="goose-card"><div class="goose-card-name">🪿 Ay</div><div class="goose-card-role">Config Auditor</div><div class="goose-card-desc">Manages all AI configurations and checks regularly that every goose has their feathers properly in order.</div></div>
          <div class="goose-card"><div class="goose-card-name">🪿 Jurry</div><div class="goose-card-role">Legal Advisor</div><div class="goose-card-desc">Makes sure the goosies don't do anything seriously wrong along the way. He honks proactively when something is about to become risky.</div></div>
          <div class="goose-card"><div class="goose-card-name">🪿 Secury</div><div class="goose-card-role">Security Goose</div><div class="goose-card-desc">Checks that all flights are secure and that the flock lands in the right place. When invaders are around, he honks them away.</div></div>
          <div class="goose-card"><div class="goose-card-name">🪿 Testy</div><div class="goose-card-role">QA Goose</div><div class="goose-card-desc">Always eager to test what the goosies have built. She's always first to arrive at the destination.</div></div>
          <div class="goose-card"><div class="goose-card-name">🪿 Checky</div><div class="goose-card-role">Quality Controller</div><div class="goose-card-desc">Makes sure everyone is on board with the right tools before the skirts fly away. When memory and capacity are confirmed, he honks the all-clear.</div></div>
          <div class="goose-card"><div class="goose-card-name">🪿 Commy</div><div class="goose-card-role">Community Goose</div><div class="goose-card-desc">Always honking about what the goosies are up to across social media streams. Always up for a good honky conversation.</div></div>
          <div class="goose-card"><div class="goose-card-name">🪿 Designy</div><div class="goose-card-role">Interface Builder</div><div class="goose-card-desc">Forever dreaming and sketching what the next destination should look like. Once arrived, he makes the environment nicer, cleaner, and easier to walk around.</div></div>
          <div class="goose-card"><div class="goose-card-name">🪿 Nosty</div><div class="goose-card-role">Nostr Identity Manager</div><div class="goose-card-desc">Our liaison with the Nostr flock. Always experimenting with new features — when something useful turns up, you'll hear him honking from far away.</div></div>
          <div class="goose-card"><div class="goose-card-name">🪿 Docy</div><div class="goose-card-role">Onboarding &amp; Identity</div><div class="goose-card-desc">Always writing things down and making pictures of the skirts. Works closely with Commy, his best friend, who flies right behind him to catch his stories.</div></div>
          <div class="goose-card"><div class="goose-card-name">🪿 Transy</div><div class="goose-card-role">Chief Reality Officer</div><div class="goose-card-desc">The communicator when the flock travels to foreign lands. Speaks almost every language and translates everything into the right honky sound. A very friendly goose — has friends everywhere.</div></div>
          <div class="goose-card"><div class="goose-card-name">🪿 Blocky</div><div class="goose-card-role">Bitcoin Block Scheduler</div><div class="goose-card-desc">Knows exactly when the next Bitcoin block will be mined. Every ten minutes on average, he activates all kinds of processes — backups, payment scripts, and whatever else needs a heartbeat.</div></div>
          <div class="goose-card"><div class="goose-card-name">🪿 Directory</div><div class="goose-card-role">Formation Director</div><div class="goose-card-desc">Always flies highest and looks furthest. When something interesting appears on the horizon, he knows exactly where to direct the flock.</div></div>
          <div class="goose-card"><div class="goose-card-name">🪿 Supporty</div><div class="goose-card-role">Support Goose</div><div class="goose-card-desc">Always willing to help and knows exactly who to ask when things get complicated. The only goose who honks less than the others — and the one quietly cleaning up what the rest left behind.</div></div>
        </div>
      </div>
    </div>

    <div class="about-section-dark">
      <div class="about-section-inner">
        <div class="about-label-sm about-label-sm-light">How we work</div>
        <h2 class="about-h2 about-h2-light">In half an hour, something stands.</h2>
        <p class="about-sub-light">No quote. No process. We just build.</p>
        <div class="steps">
          <div class="step"><div class="step-num">01</div><div class="step-title">Session at the garden shed</div><div class="step-desc">We sketch it out on the wall. What do you want? What should it do? Who uses it?</div></div>
          <div class="step"><div class="step-num">02</div><div class="step-title">Stack started</div><div class="step-desc">React, Vite, Nostr-tools — within thirty minutes something is running you can actually touch.</div></div>
          <div class="step"><div class="step-num">03</div><div class="step-title">V-Formation flies</div><div class="step-desc">Assistenty keeps the overview. Devy manages the code. Finny guards the sats. Testy tests everything.</div></div>
          <div class="step"><div class="step-num">04</div><div class="step-title">You get something real</div><div class="step-desc">A working prototype, or clear insight into what you want to build — and how.</div></div>
        </div>
      </div>
    </div>
  `, 'en', 'about');
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

// ── Main ─────────────────────────────────────────────────────────────────────
console.log('Generating pages…\n');

const pages = {
  '/index.html':      Buffer.from(await generateHomepage(), 'utf8'),
  '/about.html':      Buffer.from(generateAboutEn(), 'utf8'),
  '/contact.html':    Buffer.from(generateContactEn(), 'utf8'),
  '/mcp.html':        Buffer.from(generateArticle(`${PAGES_DIR}/mcp_en.html`, 'What is MCP?', 'en'), 'utf8'),
  '/bitcoin.html':    Buffer.from(generateBitcoinEn(), 'utf8'),
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
