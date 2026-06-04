/**
 * Haitje — advies skill
 * Geeft proactief advies over de V-formatie AI-configuratie.
 * Rapport is bedoeld voor Assistenty, die er todos van maakt voor Perry.
 */

import fs from 'fs';
import path from 'path';
import { checkConfig } from './check.js';

export async function advies(paths) {
  console.log(`\nHaitje analyseert de V-formatie en stelt verbeteringen voor...\n`);

  // Voer eerst de check uit om data te verzamelen
  const { warnings } = await checkConfig(paths);

  console.log(`\n📋 Adviesrapport voor Assistenty`);
  console.log(`════════════════════════════════════════════`);

  const todos = [];

  // ── Controleer of Haitje zelf beschreven is in CLAUDE.md's ───────────────
  if (fs.existsSync(paths.globalClaude)) {
    const global = fs.readFileSync(paths.globalClaude, 'utf8');
    if (!global.includes('Haitje')) {
      todos.push({
        prioriteit: '🔴',
        actie: 'Voeg Haitje toe aan Actieve Projecten in ~/.claude/CLAUDE.md',
        detail: 'Haitje is aangemaakt maar staat nog niet in de globale configuratie.',
      });
    }
  }

  if (fs.existsSync(paths.serverClaude)) {
    const server = fs.readFileSync(paths.serverClaude, 'utf8');
    if (!server.includes('Haitje')) {
      todos.push({
        prioriteit: '🔴',
        actie: 'Voeg Haitje-sectie toe aan /home/deploy/CLAUDE.md',
        detail: 'Vergelijkbaar met de Jurry-sectie: commando\'s, structuur, taken.',
      });
    }
  }

  // ── Check Testy-dekking ───────────────────────────────────────────────────
  const appsDir = paths.appsDir;
  if (fs.existsSync(appsDir)) {
    const apps = fs.readdirSync(appsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !fs.existsSync(path.join(appsDir, d.name, '.archived')))
      .map(d => d.name);

    const zonderTessa = apps.filter(app =>
      !fs.existsSync(path.join(appsDir, app, 'scripts/testy/index.js'))
    );

    if (zonderTessa.length > 0) {
      todos.push({
        prioriteit: '🟡',
        actie: `Testy toevoegen aan: ${zonderTessa.join(', ')}`,
        detail: 'Deze apps hebben nog geen test-agent. Zie CLAUDE.md TODO-sectie.',
      });
    }
  }

  // ── Check memory-kwaliteit ────────────────────────────────────────────────
  if (fs.existsSync(paths.memory)) {
    const memFiles = fs.readdirSync(paths.memory)
      .filter(f => f.endsWith('.md') && f !== 'MEMORY.md');

    const oud = memFiles.filter(f => {
      const content = fs.readFileSync(path.join(paths.memory, f), 'utf8');
      // Zoek op datums in format YYYY-MM-DD
      const dates = content.match(/\d{4}-\d{2}-\d{2}/g) || [];
      if (dates.length === 0) return false;
      const latest = dates.sort().pop();
      const daysSince = (Date.now() - new Date(latest)) / 86400000;
      return daysSince > 60;
    });

    if (oud.length > 0) {
      todos.push({
        prioriteit: '🟢',
        actie: `Controleer verouderde geheugenbestanden: ${oud.join(', ')}`,
        detail: 'Laatste update is meer dan 60 dagen geleden. Nog actueel?',
      });
    }
  }

  // ── Check juridischadvies.md per app ─────────────────────────────────────
  if (fs.existsSync(appsDir)) {
    const apps = fs.readdirSync(appsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !fs.existsSync(path.join(appsDir, d.name, '.archived')))
      .map(d => d.name);

    const zonderJuridisch = apps.filter(app =>
      !fs.existsSync(path.join(appsDir, app, 'juridischadvies.md'))
    );

    if (zonderJuridisch.length > 0) {
      todos.push({
        prioriteit: '🟡',
        actie: `juridischadvies.md aanmaken voor: ${zonderJuridisch.join(', ')}`,
        detail: 'Jurry heeft nog geen advies voor deze apps geschreven.',
      });
    }
  }

  // ── Toon todos ────────────────────────────────────────────────────────────
  if (todos.length === 0) {
    console.log(`\nGeen nieuwe adviezen — de formatie staat er goed voor. 🪿`);
  } else {
    console.log(`\nHaitje geeft het volgende door aan Assistenty:\n`);
    todos.forEach((todo, i) => {
      console.log(`${todo.prioriteit} [${i + 1}] ${todo.actie}`);
      console.log(`     ${todo.detail}\n`);
    });
    console.log(`Assistenty: verwerk bovenstaande als todos voor Perry.`);
  }

  return todos;
}
