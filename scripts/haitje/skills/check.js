/**
 * Haitje — check skill
 * Controleert alle AI-configuratiebestanden op volledigheid en onderlinge samenhang.
 * Haitje mag alleen lezen en AI-gerelateerde .md bestanden wijzigen.
 */

import fs from 'fs';
import path from 'path';

// Welke ganzen verwachten we in de V-formatie?
const EXPECTED_GANZEN = ['Astrid', 'Danky', 'Ruby', 'Finny', 'Tessy', 'Jurry', 'Haitje'];

// Welke secties verwachten we in de server CLAUDE.md?
const EXPECTED_SERVER_SECTIONS = [
  'JURRY',
  'TESSA',
  'Stack',
  'Apps',
  'NIP',
  'QUALITY RULES',
];

// Welke secties verwachten we in de globale CLAUDE.md?
const EXPECTED_GLOBAL_SECTIONS = [
  'Ganzenmethode',
  'Stack',
  'Workflow',
  'Actieve Projecten',
  'Jurry',
];

// Welke memory-types verwachten we minstens één van?
const EXPECTED_MEMORY_TYPES = ['user', 'feedback', 'project'];

export async function checkConfig(paths) {
  let warnings = 0;
  let oks = 0;

  function ok(msg) { console.log(`  ✅ ${msg}`); oks++; }
  function warn(msg) { console.log(`  ⚠️  ${msg}`); warnings++; }
  function info(msg) { console.log(`  ℹ️  ${msg}`); }

  // ── 1. Globale CLAUDE.md ──────────────────────────────────────────────────
  console.log(`\n📄 Globale CLAUDE.md (${paths.globalClaude})`);
  if (!fs.existsSync(paths.globalClaude)) {
    warn('Bestand ontbreekt!');
  } else {
    const content = fs.readFileSync(paths.globalClaude, 'utf8');
    for (const section of EXPECTED_GLOBAL_SECTIONS) {
      if (content.includes(section)) ok(`Sectie "${section}" aanwezig`);
      else warn(`Sectie "${section}" ontbreekt`);
    }
    // Check of Haitje al vermeld wordt
    if (content.includes('Haitje')) ok('Haitje vermeld in globale CLAUDE.md');
    else warn('Haitje nog niet vermeld in globale CLAUDE.md → toevoegen aan Actieve Projecten');
  }

  // ── 2. Server CLAUDE.md ───────────────────────────────────────────────────
  console.log(`\n📄 Server CLAUDE.md (${paths.serverClaude})`);
  if (!fs.existsSync(paths.serverClaude)) {
    warn('Bestand ontbreekt!');
  } else {
    const content = fs.readFileSync(paths.serverClaude, 'utf8');
    for (const section of EXPECTED_SERVER_SECTIONS) {
      if (content.toUpperCase().includes(section.toUpperCase())) ok(`Sectie "${section}" aanwezig`);
      else warn(`Sectie "${section}" ontbreekt of heeft andere naam`);
    }
    if (content.includes('Haitje')) ok('Haitje vermeld in server CLAUDE.md');
    else warn('Haitje nog niet vermeld in server CLAUDE.md → toevoegen');
  }

  // ── 3. Memory-systeem ─────────────────────────────────────────────────────
  console.log(`\n🧠 Memory-systeem (${paths.memory})`);
  if (!fs.existsSync(paths.memory)) {
    warn('Memory-map ontbreekt!');
  } else {
    const memFiles = fs.readdirSync(paths.memory).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
    info(`${memFiles.length} geheugenbestanden gevonden`);

    const memoryMd = path.join(paths.memory, 'MEMORY.md');
    if (!fs.existsSync(memoryMd)) {
      warn('MEMORY.md (index) ontbreekt!');
    } else {
      ok('MEMORY.md aanwezig');
      const indexContent = fs.readFileSync(memoryMd, 'utf8');
      const indexedCount = (indexContent.match(/^\s*-\s+\[/gm) || []).length;
      info(`${indexedCount} entries in MEMORY.md index`);

      // Check of alle memory-bestanden in de index staan
      for (const file of memFiles) {
        if (indexContent.includes(file)) ok(`${file} staat in index`);
        else warn(`${file} staat NIET in MEMORY.md index → voeg toe`);
      }
    }

    // Check memory-types
    const foundTypes = new Set();
    for (const file of memFiles) {
      const content = fs.readFileSync(path.join(paths.memory, file), 'utf8');
      const typeMatch = content.match(/^\s{2}type:\s*(\w+)/m);
      if (typeMatch) foundTypes.add(typeMatch[1]);
    }
    for (const type of EXPECTED_MEMORY_TYPES) {
      if (foundTypes.has(type)) ok(`Memory-type "${type}" aanwezig`);
      else warn(`Geen enkel geheugenbestand van type "${type}" gevonden`);
    }
  }

  // ── 4. Agent-scripts aanwezig? ────────────────────────────────────────────
  console.log(`\n🤖 Agent-scripts (${paths.scripts})`);
  const expectedAgents = ['jurry', 'haitje'];
  for (const agent of expectedAgents) {
    const agentIndex = path.join(paths.scripts, agent, 'index.js');
    if (fs.existsSync(agentIndex)) ok(`${agent}/index.js aanwezig`);
    else warn(`${agent}/index.js ontbreekt!`);
  }

  // Tessa: per-app, check de meest actieve apps
  const tessaApps = ['lastwill', 'zap-hunt', 'dilemma'];
  console.log(`\n🧪 Tessa per-app check`);
  for (const app of tessaApps) {
    const tessaIndex = path.join(paths.appsDir, app, 'scripts/tessa/index.js');
    if (fs.existsSync(tessaIndex)) ok(`${app}: Tessa aanwezig`);
    else warn(`${app}: Tessa ontbreekt (scripts/tessa/index.js)`);
  }

  // ── 5. Samenhang: ganzen in CLAUDE.md? ───────────────────────────────────
  console.log(`\n🪿 V-Formatie samenhang`);
  if (fs.existsSync(paths.globalClaude)) {
    const global = fs.readFileSync(paths.globalClaude, 'utf8');
    for (const gans of EXPECTED_GANZEN) {
      if (global.includes(gans)) ok(`${gans} vermeld in globale CLAUDE.md`);
      else warn(`${gans} ontbreekt in globale CLAUDE.md`);
    }
  }

  // ── Samenvatting ──────────────────────────────────────────────────────────
  console.log(`\n────────────────────────────────────────────`);
  console.log(`Resultaat: ${oks} OK, ${warnings} waarschuwingen`);
  if (warnings === 0) {
    console.log(`Alle ganzen vliegen in perfecte V-formatie. 🪿`);
  } else {
    console.log(`\nGeef dit door aan Astrid voor de todolijst.`);
  }

  return { oks, warnings };
}
