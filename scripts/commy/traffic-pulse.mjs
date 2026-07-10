#!/usr/bin/env node
/**
 * traffic-pulse.mjs — Commy's daily visitor pulse
 *
 * Reads today's nginx access log, strips out bot/scanner noise, and DMs Perry
 * a short honest summary of REAL human visitors to the Goosie Labs apps.
 *
 * Honesty notes baked in:
 *   - Exploit scanners (wp-admin, /.env, xmlrpc, cgi-bin ...) are counted
 *     separately as noise, never as "visitors".
 *   - The homepage goosielabs.com is served via nsite/Blossom, NOT this nginx,
 *     so those visits do not appear here — the DM says so.
 *
 * Run (needs root to read /var/log/nginx):  sudo node scripts/commy/traffic-pulse.mjs
 * Preview without sending:                   sudo node scripts/commy/traffic-pulse.mjs --dry-run
 * Scheduled daily via Blocky (144 blocks).
 */

import { readFileSync, existsSync, statSync, writeFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import maxmind from 'maxmind';
import { loadGeese, gather, totals } from './traction-lib.mjs';

const GEO_DB      = '/home/deploy/data/geo/dbip-country-lite.mmdb';
const NOSTR_TOOLS = '/var/www/goosielabs/apps/skein/node_modules/nostr-tools/lib/esm/index.js';
const WS_PATH     = '/home/deploy/nsite-gateway/node_modules/ws/lib/websocket.js';
const COMMY_KEY   = '/home/deploy/agents/commy/nostr-key.json';
const WHITELIST   = '/home/deploy/whitelist.json';
const RELAY       = 'ws://127.0.0.1:7778';
const LOG         = '/var/log/nginx/access.log';

const DRY_RUN = process.argv.includes('--dry-run');

// Lines that are exploit/vuln scanners — noise, never a real visitor.
const NOISE_RE = /xmlrpc|wp-admin|wp-json|wp-login|wp-includes|\/\.env|\/\.git|cgi-bin|install\.php|phpmyadmin|\/vendor\/|eval-stdin|libredtail|l9explore/i;
// User agents that are clearly non-human.
const BOT_UA_RE = /bot|crawl|spider|slurp|Bun\/|Deno\/|python|curl|wget|Go-http|libredtail|l9explore|scan|masscan|zgrab|HeadlessChrome/i;
// A real browser leaves one of these in the UA.
const BROWSER_RE = /Mozilla|Safari|Chrome|Firefox|Edg|OPR/i;

function parse() {
  let raw;
  try { raw = readFileSync(LOG, 'utf8'); }
  catch (e) { console.error(`Cannot read ${LOG}: ${e.message} (run with sudo)`); process.exit(1); }

  const lines = raw.split('\n').filter(Boolean);
  let noise = 0;
  const appHits = {};          // app -> count
  const refHits = {};          // referrer host -> count
  const humanIps = new Set();
  let humanViews = 0;

  for (const line of lines) {
    if (NOISE_RE.test(line)) { noise++; continue; }
    // Only care about real app opens with a real browser UA.
    if (!/GET \/apps\//.test(line)) continue;
    if (!BROWSER_RE.test(line) || BOT_UA_RE.test(line)) continue;

    const ip = line.split(' ')[0];
    const m = line.match(/\/apps\/([a-z0-9-]+)/i);
    if (!m) continue;

    humanViews++;
    humanIps.add(ip);
    const app = m[1].toLowerCase();
    appHits[app] = (appHits[app] || 0) + 1;

    // Referrer = 4th quoted field in the combined log format.
    const q = line.split('"');
    let ref = (q[3] || '-').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!ref || ref === '-') ref = '(direct)';
    refHits[ref] = (refHits[ref] || 0) + 1;
  }

  const top    = Object.entries(appHits).sort((a, b) => b[1] - a[1]);
  const topRef = Object.entries(refHits).sort((a, b) => b[1] - a[1]);
  return { total: lines.length, noise, humanViews, uniqueVisitors: humanIps.size,
           top, topRef, ips: [...humanIps] };
}

// Keep the country DB fresh — DB-IP publishes a new free file each month.
// Re-downloads at most once per calendar month; keeps the old DB on any failure.
async function ensureGeoDb() {
  const now = new Date();
  const ym  = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  if (existsSync(GEO_DB)) {
    const m    = statSync(GEO_DB).mtime;
    const dbYm = `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}`;
    if (dbYm === ym) return; // already refreshed this month
  }
  try {
    const res = await fetch(`https://download.db-ip.com/free/dbip-country-lite-${ym}.mmdb.gz`);
    if (!res.ok) return; // this month's file not up yet → keep existing DB
    const gz = Buffer.from(await res.arrayBuffer());
    writeFileSync(GEO_DB, gunzipSync(gz));
  } catch { /* offline / download failed → keep existing DB */ }
}

// Compact flock-wide Nostr traction (followers/reactions/zaps) — best-effort, skipped on failure.
async function addTraction(s) {
  s.traction = null;
  try {
    const t = totals(await gather(loadGeese()));
    s.traction = t;
  } catch { /* relays slow/unreachable → just omit the line */ }
}

// Country per UNIQUE visitor IP — fully offline (DB-IP local mmdb, country only).
async function addGeo(s) {
  s.countries = [];
  let reader;
  try { reader = await maxmind.open(GEO_DB); }
  catch { return; } // no DB → silently skip the geo line
  const tally = {};
  for (const ip of s.ips) {
    let name = 'Unknown';
    try {
      const r = reader.get(ip);
      name = r?.country?.names?.en || r?.country?.iso_code || 'Unknown';
    } catch { /* unparseable ip */ }
    tally[name] = (tally[name] || 0) + 1;
  }
  s.countries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
}

function buildMessage(s) {
  if (s.uniqueVisitors === 0) {
    return [
      `🪿 Commy's visitor pulse — quiet day`,
      ``,
      `No real human app-visits landed today (after filtering ${s.noise} bot/scanner probes out of ${s.total} raw hits).`,
      ``,
      `Note: the homepage is served via Blossom, not nginx — so top-of-funnel visits don't show here.`,
    ].join('\n');
  }

  const appList = s.top.slice(0, 6)
    .map(([app, n]) => `  • ${app} — ${n}`)
    .join('\n');

  const refList = s.topRef.slice(0, 5)
    .map(([ref, n]) => `  • ${ref} — ${n}`)
    .join('\n');

  return [
    `🪿 Commy's visitor pulse — real humans today`,
    ``,
    `👤 ${s.uniqueVisitors} unique visitor${s.uniqueVisitors === 1 ? '' : 's'} · ${s.humanViews} app view${s.humanViews === 1 ? '' : 's'}`,
    `🤖 ${s.noise} bot/scanner probes stripped out (of ${s.total} raw hits)`,
    ``,
    `Apps they opened:`,
    appList,
    ``,
    `Where they came from:`,
    refList,
    ``,
    ...(s.countries && s.countries.length ? [
      `Where in the world:`,
      s.countries.slice(0, 6).map(([c, n]) => `  • ${c} — ${n}`).join('\n'),
      ``,
    ] : []),
    ...(s.traction ? [
      `🪿 Nostr traction (flock): ${s.traction.followers}👤 ${s.traction.reactions}❤️ ${s.traction.zaps}⚡`
        + (s.traction.top.length ? `  · top: ${s.traction.top.map(t => t.name).join(', ')}` : ''),
      `(full per-goose breakdown in the weekly pulse)`,
      ``,
    ] : []),
    `Caveat: some datacenter IPs fake a browser — true human count may be lower.`,
    `Blind spot: the homepage runs on Blossom, not nginx — those visits aren't counted here.`,
  ].join('\n');
}

async function sendDM(toPubkey, message) {
  const commyKey  = JSON.parse(readFileSync(COMMY_KEY, 'utf8'));
  const commyPriv = Buffer.from(commyKey.nsecHex, 'hex');
  const { nip17 }  = await import(NOSTR_TOOLS);
  const WebSocket  = (await import(WS_PATH)).default;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY);
    ws.on('open', () => {
      const wrapped = nip17.wrapEvent(commyPriv, { publicKey: toPubkey }, message);
      ws.send(JSON.stringify(['EVENT', wrapped]));
    });
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg[0] === 'OK') { ws.close(); resolve(); }
    });
    ws.on('error', (e) => { ws.close(); reject(new Error(e.message)); });
    setTimeout(() => { ws.close(); resolve(); }, 8_000);
  });
}

(async () => {
  const stats = parse();
  await ensureGeoDb();
  await addGeo(stats);
  await addTraction(stats);
  const message = buildMessage(stats);

  if (DRY_RUN) {
    console.log('--- DRY RUN (not sent) ---\n');
    console.log(message);
    return;
  }

  const wl = JSON.parse(readFileSync(WHITELIST, 'utf8'));
  const perry = wl.perry_goosie;
  if (!perry) { console.error('No perry_goosie pubkey in whitelist.json'); process.exit(1); }

  await sendDM(perry, message);
  // Neutral stdout on purpose — the numbers stay in the private DM, never on the public relay.
  console.log('✅ Visitor pulse delivered to Perry via private DM.');
})();
