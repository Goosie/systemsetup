#!/usr/bin/env node
/**
 * Roster drift detector.
 *
 * Compares the SINGLE SOURCE OF TRUTH (agents/<name>/nostr-key.json — which geese
 * exist + their npub/pubkey) against every derived / duplicated file. It changes
 * NOTHING; it only reports mismatches.
 *
 * Exit 0 = clean (or warnings only), 1 = hard drift (missing / wrong identity).
 * So it can gate a commit or a Blocky run without blocking on cosmetic gaps.
 *
 * Run by: Ay (`goosie ay drift`) on the Blocky schedule, and humany `newgoose`.
 */
'use strict';

import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const AGENTS_DIR = '/home/deploy/agents';
const F = {
  agentsJson:  '/home/deploy/agents/agents.json',
  whitelist:   '/home/deploy/whitelist.json',
  nostrJson:   '/var/www/goosielabs/.well-known/nostr.json',
  icons:       '/var/www/goosielabs/generate-agent-icons.mjs',
  portraits:   '/home/deploy/systemsetup/scripts/generate-agent-portraits.mjs',
  gooseAgents: '/var/www/goosielabs/apps/gameofthegoose/src/lib/gooseAgents.ts',
};

// ── Source of truth: a goose = an agents/<name>/ dir with nostr-key.json ────────
const geese = {};
for (const name of readdirSync(AGENTS_DIR)) {
  const kf = resolve(AGENTS_DIR, name, 'nostr-key.json');
  if (!existsSync(kf)) continue;
  try {
    const k = JSON.parse(readFileSync(kf, 'utf8'));
    if (k.pubkey || k.npub) geese[name] = { npub: k.npub, pubkey: k.pubkey };
  } catch { /* skip unreadable */ }
}
const gooseNames = Object.keys(geese);

const issues = [];
const err  = (file, msg) => issues.push({ file, level: 'error', msg });
const warn = (file, msg) => issues.push({ file, level: 'warn',  msg });

// Extract the set of `name: '...'` from a JS/TS file (good enough for drift).
function namesIn(path) {
  if (!existsSync(path)) return null;
  const src = readFileSync(path, 'utf8');
  return new Set([...src.matchAll(/name:\s*['"]([a-z0-9-]+)['"]/g)].map(m => m[1]));
}

// ── agents.json (name, npub, pubkey, about) ────────────────────────────────────
try {
  const list = (JSON.parse(readFileSync(F.agentsJson, 'utf8')).agents) || [];
  const byName = {};
  list.forEach(a => { byName[(a.name || '').toLowerCase()] = a; });
  for (const n of gooseNames) {
    const e = byName[n];
    if (!e) { err('agents.json', `${n}: ontbreekt`); continue; }
    if (!e.npub) err('agents.json', `${n}: npub leeg`);
    else if (e.npub !== geese[n].npub) err('agents.json', `${n}: npub wijkt af van bron`);
    if (e.pubkey && e.pubkey !== geese[n].pubkey) err('agents.json', `${n}: pubkey wijkt af van bron`);
    if (/to be defined/i.test(e.about || '')) warn('agents.json', `${n}: about = "role to be defined"`);
  }
  for (const n of Object.keys(byName)) if (!geese[n]) err('agents.json', `${n}: entry zonder agent-map (stale)`);
} catch (e) { err('agents.json', `kon niet lezen: ${e.message}`); }

// ── whitelist.json (name → pubkey; admins + _comment mogen extra zijn) ──────────
try {
  const wl = JSON.parse(readFileSync(F.whitelist, 'utf8'));
  for (const n of gooseNames) {
    if (!(n in wl)) err('whitelist.json', `${n}: ontbreekt`);
    else if (wl[n] !== geese[n].pubkey) err('whitelist.json', `${n}: pubkey wijkt af`);
  }
} catch (e) { err('whitelist.json', `kon niet lezen: ${e.message}`); }

// ── .well-known/nostr.json (.names: name → pubkey) ──────────────────────────────
try {
  const names = (JSON.parse(readFileSync(F.nostrJson, 'utf8')).names) || {};
  for (const n of gooseNames) {
    if (!(n in names)) err('nostr.json', `${n}: ontbreekt`);
    else if (names[n] !== geese[n].pubkey) err('nostr.json', `${n}: pubkey wijkt af`);
  }
} catch (e) { err('nostr.json', `kon niet lezen: ${e.message}`); }

// ── generator lists + cross-repo roster (presence only → warnings) ──────────────
for (const [label, path] of [
  ['generate-agent-portraits.mjs', F.portraits],
  ['gooseAgents.ts (gameofthegoose)', F.gooseAgents],
]) {
  const set = namesIn(path);
  if (!set) { warn(label, 'bestand niet gevonden'); continue; }
  for (const n of gooseNames) if (!set.has(n)) warn(label, `${n}: ontbreekt`);
  for (const n of set) if (!geese[n]) warn(label, `${n}: stale entry (geen agent-map)`);
}

// Icon + portrait are derived from the DALL-E portrait (not the old composite
// generator) — so check the actual files exist per goose.
for (const n of gooseNames) {
  if (!existsSync(resolve(AGENTS_DIR, n, 'icon-192.png'))) warn('agent-icon', `${n}: icon-192.png ontbreekt`);
  if (!existsSync(resolve(AGENTS_DIR, n, `${n}.jpg`)))      warn('agent-portrait', `${n}: ${n}.jpg ontbreekt`);
}

// ── Report ──────────────────────────────────────────────────────────────────────
console.log(`🔎 Roster drift-check — ${gooseNames.length} ganzen (bron: agents/*/nostr-key.json)`);
if (!issues.length) {
  console.log('✅ Geen drift — alle afgeleide bestanden kloppen met de bron.');
  process.exit(0);
}
const byFile = {};
for (const i of issues) (byFile[i.file] ||= []).push(i);
for (const [file, list] of Object.entries(byFile)) {
  console.log(`\n  ${file}:`);
  for (const i of list) console.log(`    ${i.level === 'error' ? '🔴' : '🟡'} ${i.msg}`);
}
const errors = issues.filter(i => i.level === 'error').length;
const warns  = issues.filter(i => i.level === 'warn').length;
console.log(`\n${errors} error(s), ${warns} warning(s). ${errors ? '→ drift!' : '(alleen waarschuwingen)'}`);
process.exit(errors ? 1 : 0);
