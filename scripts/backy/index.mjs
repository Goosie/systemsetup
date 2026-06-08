#!/usr/bin/env node
/**
 * Backy — Backup gans voor Goosie Labs
 *
 * Luistert naar NIP-17 DMs en voert /commando's uit.
 * Stuur /help voor een overzicht van beschikbare commando's.
 *
 * Getriggerd door: Blocky (~1000 blokken) of handmatig via DM
 * Communicatie: NIP-17 gift wrap (kind 1059), zichtbaar in Swarm
 */

import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import WebSocket from 'ws';
import { nip44, finalizeEvent } from 'nostr-tools';

// ── Config ────────────────────────────────────────────────────────────────────

const RELAY_WS   = process.env.RELAY_URL    ?? 'ws://127.0.0.1:7778';
const DO_TOKEN   = process.env.DO_API_TOKEN ?? '';
const DROPLET_ID = process.env.DO_DROPLET_ID ?? '';
const HONK       = '/home/deploy/.local/bin/honk';
const AGENTS_DIR = '/home/deploy/agents';

const PERRY_PUBKEY  = 'a8364bf8e5b828bd722a6dc71882ff4ee8d379e64fbf4584f0c6f1b393f8058c';
const BLOCKY_PUBKEY = 'd4e2e205c8e1437b40b635a88ca85c44f5f4b18539e8c09551d9ce0f200ff71b';

// Load all whitelisted pubkeys — everyone on the whitelist can send commands
function loadAllowedSenders() {
  try {
    const wl = JSON.parse(readFileSync('/home/deploy/whitelist.json', 'utf8'));
    return new Set(Object.values(wl).filter(v => /^[0-9a-f]{64}$/.test(v)));
  } catch {
    return new Set([PERRY_PUBKEY, BLOCKY_PUBKEY]);
  }
}
const ALLOWED_SENDERS = loadAllowedSenders();

const backyKey     = JSON.parse(readFileSync(`${AGENTS_DIR}/backy/nostr-key.json`, 'utf8'));
const BACKY_PUBKEY = backyKey.pubkey;
const BACKY_SK     = new Uint8Array(backyKey.nsecHex.match(/.{2}/g).map(b => parseInt(b, 16)));

// ── Commando's ────────────────────────────────────────────────────────────────
//
// Dit object IS de /help tekst. Voeg hier een regel toe → commando werkt + staat in /help.
// Formaat: '/commando': { desc: 'wat het doet', fn: handlerFunctie }

const COMMANDS = {
  '/help':     { desc: 'Toon beschikbare commando\'s',              fn: handleHelp },
  '/snapshot': { desc: 'Maak een DigitalOcean server snapshot',     fn: handleSnapshot },
  '/status':   { desc: 'Bekijk recente DO snapshots',               fn: handleStatus },
  '/ping':     { desc: 'Test of Backy bereikbaar is',               fn: handlePing },
};

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleHelp({ reply }) {
  const lines = ['📦 Backy — beschikbare commando\'s:', ''];
  for (const [cmd, { desc }] of Object.entries(COMMANDS)) {
    lines.push(`${cmd.padEnd(12)} ${desc}`);
  }
  lines.push('', 'Stuur een commando via DM (Amethyst, Swarm, of honk).');
  reply(lines.join('\n'));
}

async function handlePing({ reply }) {
  reply('🏓 Pong! Backy is online en luistert.');
}

async function handleSnapshot({ reply }) {
  if (!DO_TOKEN || !DROPLET_ID) {
    reply('✗ DO_API_TOKEN of DO_DROPLET_ID ontbreekt — check .goosie.env');
    return;
  }
  reply('📦 Snapshot gestart — DigitalOcean aan het werk...');
  try {
    const result = await createSnapshot();
    reply(`✓ Snapshot klaar: ${result.name}\nAction ID: ${result.actionId} | Status: ${result.status}`);
    honk('backy', `✓ Snapshot gestart: ${result.name}`, 'blocky');
    await publishNote(`📦 Backy: server snapshot created successfully — https://goosielabs.com #vformation`);
  } catch (err) {
    reply(`✗ Snapshot mislukt: ${err.message}`);
    await publishNote(`⚠️ Backy: snapshot failed — https://goosielabs.com #vformation`);
  }
}

async function handleStatus({ reply }) {
  if (!DO_TOKEN || !DROPLET_ID) {
    reply('✗ DO_API_TOKEN ontbreekt — check .goosie.env');
    return;
  }
  try {
    const resp = await fetch(`https://api.digitalocean.com/v2/snapshots?resource_type=droplet`, {
      headers: { 'Authorization': `Bearer ${DO_TOKEN}` },
    });
    const data = await resp.json();
    const snaps = (data.snapshots ?? [])
      .filter(s => s.name.startsWith('goosielab'))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 3);
    if (!snaps.length) { reply('Geen snapshots gevonden.'); return; }
    const lines = ['📋 Recente snapshots:', ''];
    for (const s of snaps) {
      const date = new Date(s.created_at).toLocaleDateString('nl-NL');
      lines.push(`• ${s.name} — ${date} (${s.size_gigabytes} GB)`);
    }
    reply(lines.join('\n'));
  } catch (err) {
    reply(`✗ Kon snapshots niet ophalen: ${err.message}`);
  }
}

// ── DO API ────────────────────────────────────────────────────────────────────

async function createSnapshot() {
  const name = `goosielab-${new Date().toISOString().slice(0, 10)}`;
  const resp = await fetch(`https://api.digitalocean.com/v2/droplets/${DROPLET_ID}/actions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${DO_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'snapshot', name }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(JSON.stringify(data));
  return { name, actionId: data.action?.id, status: data.action?.status };
}

// ── NIP-17 decryptie ──────────────────────────────────────────────────────────

async function decryptGiftWrap(event) {
  try {
    // Step 1: decrypt gift wrap → seal
    // nip44.v2.decrypt(ciphertext, conversationKey)
    // conversationKey = getConversationKey(myPrivkey, theirPubkeyHex)
    const wrapKey = nip44.v2.utils.getConversationKey(BACKY_SK, event.pubkey);
    const sealJson = nip44.v2.decrypt(event.content, wrapKey);
    const seal = JSON.parse(sealJson);

    // Step 2: decrypt seal → rumor
    const sealKey = nip44.v2.utils.getConversationKey(BACKY_SK, seal.pubkey);
    const rumorJson = nip44.v2.decrypt(seal.content, sealKey);
    const rumor = JSON.parse(rumorJson);

    return { fromPubkey: seal.pubkey, content: rumor.content };
  } catch { return null; }
}

function hexToBytes(hex) {
  return new Uint8Array(hex.match(/.{2}/g).map(b => parseInt(b, 16)));
}

// ── Publieke Nostr post ───────────────────────────────────────────────────────

async function publishNote(content) {
  return new Promise((resolve) => {
    const ws = new WebSocket(RELAY_WS);
    ws.on('open', () => {
      const event = finalizeEvent({
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['t', 'vformation']],
        content,
      }, BACKY_SK);
      ws.send(JSON.stringify(['EVENT', event]));
    });
    ws.on('message', () => { ws.close(); resolve(); });
    ws.on('error', () => { ws.close(); resolve(); });
    setTimeout(() => { ws.close(); resolve(); }, 8000);
  });
}

// ── Honk helper ───────────────────────────────────────────────────────────────

function honk(from, message, to) {
  try {
    execFileSync(HONK, ['from', `@${from}`, message, 'to', `@${to}`], {
      timeout: 30000,
      env: { ...process.env, PATH: process.env.PATH },
    });
  } catch (e) { console.error(`honk failed: ${e.message}`); }
}

function resolveRecipient(fromPubkey) {
  // Resolve pubkey to goose name for honk reply
  try {
    const agents = JSON.parse(readFileSync(`${AGENTS_DIR}/agents.json`, 'utf8'));
    const agent = agents.agents.find(a => a.pubkey === fromPubkey);
    if (agent) return agent.name;
  } catch {}
  if (fromPubkey === PERRY_PUBKEY) return 'perry';
  return null;
}

// ── Message handler ───────────────────────────────────────────────────────────

async function handleMessage(fromPubkey, content) {
  const recipient = resolveRecipient(fromPubkey);
  if (!recipient) {
    console.log(`[Backy] Onbekende afzender ${fromPubkey.slice(0, 8)}… — genegeerd`);
    return;
  }

  // reply helper — stuurt terug naar de afzender
  const reply = (msg) => honk('backy', msg, recipient);

  // Normaliseer: slash-commando of sleutelwoord
  const trimmed = content.trim();
  const cmd = trimmed.startsWith('/') ? trimmed.split(/\s+/)[0].toLowerCase() : null;

  // Sleutelwoorden voor Blocky-compatibiliteit (geen slash nodig)
  const keyword = trimmed.toLowerCase();
  const isSnapshotKeyword = !cmd && (keyword.includes('snapshot') || keyword.includes('backup'));

  console.log(`[Backy] ${recipient} → "${trimmed}"`);

  if (cmd && COMMANDS[cmd]) {
    await COMMANDS[cmd].fn({ reply, args: trimmed.slice(cmd.length).trim(), fromPubkey, recipient });
  } else if (isSnapshotKeyword) {
    await COMMANDS['/snapshot'].fn({ reply, args: '', fromPubkey, recipient });
  } else {
    reply(`Onbekend commando. Stuur /help voor een overzicht.`);
  }
}

// ── Relay listener ────────────────────────────────────────────────────────────

function connect() {
  console.log(`[Backy] Verbinden met relay...`);
  const ws = new WebSocket(RELAY_WS);

  ws.on('open', () => {
    console.log(`[Backy] ✓ Verbonden — luistert naar DMs (${BACKY_PUBKEY.slice(0, 8)}…)`);
    ws.send(JSON.stringify(['REQ', 'backy-inbox', {
      kinds: [1059],
      '#p': [BACKY_PUBKEY],
    }]));
  });

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!Array.isArray(msg)) return;
    if (msg[0] === 'EOSE') { console.log(`[Backy] EOSE ontvangen — live modus actief`); return; }
    if (msg[0] !== 'EVENT') return;

    const event = msg[2];
    if (!event?.id) return;

    const decrypted = await decryptGiftWrap(event);
    if (!decrypted) return;

    const { fromPubkey, content } = decrypted;

    if (!ALLOWED_SENDERS.has(fromPubkey)) {
      console.log(`[Backy] Afzender ${fromPubkey.slice(0, 8)}… niet toegestaan — genegeerd`);
      return;
    }

    await handleMessage(fromPubkey, content);
  });

  ws.on('close', () => {
    console.log(`[Backy] Verbinding verbroken — herverbinden in 15s...`);
    setTimeout(connect, 15000);
  });

  ws.on('error', (err) => console.error(`[Backy] fout: ${err.message}`));
}

// ── Start ─────────────────────────────────────────────────────────────────────

if (!DO_TOKEN) console.warn('[Backy] ⚠ DO_API_TOKEN niet gevonden — snapshot zal mislukken');

connect();
