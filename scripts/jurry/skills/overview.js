import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Risicoclassificatie per app
const RISK = {
  'zap-hunt': 'HOOG',       // geldtransacties + locatiedata
  zaphunt: 'HOOG',          // geldtransacties + AI-content
  dilemma: 'GEMIDDELD',     // geldtransacties + UGC
  weddendat: 'HOOG',        // weddenschappen → kansspelwet aandacht
  lastwill: 'HOOG',         // erfrecht raakt persoonlijke nalatenschap
  ididhere: 'LAAG',         // publieke badges, geen betalingen
  feedback: 'LAAG',         // anonieme feedback, Cashu optioneel
  zinin: 'GEMIDDELD',       // matching van personen → privacy
  proofofmove: 'GEMIDDELD', // bewegingsdata + geldtransacties
  sofia: 'LAAG',            // groepsreizen, geen betalingen
};

const RISK_NOTES = {
  weddendat: '⚠️  Weddenschappen kunnen vallen onder de Wet op de Kansspelen (NL) — juridisch advies aanbevolen voor launch',
  lastwill: '⚠️  Digitale nalatenschap raakt erfrecht en kan verplichtingen scheppen — notarieel advies overwegen',
  'zap-hunt': 'ℹ️  Locatiedata + sats: AVG-melding mogelijk vereist bij schaalvergroting',
  zaphunt: 'ℹ️  AI-gegenereerde content: check auteursrecht AI-output en aansprakelijkheid bij foutieve hints',
  zinin: 'ℹ️  Personen matchen: zorgplicht t.a.v. veiligheid bij fysieke ontmoetingen overwegen',
};

export async function overview({ appsDir }) {
  const apps = readdirSync(appsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !existsSync(join(appsDir, d.name, '.archived')))
    .map((d) => d.name);

  console.log(`\n📊 Juridisch overzicht — alle apps`);
  console.log(`${'═'.repeat(50)}`);

  const byRisk = { HOOG: [], GEMIDDELD: [], LAAG: [], ONBEKEND: [] };

  for (const app of apps) {
    const risk = RISK[app] || 'ONBEKEND';
    byRisk[risk].push(app);
  }

  for (const [level, list] of Object.entries(byRisk)) {
    if (list.length === 0) continue;
    const icon = level === 'HOOG' ? '🔴' : level === 'GEMIDDELD' ? '🟡' : level === 'LAAG' ? '🟢' : '⚪';
    console.log(`\n${icon} ${level} risico`);
    for (const app of list) {
      console.log(`   • ${app}`);
      if (RISK_NOTES[app]) console.log(`     ${RISK_NOTES[app]}`);
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`\n📌 Aandachtspunten voor alle apps`);
  console.log(`   • Privacyverklaring ontbreekt nog op goosielabs.com`);
  console.log(`   • Algemene voorwaarden zijn er nog niet`);
  console.log(`   • Lightning/Cashu: bij opschaling mogelijk meldingsplicht DNB (betaaldiensten)`);
  console.log(`   • Nostr-events zijn permanent — informeer gebruikers hierover in de UI`);
  console.log(`   • Open source licenties: run 'jurry licenses' voor een volledig overzicht`);

  console.log(`\n📋 Volgende stap`);
  console.log(`   node scripts/jurry/index.js review            → checklist per app`);
  console.log(`   node scripts/jurry/index.js licenses          → npm-licenties checken`);
  console.log(`   node scripts/jurry/index.js review <appnaam>  → detail één app`);
}
