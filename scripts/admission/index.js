/**
 * Goosie Labs — Admission DVM
 *
 * Twee taken:
 * 1. REST API (port 3004) — clients checken admission status
 * 2. Nostr relay listener — verwerkt admission requests (kind 30078)
 *
 * Flow:
 *   User publiceert kind 30078 met d-tag "goosielabs-admission" → relay accepteert (open kind)
 *   Deze DVM ziet het verzoek → valideert app-tag → voegt pubkey toe aan whitelist.json
 *   DVM publiceert bevestiging (kind 30078, d-tag "goosielabs-admission-approved-{pubkey}")
 *   Client-side hook ziet bevestiging → "Admitted"
 *
 * Env:
 *   ADMISSION_PORT  — default 3004
 *   RELAY_URL       — default wss://goosielabs.com/relay
 *   WHITELIST_PATH  — default /home/deploy/whitelist.json
 *   PERRY_PUBKEY    — Perry's pubkey, krijgt DM-notificatie bij admission
 */

import 'websocket-polyfill';
import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { generateSecretKey, getPublicKey, finalizeEvent, SimplePool } from 'nostr-tools';

const PORT        = parseInt(process.env.ADMISSION_PORT ?? '3004', 10);
const RELAY_URL   = process.env.RELAY_URL       ?? 'wss://goosielabs.com/relay';
const WHITELIST   = process.env.WHITELIST_PATH  ?? '/home/deploy/whitelist.json';
const PERRY_PUBKEY = process.env.PERRY_PUBKEY   ?? 'a80398e86c03ffadc7030fe135ee7614b6fabb204fc0f6641838fb4b8abf0b0c';

// Alle bekende Goosie Labs apps — verzoeken met deze tag worden auto-approved
const KNOWN_APPS = new Set([
  'bookwriter', 'dilemma', 'feedback', 'ididhere', 'lastwill',
  'nospass', 'proofofmove', 'sofia', 'weddendat', 'zap-hunt',
  'zaphunt', 'zinin',
]);

// Admission DVM keypair — persisted in dvm.key
let DVM_SECRET_KEY;
const KEY_FILE = new URL('./dvm.key', import.meta.url).pathname;
try {
  const hex = readFileSync(KEY_FILE, 'utf8').trim();
  DVM_SECRET_KEY = new Uint8Array(hex.match(/.{2}/g).map(b => parseInt(b, 16)));
} catch {
  DVM_SECRET_KEY = generateSecretKey();
  const hex = Array.from(DVM_SECRET_KEY).map(b => b.toString(16).padStart(2, '0')).join('');
  writeFileSync(KEY_FILE, hex, 'utf8');
  console.log('🔑  Nieuw admission-DVM keypair aangemaakt');
}
const DVM_PUBKEY = getPublicKey(DVM_SECRET_KEY);
console.log(`🛂  Admission DVM pubkey: ${DVM_PUBKEY}`);

// ─── Whitelist beheer ─────────────────────────────────────────────────────────

function loadWhitelist() {
  try {
    if (!existsSync(WHITELIST)) return [];
    return JSON.parse(readFileSync(WHITELIST, 'utf8'));
  } catch { return []; }
}

function isAdmitted(pubkey) {
  return loadWhitelist().includes(pubkey);
}

function addToWhitelist(pubkey) {
  const list = loadWhitelist();
  if (list.includes(pubkey)) return false;
  list.push(pubkey);
  writeFileSync(WHITELIST, JSON.stringify(list, null, 2), 'utf8');
  console.log(`✅  Toegevoegd aan whitelist: ${pubkey.slice(0, 16)}...`);
  return true;
}

// ─── Nostr helpers ────────────────────────────────────────────────────────────

async function publishConfirmation(pool, userPubkey, appName) {
  const event = finalizeEvent({
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    pubkey: DVM_PUBKEY,
    tags: [
      ['d', `goosielabs-admission-approved-${userPubkey}`],
      ['p', userPubkey],
      ['app', appName],
      ['relay', RELAY_URL],
      ['status', 'approved'],
    ],
    content: 'Toegelaten tot Goosie Labs relay',
  }, DVM_SECRET_KEY);

  await Promise.allSettled(pool.publish([RELAY_URL], event));
  console.log(`📡  Bevestiging gepubliceerd voor ${userPubkey.slice(0, 16)}...`);
  return event;
}

async function processAdmissionRequest(pool, event) {
  const { pubkey, tags } = event;
  const appName = tags.find(t => t[0] === 'app')?.[1] ?? 'onbekend';

  // Al admitted?
  if (isAdmitted(pubkey)) {
    console.log(`ℹ️   Al admitted: ${pubkey.slice(0, 16)}... (${appName})`);
    // Publiceer toch bevestiging — client vraagt misschien opnieuw
    await publishConfirmation(pool, pubkey, appName);
    return;
  }

  // Auto-approve als van bekende Goosie app
  if (KNOWN_APPS.has(appName)) {
    addToWhitelist(pubkey);
    await publishConfirmation(pool, pubkey, appName);
    console.log(`🎉  Auto-approved: ${pubkey.slice(0, 16)}... via ${appName}`);
  } else {
    // Onbekende app — log voor handmatige review
    console.warn(`⚠️   Onbekende app "${appName}" van ${pubkey.slice(0, 16)}... — handmatige review nodig`);
    console.warn(`     Voeg toe: node -e "require('./index.js').admit('${pubkey}')" of wijzig whitelist.json`);
  }
}

// ─── REST API ─────────────────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', dvmPubkey: DVM_PUBKEY, relay: RELAY_URL });
});

// Check of een pubkey admitted is
app.get('/api/admission/check/:pubkey', (req, res) => {
  const { pubkey } = req.params;
  if (!/^[0-9a-f]{64}$/.test(pubkey)) {
    return res.status(400).json({ error: 'Ongeldige pubkey' });
  }
  res.json({ admitted: isAdmitted(pubkey), pubkey });
});

// Handmatige admission (voor Perry)
app.post('/api/admission/approve', (req, res) => {
  const { pubkey, secret } = req.body;
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Niet geautoriseerd' });
  }
  if (!/^[0-9a-f]{64}$/.test(pubkey)) {
    return res.status(400).json({ error: 'Ongeldige pubkey' });
  }
  const added = addToWhitelist(pubkey);
  res.json({ success: true, added, pubkey });
});

// Overzicht van de whitelist (voor Perry)
app.get('/api/admission/list', (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Niet geautoriseerd' });
  }
  res.json({ pubkeys: loadWhitelist(), count: loadWhitelist().length });
});

app.listen(PORT, () => {
  console.log(`🌐  Admission REST API actief op http://localhost:${PORT}`);
});

// ─── Nostr relay listener ─────────────────────────────────────────────────────

async function processQueue(pool, processed, since) {
  try {
    const events = await pool.querySync(
      [RELAY_URL],
      { kinds: [30078], '#d': ['goosielabs-admission'], since, limit: 100 },
      { maxWait: 5000 }
    );
    console.log(`🔍  Backlog scan: ${events.length} admission request(s) gevonden`);
    for (const event of events) {
      if (processed.has(event.id)) continue;
      processed.add(event.id);
      try {
        await processAdmissionRequest(pool, event);
      } catch (err) {
        console.error('Fout bij verwerken admission request:', err.message);
      }
    }
  } catch (err) {
    console.warn('Backlog scan mislukt:', err.message);
  }
}

async function startListener() {
  const pool = new SimplePool();
  const processed = new Set();

  // Verwerk gemiste verzoeken van de afgelopen 24 uur bij opstart
  const since = Math.floor(Date.now() / 1000) - 86400;
  console.log(`📡  Luistert op ${RELAY_URL} voor admission requests (kind 30078)...`);
  await processQueue(pool, processed, since);

  // Live subscription voor nieuwe verzoeken
  pool.subscribeMany(
    [RELAY_URL],
    [{
      kinds: [30078],
      '#d': ['goosielabs-admission'],
      since: Math.floor(Date.now() / 1000) - 60,
    }],
    {
      onevent: async (event) => {
        if (processed.has(event.id)) return;
        processed.add(event.id);
        console.log(`📨  Nieuw admission request ontvangen van ${event.pubkey.slice(0,16)}...`);
        try {
          await processAdmissionRequest(pool, event);
        } catch (err) {
          console.error('Fout bij verwerken admission request:', err.message);
        }
      },
    }
  );

  // Poll elke 30s als fallback voor gemiste live events
  setInterval(() => processQueue(pool, processed, Math.floor(Date.now() / 1000) - 60), 30000);

  process.on('SIGINT', () => {
    pool.close([RELAY_URL]);
    process.exit(0);
  });
}

startListener().catch(console.error);
