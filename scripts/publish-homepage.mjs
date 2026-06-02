#!/usr/bin/env node
/**
 * publish-homepage.mjs
 *
 * Publishes goosielabs.com as a decentralized nsite under Perry's Nostr key.
 *
 * Pages published:
 *   /index.html     — homepage (tiles + V-Formation, regenerated from tile.json)
 *   /about.html     — About page (NL, from WP ID 43)
 *   /about-en.html  — About page (EN, from WP ID 90)
 *   /contact.html   — Contact page (NL)
 *   /contact-en.html — Contact page (EN)
 *   /mcp.html       — MCP article (EN)
 *   /bitcoin.html   — Bitcoin article (NL)
 *
 * Usage:
 *   PERRY_NSEC=nsec1... node publish-homepage.mjs
 *   # or if stored in ~/.bashrc.local:
 *   source ~/.bashrc.local && node publish-homepage.mjs
 *
 * After first run, update nginx:
 *   See instructions printed at end of script.
 */

import { createHash } from 'crypto';
import { readFileSync, existsSync, readdirSync } from 'fs';
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
    { href: '/',            label: 'Home',    key: 'home' },
    { href: '/about.html',  label: 'Over ons', key: 'about' },
    { href: '/contact.html',label: 'Contact',  key: 'contact' },
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
    .nav-logo { font-family:var(--font-display); font-size:18px; color:var(--blue-800); text-decoration:none; letter-spacing:-0.02em; }
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
      <a href="/" class="nav-logo">Goosie<span>.</span>Labs</a>
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
function generateHomepage() {
  // Read existing WP homepage as base — it has the full design + V-Formation section
  // We update the nav links and strip WP-specific bits
  let html = readFileSync('/tmp/homepage_base.html', 'utf8');

  // Update nav: remove Inloggen, fix hrefs
  html = html.replace(
    /<a href="\/inloggen\/"[^>]*>.*?<\/a>/g, ''
  );
  html = html.replace(
    /<a href="#projecten"[^>]*>Projecten<\/a>/,
    '<a href="#projecten" class="nav-link">Projecten</a>'
  );
  // Update about/contact nav links to .html versions (for nsite path compatibility)
  html = html.replace(/href="\/over-ons\//g, 'href="/about.html"');
  html = html.replace(/href="\/contact\//g, 'href="/contact.html"');

  // Add nsite badge in footer
  html = html.replace(
    /<\/body>/,
    `<script>
      // Mark as nsite-served
      document.documentElement.dataset.nsite = '${npub.slice(0,20)}…';
    </script>\n</body>`
  );

  return html;
}

// ── Contact page (NL) — strip form, keep info ────────────────────────────────
function generateContactNl() {
  const fragment = readFileSync('/tmp/contact_nl.html', 'utf8');
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
  const fragment = readFileSync('/tmp/contact_en.html', 'utf8');
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

// ── About pages — wrap fragment in shell ─────────────────────────────────────
function generateAboutNl() {
  let fragment = readFileSync('/tmp/about_nl.html', 'utf8')
    .replace(/<!-- wp:html -->/g, '')
    .replace(/<link rel="preconnect"[^>]*>/g, '')
    .replace(/<link href="https:\/\/fonts[^>]*>/g, '')
    .replace(/href="\/over-ons\//g, 'href="/about.html"')
    .replace(/href="\/contact\//g, 'href="/contact.html"');
  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Over ons — Goosie Labs</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    nav { position:sticky; top:0; z-index:100; background:rgba(255,255,255,0.96); backdrop-filter:blur(8px); border-bottom:1px solid #ededea; }
    .nav-inner { max-width:1080px; margin:0 auto; padding:0 2rem; height:64px; display:flex; align-items:center; justify-content:space-between; }
    .nav-logo { font-family:'Libre Baskerville',Georgia,serif; font-size:18px; color:#0c447c; text-decoration:none; letter-spacing:-0.02em; }
    .nav-logo span { color:#378add; }
    .nav-links { display:flex; gap:2rem; }
    .nav-link { font-size:14px; font-weight:500; color:#5f5e5a; text-decoration:none; }
    .nav-link:hover { color:#185fa5; }
    footer { border-top:1px solid #ededea; padding:2rem; text-align:center; font-size:0.8rem; color:#888780; }
    footer a { color:#888780; }
    .nsite-badge { display:inline-block; background:#1e1b4b; color:#818cf8; border:1px solid #312e81; border-radius:9999px; padding:1px 8px; font-size:0.65rem; font-weight:700; margin-left:0.5rem; }
  </style>
</head>
<body>
  <nav>
    <div class="nav-inner">
      <a href="/" class="nav-logo">Goosie<span>.</span>Labs</a>
      <div class="nav-links">
        <a href="/" class="nav-link">Home</a>
        <a href="/about.html" class="nav-link" style="color:#185fa5">Over ons</a>
        <a href="/contact.html" class="nav-link">Contact</a>
      </div>
    </div>
  </nav>
  ${fragment}
  <footer>
    <a href="https://goosielabs.com">goosielabs.com</a> ·
    <a href="https://nsite.goosielabs.com">nsite</a>
    <span class="nsite-badge">nsite</span>
  </footer>
</body>
</html>`;
}

function generateAboutEn() {
  let fragment = readFileSync('/tmp/about_en.html', 'utf8')
    .replace(/<!-- wp:html -->/g, '')
    .replace(/<link rel="preconnect"[^>]*>/g, '')
    .replace(/<link href="https:\/\/fonts[^>]*>/g, '')
    .replace(/href="\/over-ons\//g, 'href="/about.html"')
    .replace(/href="\/contact\//g, 'href="/contact.html"');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>About us — Goosie Labs</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    nav { position:sticky; top:0; z-index:100; background:rgba(255,255,255,0.96); backdrop-filter:blur(8px); border-bottom:1px solid #ededea; }
    .nav-inner { max-width:1080px; margin:0 auto; padding:0 2rem; height:64px; display:flex; align-items:center; justify-content:space-between; }
    .nav-logo { font-family:'Libre Baskerville',Georgia,serif; font-size:18px; color:#0c447c; text-decoration:none; letter-spacing:-0.02em; }
    .nav-logo span { color:#378add; }
    .nav-links { display:flex; gap:2rem; }
    .nav-link { font-size:14px; font-weight:500; color:#5f5e5a; text-decoration:none; }
    .nav-link:hover { color:#185fa5; }
    footer { border-top:1px solid #ededea; padding:2rem; text-align:center; font-size:0.8rem; color:#888780; }
    footer a { color:#888780; }
    .nsite-badge { display:inline-block; background:#1e1b4b; color:#818cf8; border:1px solid #312e81; border-radius:9999px; padding:1px 8px; font-size:0.65rem; font-weight:700; margin-left:0.5rem; }
  </style>
</head>
<body>
  <nav>
    <div class="nav-inner">
      <a href="/" class="nav-logo">Goosie<span>.</span>Labs</a>
      <div class="nav-links">
        <a href="/" class="nav-link">Home</a>
        <a href="/about.html" class="nav-link" style="color:#185fa5">About us</a>
        <a href="/contact.html" class="nav-link">Contact</a>
      </div>
    </div>
  </nav>
  ${fragment}
  <footer>
    <a href="https://goosielabs.com">goosielabs.com</a> ·
    <a href="https://nsite.goosielabs.com">nsite</a>
    <span class="nsite-badge">nsite</span>
  </footer>
</body>
</html>`;
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

// ── Main ─────────────────────────────────────────────────────────────────────
console.log('Generating pages…\n');

const pages = {
  '/index.html':      Buffer.from(generateHomepage(), 'utf8'),
  '/about.html':      Buffer.from(generateAboutNl(), 'utf8'),
  '/about-en.html':   Buffer.from(generateAboutEn(), 'utf8'),
  '/contact.html':    Buffer.from(generateContactNl(), 'utf8'),
  '/contact-en.html': Buffer.from(generateContactEn(), 'utf8'),
  '/mcp.html':        Buffer.from(generateArticle('/tmp/mcp_en.html', 'What is MCP?', 'en'), 'utf8'),
  '/bitcoin.html':    Buffer.from(generateArticle('/tmp/bitcoin_nl.html', 'Bitcoin', 'nl'), 'utf8'),
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

console.log(`
\x1b[1m── Next step: switch nginx ───────────────────────────────────────\x1b[0m

Perry's hex pubkey: ${pubkeyHex}

Add this to the goosielabs.com nginx server block
(BEFORE the existing \`location ~ \\.php$\` block):

  # nsite homepage — Perry's decentralized site
  location = / {
      proxy_pass http://127.0.0.1:3340/${pubkeyHex}/index.html;
      proxy_set_header Host nsite.goosielabs.com;
  }
  location ~ ^/(index\\.html|about.*\\.html|contact.*\\.html|mcp\\.html|bitcoin\\.html)$ {
      proxy_pass http://127.0.0.1:3340/${pubkeyHex}$request_uri;
      proxy_set_header Host nsite.goosielabs.com;
  }

Then: sudo nginx -t && sudo nginx -s reload
And:  sudo systemctl stop php8.3-fpm  # (only after verifying nsite works)
`);
