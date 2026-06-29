#!/usr/bin/env node
/**
 * publish-agent-pages.mjs
 *
 * For each agent in ~/.claude/agents/:
 *   1. Parse .md → generate beautiful HTML page
 *   2. Upload photo + HTML to Blossom (BUD-11 auth)
 *   3. Publish Kind 15128 nsite manifest to relay (signed with agent key)
 *   4. Update /home/deploy/agents/<name>/tile.html with nsite link
 *   5. Add new agents to relay whitelist if needed
 *
 * Usage:
 *   node /home/deploy/scripts/publish-agent-pages.mjs [--agent <name>]
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { readdir } from 'fs/promises';
import path from 'path';
import WebSocket from '/home/deploy/nsite-gateway/node_modules/ws/lib/websocket.js';
import { generateQRDataUrl } from './lib/qr-code-util.mjs';

// ── nostr-tools (resolved from this script's own node_modules, not an app's) ──
// Was hardcoded to apps/catchzaps/node_modules — broke when that app changed.
// Stable install lives in /home/deploy/systemsetup/node_modules.
const {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  nip19,
} = await import('nostr-tools');

// ── Config ───────────────────────────────────────────────────────────────────
const AGENTS_DIR   = '/home/deploy/.claude/agents';
const KEYS_DIR     = '/home/deploy/agents';
const BLOSSOM      = 'http://127.0.0.1:3339';
const { INTERNAL_RELAY, PUBLISH_RELAYS: PUBLIC_RELAYS } = await import('./relay-config.mjs');
const RELAY        = INTERNAL_RELAY;
const NSITE_BASE   = 'https://nsite.goosielabs.com';
const WHITELIST    = '/home/deploy/whitelist.json';
const BLOSSOM_CFG  = '/home/deploy/blossom/config.yml';

// ── Colours ──────────────────────────────────────────────────────────────────
const c = {
  ok:   s => `\x1b[32m✓\x1b[0m ${s}`,
  err:  s => `\x1b[31m✗\x1b[0m ${s}`,
  info: s => `\x1b[36m→\x1b[0m ${s}`,
  warn: s => `\x1b[33m⚠\x1b[0m ${s}`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
};

// ── Per-agent accent colors (matches homepage) ────────────────────────────────
const AGENT_COLORS = {
  assistenty: '#6366f1', devy: '#0ea5e9', finny: '#10b981', ay: '#f59e0b',
  jurry: '#8b5cf6', secury: '#ef4444', testy: '#ec4899', checky: '#14b8a6',
  commy: '#f97316', designy: '#a855f7', nosty: '#06b6d4', docy: '#64748b',
  transy: '#e11d48',
};

function hexToRgb(hex) {
  return { r: parseInt(hex.slice(1,3),16), g: parseInt(hex.slice(3,5),16), b: parseInt(hex.slice(5,7),16) };
}
function darken(hex, f) {
  const {r,g,b} = hexToRgb(hex);
  const h = v => Math.round(v*(1-f)).toString(16).padStart(2,'0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
function lighten(hex, f) {
  const {r,g,b} = hexToRgb(hex);
  const h = v => Math.round(v+(255-v)*f).toString(16).padStart(2,'0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

// ── Parse frontmatter ─────────────────────────────────────────────────────────
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
    meta[key] = val;
  }
  return { meta, body: match[2].trim() };
}

// ── Markdown → HTML (basic) ──────────────────────────────────────────────────
function mdToHtml(md) {
  let html = md;

  // Fenced code blocks — must come before inline code
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const cls = lang ? ` class="language-${lang}"` : '';
    return `<pre><code${cls}>${escaped}</code></pre>`;
  });

  // Tables — detect lines with pipes
  html = html.replace(/((?:\|[^\n]+\|\n)+)/g, tableBlock => {
    const rows = tableBlock.trim().split('\n');
    let out = '<table>';
    rows.forEach((row, i) => {
      if (/^[\|\s\-:]+$/.test(row)) return; // separator row
      const cells = row.replace(/^\||\|$/g,'').split('|').map(c => c.trim());
      if (i === 0) {
        out += '<thead><tr>' + cells.map(c=>`<th>${inlineMd(c)}</th>`).join('') + '</tr></thead><tbody>';
      } else {
        out += '<tr>' + cells.map(c=>`<td>${inlineMd(c)}</td>`).join('') + '</tr>';
      }
    });
    out += '</tbody></table>';
    return out;
  });

  // Headers
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Unordered lists
  html = html.replace(/((?:^[ \t]*[-*+] .+\n?)+)/gm, block => {
    const items = block.trim().split('\n').map(line => {
      const text = line.replace(/^[ \t]*[-*+] /, '');
      return `<li>${inlineMd(text)}</li>`;
    });
    return `<ul>${items.join('')}</ul>`;
  });

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>');

  // Paragraphs — wrap blocks of text not already in block elements
  const blockTags = /^<(h[1-6]|ul|ol|li|pre|table|thead|tbody|tr|th|td|hr|blockquote)/;
  const paras = html.split(/\n\n+/);
  html = paras.map(p => {
    p = p.trim();
    if (!p) return '';
    if (blockTags.test(p)) return p;
    return `<p>${inlineMd(p)}</p>`;
  }).join('\n');

  return html;
}

function inlineMd(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

// ── Generate agent HTML ───────────────────────────────────────────────────────
async function generateHtml({ name, meta, bodyHtml, photoUrl, npub, nsiteUrl }) {
  const title = meta.name
    ? meta.name.charAt(0).toUpperCase() + meta.name.slice(1)
    : name.charAt(0).toUpperCase() + name.slice(1);

  const description = meta.description || '';
  const avatarHtml = photoUrl
    ? `<img class="avatar" src="${photoUrl}" alt="${title}" onerror="this.style.display='none'">`
    : `<div class="avatar-fallback">${title[0]}</div>`;

  const accent = AGENT_COLORS[name] ?? '#6366f1';

  // Generate QR code for npub
  let qrHtml = '';
  if (npub) {
    try {
      const qrDataUrl = await generateQRDataUrl(npub, { width: 200 });
      if (qrDataUrl) {
        qrHtml = `<div class="qr-section"><img class="qr-code" src="${qrDataUrl}" alt="QR code for ${npub}" title="Scan to load ${title} in your Nostr client"></div>`;
      }
    } catch (err) {
      console.warn(`Failed to generate QR code for ${name}:`, err);
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Goosie Labs V-Formation</title>
  <meta name="description" content="${description.replace(/"/g,'&quot;')}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --blue-50:#E6F1FB; --blue-100:#B5D4F4; --blue-200:#85B7EB;
      --blue-400:#378ADD; --blue-600:#185FA5; --blue-800:#0C447C; --blue-900:#042C53;
      --gray-50:#F8F8F6; --gray-100:#EDEDEA; --gray-200:#D3D1C7;
      --gray-400:#888780; --gray-600:#5F5E5A; --gray-800:#2C2C2A;
      --white:#FFFFFF;
      --font-display:'Libre Baskerville',Georgia,serif;
      --font-body:'DM Sans',system-ui,sans-serif;
    }
    body { font-family:var(--font-body); background:var(--white); color:var(--gray-800); font-size:16px; line-height:1.7; -webkit-font-smoothing:antialiased; }
    a { color:var(--blue-400); text-decoration:none; }
    a:hover { color:var(--blue-600); text-decoration:underline; }

    /* NAV */
    nav { position:sticky; top:0; z-index:100; background:rgba(255,255,255,0.96); backdrop-filter:blur(8px); border-bottom:1px solid var(--gray-100); }
    .nav-inner { max-width:1080px; margin:0 auto; padding:0 2rem; height:64px; display:flex; align-items:center; justify-content:space-between; }
    .nav-logo { font-family:var(--font-display); font-size:18px; color:var(--blue-800); letter-spacing:-0.02em; cursor:default; }
    .nav-logo span { color:var(--blue-400); }
    .nav-back { font-size:14px; font-weight:500; color:var(--gray-600); text-decoration:none; transition:color 0.2s; display:inline-flex; align-items:center; gap:0.4rem; }
    .nav-back:hover { color:var(--blue-600); text-decoration:none; }

    /* HERO */
    .hero { background:linear-gradient(160deg,var(--blue-900) 0%,var(--blue-800) 50%,var(--blue-600) 100%); color:var(--white); padding:4rem 2rem 3.5rem; text-align:center; position:relative; overflow:hidden; }
    .hero::before { content:''; position:absolute; top:-80px; right:-80px; width:360px; height:360px; border-radius:50%; background:rgba(55,138,221,0.15); pointer-events:none; }
    .hero-inner { max-width:640px; margin:0 auto; position:relative; z-index:1; }
    .avatar { width:96px; height:96px; border-radius:50%; border:3px solid rgba(255,255,255,0.4); object-fit:cover; margin-bottom:1.25rem; }
    .avatar-fallback { width:96px; height:96px; border-radius:50%; background:${accent}; color:#fff; font-size:2.5rem; font-weight:800; display:inline-flex; align-items:center; justify-content:center; margin-bottom:1.25rem; font-family:var(--font-display); }
    .hero h1 { font-family:var(--font-display); font-size:2.4rem; font-weight:700; letter-spacing:-0.02em; color:var(--white); margin-bottom:0.75rem; }
    .hero .role { font-size:1rem; color:var(--blue-200); max-width:520px; margin:0 auto 1.25rem; line-height:1.6; }
    .npub-badge { display:inline-block; font-family:'Courier New',monospace; font-size:0.65rem; color:rgba(255,255,255,0.5); background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.15); border-radius:9999px; padding:0.2rem 0.75rem; word-break:break-all; }

    /* QR CODE */
    .qr-section { margin:1.5rem 0 0; }
    .qr-code { width:160px; height:160px; background:white; padding:8px; border-radius:8px; display:inline-block; cursor:pointer; transition:transform 0.2s; }
    .qr-code:hover { transform:scale(1.05); }

    /* CONTENT */
    .content-wrap { max-width:780px; margin:0 auto; padding:3rem 2rem 5rem; }

    h1,h2,h3,h4 { font-family:var(--font-display); font-weight:700; color:var(--blue-900); margin-top:2rem; margin-bottom:0.5rem; }
    h1 { font-size:1.6rem; border-bottom:1px solid var(--gray-100); padding-bottom:0.5rem; }
    h2 { font-size:1.25rem; color:var(--blue-800); }
    h3 { font-size:1rem; color:var(--blue-600); }
    h4 { font-size:0.9rem; color:var(--gray-600); }

    p { margin-bottom:1rem; color:var(--gray-800); }
    ul,ol { margin:0.75rem 0 1rem 1.5rem; color:var(--gray-800); }
    li { margin-bottom:0.3rem; }
    strong { color:var(--blue-900); font-weight:600; }
    em { color:var(--gray-600); }
    hr { border:none; border-top:1px solid var(--gray-100); margin:2rem 0; }

    code { background:var(--blue-50); color:var(--blue-800); border-radius:4px; padding:0.1em 0.4em; font-family:'Courier New',monospace; font-size:0.85em; }
    pre { background:var(--gray-50); border:1px solid var(--gray-100); border-radius:0.5rem; padding:1rem 1.25rem; overflow-x:auto; margin:1rem 0; }
    pre code { background:none; color:var(--gray-600); padding:0; font-size:0.82em; line-height:1.6; }

    table { width:100%; border-collapse:collapse; margin:1rem 0; font-size:0.875rem; }
    th { background:var(--gray-50); color:var(--gray-600); text-align:left; padding:0.5rem 0.75rem; font-weight:600; border-bottom:1px solid var(--gray-200); }
    td { padding:0.45rem 0.75rem; border-bottom:1px solid var(--gray-100); color:var(--gray-800); }
    tr:last-child td { border-bottom:none; }

    /* FOOTER */
    footer { border-top:1px solid var(--gray-100); padding:2rem; text-align:center; font-size:0.8rem; color:var(--gray-400); }
    footer a { color:var(--gray-400); }
    .nsite-tag { display:inline-block; background:var(--blue-50); color:var(--blue-600); border:1px solid var(--blue-100); border-radius:9999px; padding:2px 10px; font-size:0.7rem; font-weight:700; margin-left:0.5rem; }
  </style>
</head>
<body>
  <nav>
    <div class="nav-inner">
      <span class="nav-logo">Goosie<span>.</span>Labs</span>
      <a href="https://goosielabs.com/#formation" class="nav-back">← Back to V-Formation</a>
    </div>
  </nav>

  <div class="hero">
    <div class="hero-inner">
      ${avatarHtml}
      <h1>${title}</h1>
      <p class="role">${description}</p>
      ${npub ? `<div class="npub-badge">${npub}</div>` : ''}
      ${qrHtml}
    </div>
  </div>

  <div class="content-wrap">
    ${bodyHtml}
  </div>

  <footer>
    <a href="https://goosielabs.com">goosielabs.com</a> ·
    <a href="https://nsite.goosielabs.com">nsite.goosielabs.com</a>
    <span class="nsite-tag">nsite</span>
    <br><br>
    Hosted on Nostr · <a href="${nsiteUrl}" target="_blank">View on nsite</a>
  </footer>
</body>
</html>`;
}

// ── SHA256 of buffer ──────────────────────────────────────────────────────────
function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

// ── Base64url encode ──────────────────────────────────────────────────────────
function base64url(str) {
  return Buffer.from(str).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── Build BUD-11 Kind 24242 auth event ────────────────────────────────────────
function buildUploadAuth(nsecHex, sha256hex, filename) {
  const sk = Buffer.from(nsecHex, 'hex');
  const now = Math.floor(Date.now() / 1000);
  const template = {
    kind: 24242,
    created_at: now,
    tags: [
      ['t', 'upload'],
      ['x', sha256hex],
      ['expiration', String(now + 3600)],
    ],
    content: `Upload ${filename}`,
  };
  return finalizeEvent(template, sk);
}

// ── Upload file to Blossom ────────────────────────────────────────────────────
async function uploadToBlossom(buf, contentType, filename, nsecHex) {
  const hash = sha256(buf);

  // Check if already uploaded
  const headRes = await fetch(`${BLOSSOM}/${hash}`, { method: 'HEAD' });
  if (headRes.ok) {
    console.log(c.info(`  Blossom: ${filename} already exists (${hash.slice(0,8)}…)`));
    return hash;
  }

  const authEvent = buildUploadAuth(nsecHex, hash, filename);
  const authHeader = `Nostr ${base64url(JSON.stringify(authEvent))}`;

  const res = await fetch(`${BLOSSOM}/upload`, {
    method: 'PUT',
    headers: {
      'Authorization': authHeader,
      'Content-Type': contentType,
      'Content-Length': String(buf.length),
      'X-SHA-256': hash,
    },
    body: buf,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Blossom upload failed ${res.status}: ${body}`);
  }

  const json = await res.json();
  console.log(c.ok(`  Blossom: ${filename} → ${hash.slice(0,8)}… (${(buf.length/1024).toFixed(1)}KB)`));
  return hash;
}

// ── Publish nsite manifest (Kind 15128) to relay ─────────────────────────────
function publishToRelay(event, relayUrl) {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(relayUrl);
      const timer = setTimeout(() => { ws.terminate(); resolve({ url: relayUrl, ok: false, err: 'timeout' }); }, 8000);
      ws.on('open', () => ws.send(JSON.stringify(['EVENT', event])));
      ws.on('message', raw => {
        const msg = JSON.parse(raw.toString());
        if (msg[0] === 'OK') { clearTimeout(timer); ws.close(); resolve({ url: relayUrl, ok: msg[2], err: msg[3] }); }
      });
      ws.on('error', e => { clearTimeout(timer); resolve({ url: relayUrl, ok: false, err: e.message }); });
    } catch (e) {
      resolve({ url: relayUrl, ok: false, err: e.message });
    }
  });
}

async function publishNsiteManifest(nsecHex, files) {
  const sk = Buffer.from(nsecHex, 'hex');
  const tags = Object.entries(files).map(([filePath, sha256]) => ['path', filePath, sha256]);
  const event = finalizeEvent({
    kind: 15128,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  }, sk);

  // Internal relay first (required for local nsite gateway)
  const internal = await publishToRelay(event, RELAY);
  if (!internal.ok) throw new Error(`Internal relay rejected manifest: ${internal.err}`);

  // Public relays for external nsite servers
  const pubResults = await Promise.all(PUBLIC_RELAYS.map(r => publishToRelay(event, r)));
  const okCount = pubResults.filter(r => r.ok).length;
  console.log(c.ok(`  Published to ${okCount}/${PUBLIC_RELAYS.length} public relays`));

  return event;
}

// ── Load or generate agent keypair ───────────────────────────────────────────
function loadOrCreateKey(name) {
  const dir = path.join(KEYS_DIR, name);
  const keyFile = path.join(dir, 'nostr-key.json');

  if (existsSync(keyFile)) {
    return JSON.parse(readFileSync(keyFile, 'utf8'));
  }

  // Generate new keypair
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const nsecHex = Buffer.from(sk).toString('hex');
  const npub = nip19.npubEncode(pk);
  const nsec = nip19.nsecEncode(sk);

  const key = { pubkey: pk, npub, nsec, nsecHex };

  mkdirSync(dir, { recursive: true });
  writeFileSync(keyFile, JSON.stringify(key, null, 2));
  console.log(c.ok(`  Created new keypair for ${name}: ${npub}`));
  return key;
}

// ── Add pubkey to relay whitelist ────────────────────────────────────────────
function ensureWhitelisted(pubkey) {
  const wl = JSON.parse(readFileSync(WHITELIST, 'utf8'));
  const values = Object.values(wl);
  if (values.includes(pubkey)) return false;
  // whitelist.json is a name→pubkey object — don't auto-add unknown keys
  return false;
}

// ── Add pubkey to Blossom config ──────────────────────────────────────────────
function ensureBlossomAllowed(pubkey, name) {
  let cfg = readFileSync(BLOSSOM_CFG, 'utf8');
  if (cfg.includes(pubkey)) return false;

  // Add to both image/* and */* sections — insert before "image/*" line for public users
  const insertLine = `        - "${pubkey}"  # ${name}\n`;
  // Find the two pubkeys sections and add before the public rules
  cfg = cfg.replace(
    /(pubkeys:\n(?:        - "[0-9a-f]+"\s*#[^\n]*\n)+)(    - type: "image\/\*"\n      expiration: 30)/g,
    (_, pubkeySection, publicRule) => {
      return pubkeySection + insertLine + '    - type: "image/*"\n      expiration: 30';
    }
  );
  writeFileSync(BLOSSOM_CFG, cfg);
  return true;
}

// ── Update tile.html with nsite link and QR code ───────────────────────────────
async function updateTileHtml(name, npub, nsiteUrl) {
  const dir = path.join(KEYS_DIR, name);
  const tileFile = path.join(dir, 'tile.html');
  mkdirSync(dir, { recursive: true });

  const title = name.charAt(0).toUpperCase() + name.slice(1);

  // Generate QR code for npub
  let qrHtml = '';
  try {
    const qrDataUrl = await generateQRDataUrl(npub, { width: 180 });
    if (qrDataUrl) {
      qrHtml = `  <div class="agent-qr" style="margin:1rem 0; text-align:center;">\n    <img src="${qrDataUrl}" alt="QR code for ${npub}" title="Scan to open ${title} in Nostr client" style="width:140px; height:140px; display:inline-block; border-radius:4px;">\n  </div>\n`;
    }
  } catch (err) {
    console.warn(`  Warning: Failed to generate QR code for ${name}: ${err.message}`);
  }

  const nsiteLink = `  <div class="agent-links">\n    <a href="${nsiteUrl}" class="agent-link agent-link-nsite" target="_blank" rel="noopener">Meet ${title}</a>\n  </div>`;

  if (existsSync(tileFile)) {
    let existing = readFileSync(tileFile, 'utf8');
    // Remove old nsite link and QR code blocks if present
    existing = existing.replace(/\n?  <div class="agent-qr"[\s\S]*?<\/div>\n/, '');
    existing = existing.replace(/\n?  <div class="agent-links">[\s\S]*?<\/div>/, '');
    // Append QR code and link before the final closing </div> (agent-card)
    const updated = existing.replace(/<\/div>\s*$/, `\n${qrHtml}${nsiteLink}\n</div>`);
    writeFileSync(tileFile, updated);
  } else {
    writeFileSync(tileFile, `<div class="agent-card" data-agent="${name}">
  <div class="agent-avatar">
    <img src="${name}.jpg" alt="${title}" onerror="this.style.display='none'">
  </div>
  <div class="agent-body">
    <h3 class="agent-name">${title}</h3>
    <span class="agent-title">V-Formation Agent</span>
  </div>
${qrHtml}${nsiteLink}
</div>`);
  }
  console.log(c.ok(`  tile.html updated → ${nsiteUrl}`));
}

// ── Main ─────────────────────────────────────────────────────────────────────
const agentFlagIdx = process.argv.indexOf('--agent');
const targetAgent = agentFlagIdx !== -1 ? process.argv[agentFlagIdx + 1] : null;

const agentFiles = (await readdir(AGENTS_DIR))
  .filter(f => f.endsWith('.md'))
  .map(f => f.replace('.md', ''))
  .filter(n => !targetAgent || n === targetAgent);

console.log(c.bold(`\n🪿 Publishing ${agentFiles.length} agent pages to nsite\n`));

const results = [];
let blossomNeedsRestart = false;

for (const name of agentFiles) {
  console.log(c.bold(`\n── ${name} ──`));

  // 1. Read & parse .md
  const mdPath = path.join(AGENTS_DIR, `${name}.md`);
  const raw = readFileSync(mdPath, 'utf8');
  const { meta, body } = parseFrontmatter(raw);

  // 2. Load or create keypair
  const key = loadOrCreateKey(name);

  // 3. Whitelist in relay + Blossom
  const wasNewRelay = ensureWhitelisted(key.pubkey);
  if (wasNewRelay) console.log(c.ok(`  Added ${name} to relay whitelist`));

  const wasNewBlossom = ensureBlossomAllowed(key.pubkey, name);
  if (wasNewBlossom) {
    console.log(c.ok(`  Added ${name} to Blossom config`));
    blossomNeedsRestart = true;
  }

  // 4. Find photo
  const photoPath = path.join(KEYS_DIR, name, `${name}.jpg`);
  let photoHash = null;
  if (existsSync(photoPath)) {
    try {
      const photoBuf = readFileSync(photoPath);
      photoHash = await uploadToBlossom(photoBuf, 'image/jpeg', `${name}.jpg`, key.nsecHex);
    } catch (e) {
      console.log(c.warn(`  Photo upload failed: ${e.message}`));
    }
  }

  // 5. Generate HTML
  const nsiteUrl = `${NSITE_BASE}/${key.npub}/`;
  const photoUrl = photoHash ? `${BLOSSOM}/${photoHash}` : null;
  const bodyHtml = mdToHtml(body);
  const html = await generateHtml({
    name,
    meta,
    bodyHtml,
    photoUrl,
    npub: key.npub,
    nsiteUrl,
  });

  // 6. Upload HTML to Blossom
  const htmlBuf = Buffer.from(html, 'utf8');
  let htmlHash;
  try {
    htmlHash = await uploadToBlossom(htmlBuf, 'text/html', 'index.html', key.nsecHex);
  } catch (e) {
    console.log(c.err(`  HTML upload failed: ${e.message}`));
    console.log(c.warn(`  Skipping nsite publish for ${name}`));
    results.push({ name, url: null, error: e.message });
    continue;
  }

  // 7. Build manifest files map
  const files = { '/index.html': htmlHash };
  if (photoHash) files[`/${name}.jpg`] = photoHash;

  // 8. Publish Kind 15128 manifest
  try {
    await publishNsiteManifest(key.nsecHex, files);
    console.log(c.ok(`  Kind 15128 published → ${nsiteUrl}`));
  } catch (e) {
    console.log(c.err(`  Manifest publish failed: ${e.message}`));
    results.push({ name, url: null, error: e.message });
    continue;
  }

  // 9. Update tile.html
  await updateTileHtml(name, key.npub, nsiteUrl);

  results.push({ name, url: nsiteUrl });
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(c.bold('\n── Results ──────────────────────────────────────────\n'));
for (const r of results) {
  if (r.url) {
    console.log(c.ok(`${r.name.padEnd(12)} ${r.url}`));
  } else {
    console.log(c.err(`${r.name.padEnd(12)} FAILED: ${r.error}`));
  }
}

if (blossomNeedsRestart) {
  console.log(c.warn('\nBlossom config updated — restart required for permanent storage:'));
  console.log('  sudo systemctl restart blossom');
}

console.log('');
