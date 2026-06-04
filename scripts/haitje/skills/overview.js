/**
 * Haitje — overview skill
 * Geeft een totaalbeeld van de V-formatie: welke ganzen zijn er,
 * hoe zijn ze geconfigureerd, wat missen we nog.
 */

import fs from 'fs';
import path from 'path';

const GANZEN = [
  {
    naam: 'Assistenty',
    rol: 'Persoonlijke lab-assistent',
    bestand: '~/.claude/CLAUDE.md',
    type: 'CLAUDE.md (globaal)',
    beschrijving: 'Houdt overzicht, ruimt op, maakt todos, kent Perry en zijn werkwijze.',
  },
  {
    naam: 'Danky',
    rol: 'DevOps Gans',
    bestand: 'Geïmpliceerd in server CLAUDE.md',
    type: 'Rol',
    beschrijving: 'Git, backup, updates — doet het gewoon.',
  },
  {
    naam: 'Ruby',
    rol: 'Chief Reality Officer',
    bestand: 'Geïmpliceerd in server CLAUDE.md',
    type: 'Rol',
    beschrijving: 'Stelt de kritische vragen die je over zes weken blij mee bent.',
  },
  {
    naam: 'Finny',
    rol: 'Chief Financial Gans',
    bestand: 'Geïmpliceerd in server CLAUDE.md',
    type: 'Rol',
    beschrijving: 'Houdt inkomsten en uitgaven bij, bewaakt de satoshis.',
  },
  {
    naam: 'Tessy',
    rol: 'QA Gans',
    bestand: 'scripts/testy/index.js (per app)',
    type: 'Script (per app)',
    beschrijving: 'Test alles, drukt op alle knoppen, geeft apps testdata.',
  },
  {
    naam: 'Jurry',
    rol: 'Juridisch Adviseur',
    bestand: '/home/deploy/scripts/jurry/index.js',
    type: 'Script (server-level)',
    beschrijving: 'Licenties, privacy, betaalrecht, aansprakelijkheid. Draait op serverniveau.',
  },
  {
    naam: 'Haitje',
    rol: 'AI-configuratie Specialist',
    bestand: '/home/deploy/scripts/haitje/index.js',
    type: 'Script (server-level)',
    beschrijving: 'Bewaakt de kwaliteit van alle AI-configuratie. Zorgt dat de ganzen optimaal in hun kracht staan.',
  },
];

export async function overview(paths) {
  console.log(`\n🪿 V-Formatie — alle ganzen op een rij`);
  console.log(`════════════════════════════════════════════\n`);

  for (const gans of GANZEN) {
    const aanwezig = gans.bestand.startsWith('/')
      ? fs.existsSync(gans.bestand)
      : null; // niet direct te controleren

    const status = aanwezig === true ? '✅' : aanwezig === false ? '❌' : '📌';
    console.log(`${status} ${gans.naam} — ${gans.rol}`);
    console.log(`   Type: ${gans.type}`);
    console.log(`   Bestand: ${gans.bestand}`);
    console.log(`   Taak: ${gans.beschrijving}\n`);
  }

  // ── Samenhang check ───────────────────────────────────────────────────────
  console.log(`📐 Configuratie-samenhang`);
  console.log(`────────────────────────`);

  const globalClaude = paths.globalClaude;
  const serverClaude = paths.serverClaude;

  if (fs.existsSync(globalClaude)) {
    const global = fs.readFileSync(globalClaude, 'utf8');
    const aanwezigInGlobal = GANZEN.filter(g => global.includes(g.naam)).map(g => g.naam);
    const ontbrekendInGlobal = GANZEN.filter(g => !global.includes(g.naam)).map(g => g.naam);
    if (aanwezigInGlobal.length) console.log(`  Globale CLAUDE.md kent: ${aanwezigInGlobal.join(', ')}`);
    if (ontbrekendInGlobal.length) console.log(`  Ontbreekt in globale CLAUDE.md: ${ontbrekendInGlobal.join(', ')}`);
  }

  if (fs.existsSync(serverClaude)) {
    const server = fs.readFileSync(serverClaude, 'utf8');
    const aanwezigInServer = GANZEN.filter(g => server.includes(g.naam)).map(g => g.naam);
    const ontbrekendInServer = GANZEN.filter(g => !server.includes(g.naam)).map(g => g.naam);
    if (aanwezigInServer.length) console.log(`  Server CLAUDE.md kent: ${aanwezigInServer.join(', ')}`);
    if (ontbrekendInServer.length) console.log(`  Ontbreekt in server CLAUDE.md: ${ontbrekendInServer.join(', ')}`);
  }

  // ── Memory-systeem ────────────────────────────────────────────────────────
  if (fs.existsSync(paths.memory)) {
    const memFiles = fs.readdirSync(paths.memory).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
    console.log(`\n🧠 Memory: ${memFiles.length} actieve geheugenbestanden`);
    for (const f of memFiles) {
      const content = fs.readFileSync(path.join(paths.memory, f), 'utf8');
      const nameMatch = content.match(/^name:\s*(.+)$/m);
      const typeMatch = content.match(/type:\s*(\w+)/);
      const name = nameMatch ? nameMatch[1].trim() : f;
      const type = typeMatch ? typeMatch[1] : '?';
      console.log(`  [${type}] ${name}`);
    }
  }

  console.log(`\n────────────────────────────────────────────`);
  console.log(`Gebruik "haitje check" voor een diepgaande analyse.`);
  console.log(`Gebruik "haitje advies" voor concrete verbeterpunten.\n`);
}
