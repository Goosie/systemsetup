import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// Juridische aandachtspunten per app-concept
const CHECKLISTS = {
  privacy: [
    'Sla je persoonsgegevens op? (naam, e-mail, locatie, IP-adres)',
    'Is er een privacy policy aanwezig of gepland?',
    'Voldoe je aan AVG/GDPR? (recht op verwijdering, dataminimalisatie)',
    'Worden gegevens gedeeld met derden?',
  ],
  nostr: [
    'Nostr-events zijn publiek en onomkeerbaar — is de gebruiker hiervan op de hoogte?',
    'NIP-07 login: privésleutel blijft bij de gebruiker — dit is correct',
    'NIP-62 (request to vanish) overwegen als gebruikers content willen verwijderen',
    'Geen nsec (privésleutel) opslaan in localStorage of database',
  ],
  lightning: [
    'Lightning/Cashu betalingen: ben je een betaaldienstverlener? (PSD2/VASP)',
    'In NL/EU kan het aanbieden van betalingsdiensten vergunningsplichtig zijn',
    'Cashu is bearer token — geen terugstortingsplicht, maar informeer gebruikers',
    'Documenteer de geldstromen voor eventuele accountancy',
  ],
  content: [
    'Gebruikers kunnen content posten — heb je een moderatiebeleid?',
    'Ben je aansprakelijk voor user-generated content? (DSA/eCommerce richtlijn)',
    'Optie: NIP-56 rapportage inbouwen zodat gebruikers kunnen melden',
  ],
  identity: [
    'Verifieer je identiteit van gebruikers? (KYC-verplichting bij financiële diensten)',
    'NIP-05 verificatie is optioneel — geen identiteitsplicht',
  ],
};

const APP_PROFILES = {
  'zap-hunt': ['privacy', 'lightning', 'nostr', 'content'],
  zaphunt: ['privacy', 'lightning', 'nostr', 'content'],
  ididhere: ['privacy', 'nostr', 'content', 'identity'],
  dilemma: ['privacy', 'lightning', 'nostr', 'content'],
  feedback: ['privacy', 'nostr', 'content'],
  zinin: ['privacy', 'nostr', 'content'],
  lastwill: ['privacy', 'nostr', 'identity'],
  weddendat: ['privacy', 'lightning', 'nostr', 'content'],
  proofofmove: ['privacy', 'lightning', 'nostr'],
  sofia: ['privacy', 'nostr', 'content'],
};

export async function reviewApp({ appName, appsDir }) {
  const apps = appName
    ? [appName]
    : readdirSync(appsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !existsSync(join(appsDir, d.name, '.archived')))
        .map((d) => d.name);

  for (const app of apps) {
    console.log(`\n⚖️  Juridische review: ${app}`);
    console.log(`${'─'.repeat(40)}`);

    const profile = APP_PROFILES[app];
    if (!profile) {
      console.log(`  ℹ️  Geen juridisch profiel bekend voor "${app}".`);
      console.log(`  → Voeg het toe in scripts/jurry/skills/review.js (APP_PROFILES)`);
      continue;
    }

    const appDir = join(appsDir, app);
    const hasEnv = existsSync(join(appDir, '.env')) || existsSync(join(appDir, '.env.example'));
    const hasReadme = existsSync(join(appDir, 'README.md'));

    for (const area of profile) {
      console.log(`\n  📋 ${area.toUpperCase()}`);
      CHECKLISTS[area]?.forEach((item) => console.log(`    • ${item}`));
    }

    console.log(`\n  📁 Bestanden`);
    console.log(`    ${hasReadme ? '✓' : '✗'} README.md ${hasReadme ? 'aanwezig' : 'ontbreekt — geen beschrijving'}`);
    console.log(`    ${hasEnv ? '✓' : '⚠️'} .env/.env.example ${hasEnv ? 'aanwezig' : 'niet gevonden'}`);
  }
}
