#!/usr/bin/env node
/**
 * ideabrief — idea→brief→scaffold tool (was Prompty)
 *
 * Reads an idea from ~/todo.md, generates a structured build brief
 * via the Anthropic API, saves it to ~/briefs/<name>.md, and
 * triggers Devy to scaffold the app directory.
 *
 * Usage: node index.mjs <idea-name>
 * Example: goosie ideabrief skein
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const TODO_PATH   = '/home/deploy/todo.md';
const BRIEFS_DIR  = '/home/deploy/briefs';
const SCRIPTS_DIR = '/home/deploy/scripts';

// ── Args ──────────────────────────────────────────────────────────────────────

const ideaName = process.argv[2];
if (!ideaName) {
  console.error('Usage: node index.mjs <idea-name>');
  process.exit(1);
}

console.log(`\n🪿 Prompty — "${ideaName}" omzetten naar build brief`);

// ── Lees todo.md ──────────────────────────────────────────────────────────────

const todo = readFileSync(TODO_PATH, 'utf8');
const ideaLine = todo.split('\n').find(l =>
  l.toLowerCase().includes(ideaName.toLowerCase()) && l.includes('#idee')
);

if (!ideaLine) {
  console.error(`✗ Geen #idee entry gevonden voor "${ideaName}" in todo.md`);
  console.error(`  Voeg eerst toe: @Assistenty zet op #todo #idee ${ideaName} — ...`);
  process.exit(1);
}

console.log(`  ✓ Todo gevonden`);

// ── Anthropic API ─────────────────────────────────────────────────────────────

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('✗ ANTHROPIC_API_KEY niet gezet');
  process.exit(1);
}

const systemPrompt = `Je bent Prompty, een build brief generator voor de Goosie Labs V-Formatie.
Je zet ruwe idee-omschrijvingen uit todo.md om naar gestructureerde Claude Code build briefs.
De brief komt bovenaan CLAUDE.md van een nieuwe app te staan.
Schrijf in het Nederlands. Wees concreet en praktisch. Focus op de MVP.
Geen wollig taalgebruik. Geen opsommingen van wat je gaat doen — doe het gewoon.`;

const userPrompt = `Genereer een gestructureerd Claude Code build brief op basis van dit idee:

${ideaLine}

Gebruik precies deze structuur:

## Doel & Gebruik
[Wat het is, voor wie, wanneer je het gebruikt. Max 3 zinnen.]

## MVP Scope
[Wat er in de eerste versie zit. Geen feature creep. Bullet points.]

## Technische keuzes
[Nostr NIPs, tools, patronen. Alleen wat al besloten is.]

## Eerste taak
[De eerste concrete stap die Claude Code direct kan uitvoeren. Één duidelijke actie.]`;

console.log(`  → Anthropic API aanroepen...`);

const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  }),
});

if (!res.ok) {
  console.error(`✗ Anthropic API fout ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const data = await res.json();
const brief = data.content[0].text.trim();
console.log(`  ✓ Brief gegenereerd (${brief.length} tekens)`);

// ── Opslaan ───────────────────────────────────────────────────────────────────

if (!existsSync(BRIEFS_DIR)) mkdirSync(BRIEFS_DIR, { recursive: true });

const briefPath = resolve(BRIEFS_DIR, `${ideaName}.md`);
const output = `# ${ideaName.charAt(0).toUpperCase() + ideaName.slice(1)} — Build Brief\n\n> Gegenereerd door Prompty op ${new Date().toISOString().slice(0, 10)}\n\n${brief}\n`;
writeFileSync(briefPath, output, 'utf8');
console.log(`  ✓ Brief opgeslagen: ${briefPath}`);

// ── Trigger Devy ──────────────────────────────────────────────────────────────

console.log(`  → Devy triggeren: create-app ${ideaName}...`);

try {
  const { stdout, stderr } = await execFileAsync(
    'node',
    [resolve(SCRIPTS_DIR, 'devy/index.mjs'), 'create-app', ideaName],
    { timeout: 60_000, maxBuffer: 1024 * 512 }
  );
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
} catch (e) {
  console.error(`✗ Devy mislukt: ${e.message}`);
  process.exit(1);
}
