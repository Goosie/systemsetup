#!/bin/bash
# Maakt de Obsidian vault aan op /home/deploy/ObsidianClaudeFault
# Vult hem met seednotities op basis van de bestaande docs
# Gebruik: bash /home/deploy/systemsetup/scripts/obsidian/setup.sh

set -e

VAULT="/home/deploy/ObsidianClaudeFault"
REPO="/home/deploy/systemsetup"
DATUM=$(date +%Y-%m-%d)

echo "📓 Obsidian vault aanmaken op $VAULT..."
mkdir -p \
  "$VAULT/.obsidian" \
  "$VAULT/gesprekken" \
  "$VAULT/apps" \
  "$VAULT/visie" \
  "$VAULT/infra" \
  "$VAULT/ganzen" \
  "$VAULT/ideeen"

# ── Obsidian minimale config ────────────────────────────────────────────────
cat > "$VAULT/.obsidian/app.json" << 'JSON'
{
  "alwaysUpdateLinks": true,
  "newFileLocation": "current",
  "newLinkFormat": "shortest",
  "useMarkdownLinks": false
}
JSON

# ── 00-Index (MOC) ──────────────────────────────────────────────────────────
cat > "$VAULT/00-Index.md" << EOF
---
tags: [index, moc]
updated: $DATUM
---

# Goosie Labs — Claude Vault

Alles wat hier staat is gegroeid uit gesprekken met Claude. Ideeën, pivots,
bouwplannen, besluiten. Elke nota linkt naar andere noten. Dit is het startpunt.

## Wereld
- [[visie/dual-world]] — twee parallelle werelden
- [[visie/perpetual-beta]] — dit lab is nooit klaar
- [[visie/donatie-model]] — doneren = stemmen
- [[visie/token-onboarding]] — nieuwe gebruikers krijgen sats

## Infrastructuur
- [[infra/server]] — server, stack, subdomains
- [[infra/nsite]] — nsite.goosielabs.com

## Apps
- [[apps/ididhere]] · [[apps/zaphunt]] · [[apps/catchzaps]]
- [[apps/zinin]] · [[apps/weddendat]] · [[apps/dilemma]]
- [[apps/lastwill]] · [[apps/nospass]] · [[apps/feedback]]
- [[apps/honkference]] · [[apps/sofia]] · [[apps/proofofmove]]

## Het team
- [[ganzen/v-formatie]] — Perry + de ganzen
- [[ganzen/astrid]] · [[ganzen/jurry]] · [[ganzen/haitje]]

## Gesprekken
Zie map [[gesprekken/]] — elk gesprek met Claude is een nota.

## Ideeën pipeline
- [[ideeen/rgb-diploma]] — gedecentraliseerde diploma's
- [[ideeen/mountainbike-app]] — live locatie groepsrit
EOF

# ── Visie ────────────────────────────────────────────────────────────────────
cat > "$VAULT/visie/dual-world.md" << EOF
---
tags: [visie, architectuur]
---

# Dual World Architecture

Goosie Labs draait in twee parallelle werelden. Dezelfde apps, twee ingangen.

| Wereld | URL | Hoe |
|--------|-----|-----|
| Centraal | [goosielabs.com](https://goosielabs.com) | WordPress + nginx |
| Decentraal | [nsite.goosielabs.com](https://nsite.goosielabs.com) | Nostr-native nsite gateway |

Apps staan in \`/var/www/goosielabs/apps/\`. WordPress serveert via \`/apps/<naam>/\`.
De nsite gateway serveert dezelfde builds als gesigneerde Nostr-bestanden.

## Waarom twee?
WordPress is vindbaar, vertrouwd, SEO-vriendelijk. Nsite is de proof-of-concept
dat je een site kunt hosten zonder server — alleen een Nostr-key en een relay nodig.
We houden allebei in leven zodat bezoekers het verschil kunnen voelen.

## Gerelateerd
- [[visie/perpetual-beta]]
- [[infra/nsite]]
- [[infra/server]]
EOF

cat > "$VAULT/visie/perpetual-beta.md" << EOF
---
tags: [visie, filosofie]
---

# Perpetual Beta — Dit Lab Is Nooit Klaar

Dat is een bewuste keuze.

Elke dag nieuwe ideeën. Uitvoeren. Pivotten. Soms halverwege stoppen.
Soms terugkomen. Soms weggooien en opnieuw beginnen.
We delen het *proces*, niet alleen het eindproduct.

## Wat dit betekent
- We zijn eerlijk dat alles hier experiment is
- Bezoekers zijn medeëxperimenteerders, geen eindgebruikers
- Ideeën mogen worden geforkt, aangepast, verbeterd
- We leggen **uit waarom** we iets bouwen én waarom we van koers veranderen

## Bouwen in het openbaar
Soms bouwen we live op een conference call. Dat is de methode, geen uitzondering.
Elk pivot-moment krijgt een korte note op de site: "We dachten X, het werkt niet
omdat Y, nu proberen we Z."

## Gerelateerd
- [[visie/dual-world]]
- [[visie/donatie-model]]
EOF

cat > "$VAULT/visie/donatie-model.md" << EOF
---
tags: [visie, businessmodel, lightning]
---

# Donatie Model — Sats als Stemmen

Geen abonnementen. Geen ads. Geen investor-druk.

**Elke app krijgt een "Motiveer ons" knop.**
Doneren is stemmen. Elke sat zegt: dit idee vind ik waardevol.

## Hoe het werkt
1. Gebruiker klikt "⚡ Motiveer ons" op een app
2. Kiest bedrag (21 / 100 / 500 / 2100 sats)
3. Betaling via Lightning (LNURL-pay of webln)
4. Optioneel: stem gepubliceerd als Nostr-event op [[infra/server#relay]]
5. Homepage-tile toont totaal ontvangen sats → community-ranking

## Technisch
- Component: \`templates/DonationButton.tsx\` in de systemsetup-repo
- Elke nieuwe app krijgt dit automatisch via \`newapp <naam>\`
- Lightning address: \`zoomer@getalby.com\` (fallback), eigenlijk per-app LNbits wallet
- Zie [[ideeen/nostr-voting-plan]] voor de volledige roadmap

## Gerelateerd
- [[visie/token-onboarding]]
- [[infra/server#lnbits]]
EOF

cat > "$VAULT/visie/token-onboarding.md" << EOF
---
tags: [visie, onboarding, cashu, lightning]
status: gepland-experiment
---

# Token Onboarding — Nieuwe Gebruikers Krijgen Sats

Idee: een nieuwe bezoeker (onbekende Nostr-pubkey, nog nooit gezien op onze relay)
krijgt automatisch een kleine hoeveelheid sats om mee te spelen.

Doel: geen drempel. Meteen ervaren hoe Lightning + Nostr aanvoelt.

## Mogelijke vormen
- **Cashu ecash** via NIP-04 DM bij eerste login — anoniem, direct spendable
- **RGB token** als experiment met taproot assets
- **Taproot Assets (Taro)** voor on-chain experiments

## Open vragen
- Hoe misbruik voorkomen? (meerdere accounts aanmaken)
- Welke bedragen? 21 sats? 100 sats?
- Conditioneel: alleen bij een actie (eerste badge, eerste zap, eerste app-gebruik)?
- Vervaldatum op tokens?

## Implementatie richting
Een Node.js watchdog-service op de server:
1. Subscribet op relay voor alle nieuwe author-pubkeys
2. Checkt of pubkey al in SQLite \`airdrop.db\` staat
3. Zo niet: fetch Cashu token van [[infra/server#mint]] en DM via NIP-04
4. Sla pubkey op als "airdropped"

## Gerelateerd
- [[visie/donatie-model]]
- [[infra/server#mint]]
EOF

# ── Infra ────────────────────────────────────────────────────────────────────
cat > "$VAULT/infra/server.md" << EOF
---
tags: [infra, server]
---

# Server Infrastructuur

**Host:** deploy@goosielabs.com (SSH alias: \`ssh deploy\`)
**OS:** Ubuntu 24.04
**Node:** v20.20.2
**Webroot:** \`/var/www/goosielabs/\`
**Apps:** \`/var/www/goosielabs/apps/\`

## Subdomains

| URL | Wat | Poort |
|-----|-----|-------|
| goosielabs.com | WordPress + homepage | 80/443 |
| nsite.goosielabs.com | Nostr-native nsite gateway | — |
| mint.goosielabs.com | Cashu mint (Nutshell) | 3338 |
| lnbits.goosielabs.com | LNbits | 5000 |
| ididhere.goosielabs.com | IDidHere app | — |
| api.ididhere.goosielabs.com | IDidHere API | — |

## Nostr
- **Relay:** \`wss://goosielabs.com/relay\` (strfry 1.1.0)
- **npub:** \`npub14qpe36rvq0l6m3crplsntmnkzjm04weqflq0veqc8ra5hz4lpvxqqkdffc\`

## Lightning
- **Alby Hub** op Umbrel, NWC voor app-integraties
- **Lightning address:** \`zoomer@getalby.com\`
- **Cashu mint:** \`mint.goosielabs.com\`
- **LNbits:** \`lnbits.goosielabs.com\`

## Services (systemd)
- \`strfry.service\` — relay
- \`lnbits.service\` — Lightning wallets
- \`nutshell.service\` — Cashu mint
- \`goosielabs-backup.service/.timer\` — dagelijkse backup

## Gerelateerd
- [[infra/nsite]]
- [[ganzen/v-formatie]]
EOF

cat > "$VAULT/infra/nsite.md" << EOF
---
tags: [infra, nsite, nostr]
---

# nsite — Nostr-native Website

**URL:** [nsite.goosielabs.com](https://nsite.goosielabs.com)
**Gateway:** \`/home/deploy/nsite-gateway/server.js\`
**Test site:** \`/home/deploy/nsite-test\`

## Hoe het werkt
Bestanden worden gesigneerd met de Nostr-key van Perry en opgeslagen als Nostr-events.
De nsite-gateway haalt die events op van de relay en serveert ze als gewone HTTP-responses.
Geen traditionele server nodig voor de content — alleen de gateway als ingangspunt.

## Apps op nsite
Dezelfde builds als op WordPress (\`/var/www/goosielabs/apps/\`) — na elke deploy
ook pushen naar nsite zodat beide werelden synchroon lopen.

## Gerelateerd
- [[visie/dual-world]]
- [[infra/server]]
EOF

# ── Ganzen ───────────────────────────────────────────────────────────────────
cat > "$VAULT/ganzen/v-formatie.md" << EOF
---
tags: [team, ganzen]
---

# De V-Formatie

Perry is de voorste gans. Hij verkent nieuwe technologie, landt op vreemde
plekken, en vliegt verder. De andere ganzen ruimen op en bewaken hun domein.

| Gans | Rol | Status |
|------|-----|--------|
| Perry | Voorste gans — visie, experimenten | — |
| [[ganzen/astrid\|Astrid]] | Persoonlijke lab-assistent | LIVE |
| [[ganzen/jurry\|Jurry]] | Juridisch agent | LIVE |
| [[ganzen/haitje\|Haitje]] | AI-configuratie specialist | LIVE |
| Tessy | QA — test alles, drukt op knoppen | LIVE |
| Danky | DevOps — git, backup, server | ROL |
| Ruby | Chief Reality Officer | ROL |
| Finny | Chief Financial Gans (sats) | ROL |
EOF

cat > "$VAULT/ganzen/astrid.md" << EOF
---
tags: [gans, astrid]
---

# Astrid — Persoonlijke Lab-Assistent

Astrid kent Perry's werkwijze, zijn stack, zijn projecten en zijn chaos.
Ze houdt bij waar hij was, wat er open staat, en ruimt de troep op.

**Config:** \`~/.claude/CLAUDE.md\` (op de server)
**Rol:** Vertalen, opruimen, bijhouden, context bewaren.

## Triggers
- "Astrid, ruim even op" → overzicht: LIVE/IN BOUW/GESTOPT
- "Astrid, wat is er open?" → open todos per project
- "Astrid, nieuw idee: X" → toevoegen aan ideeen-pipeline

## Gerelateerd
- [[ganzen/v-formatie]]
- [[ganzen/jurry]]
EOF

cat > "$VAULT/ganzen/jurry.md" << EOF
---
tags: [gans, juridisch]
---

# Jurry — Juridisch Agent

Bewaakt licenties, privacy (AVG/GDPR), betaalregelgeving en aansprakelijkheid
van alle apps.

**Locatie:** \`/home/deploy/scripts/jurry/\`
**Aanroepen:** \`node /home/deploy/scripts/jurry/index.js [licenses|review|overview]\`

## Gerelateerd
- [[ganzen/v-formatie]]
EOF

cat > "$VAULT/ganzen/haitje.md" << EOF
---
tags: [gans, ai-config]
---

# Haitje — AI-Configuratie Specialist

Checkt of alle ganzen-configuraties goed in elkaar grijpen.
Geeft proactief advies aan Astrid.

**Locatie:** \`/home/deploy/scripts/haitje/\`
**Aanroepen:** \`node /home/deploy/scripts/haitje/index.js [check|advies|overview]\`

## Gerelateerd
- [[ganzen/v-formatie]]
- [[ganzen/astrid]]
EOF

# ── Apps ─────────────────────────────────────────────────────────────────────
generate_app_note() {
    local name="$1"
    local title="$2"
    local status="$3"
    local beschrijving="$4"
    local url="$5"

    cat > "$VAULT/apps/${name}.md" << EOF
---
tags: [app, status/${status}]
status: ${status}
url: ${url}
---

# ${title}

${beschrijving}

## Status
**${status^^}**

## Donatie
Krijgt [[visie/donatie-model|DonationButton]] — sats doneren = stemmen.

## Gerelateerd
- [[00-Index]]
- [[visie/perpetual-beta]]
EOF
}

generate_app_note "ididhere" "IDidHere" "live" \
  "Tegenhanger van IWasHere: bucket list van wat je wil doen. Bewijs wat je hebt gedaan als NIP-58 badge in je Nostr-identiteit." \
  "https://ididhere.goosielabs.com"

generate_app_note "zaphunt" "ZapHunt" "in-bouw" \
  "Maak je eigen speurtocht, AI helpt mee. Spelers verdienen sats voor ieder goed gegeven antwoord." \
  "https://goosielabs.com/apps/zaphunt/"

generate_app_note "catchzaps" "CatchZaps" "in-bouw" \
  "Drop sats op een kaart, anderen vangen ze op." \
  "https://goosielabs.com/apps/zap-hunt/"

generate_app_note "zinin" "ZinIn" "in-bouw" \
  "Als twee mensen op hetzelfde moment ergens zin in hebben zonder het van elkaar te weten, brengt deze app hen bij elkaar." \
  "https://goosielabs.com/apps/zinin/"

generate_app_note "weddendat" "WeddenDat" "in-bouw" \
  "P2P wedden met sats. Gooi een weddenschap op tafel, tegenpartij accepteert, arbiter beslist, Lightning betaalt automatisch." \
  "https://goosielabs.com/apps/weddendat/"

generate_app_note "dilemma" "Dilemma" "in-bouw" \
  "Post een dilemma met sat-bounty. Anderen geven advies, gemeenschap upvotet, jij kiest de winnaar — die de sats ontvangt." \
  "https://goosielabs.com/apps/dilemma/"

generate_app_note "lastwill" "LastWill" "in-bouw" \
  "Decentrale nalatenschap op Nostr. Dead man's switch met heartbeat-button en versleutelde acties (Bitcoin, Cashu, DMs)." \
  "https://goosielabs.com/apps/lastwill/"

generate_app_note "feedback" "Feedback" "in-bouw" \
  "Eerlijke feedback op ideeën en producten. Anoniem, NIP-04 versleuteld, beloond in sats." \
  "https://goosielabs.com/apps/feedback/"

generate_app_note "nospass" "Nospass" "in-bouw" \
  "Wachtwoorden beheren op Nostr — zelf in bezit, geen jaarlijkse kosten." \
  "https://goosielabs.com/apps/nospass/"

generate_app_note "honkference" "HonkFerence" "in-bouw" \
  "Nostr-conferentie app. Presenter split view, deelnemers theater/fullscreen. Rol via NIP-30311." \
  "https://goosielabs.com/apps/honkference/"

generate_app_note "sofia" "Sofia" "experiment" \
  "Nostr reisapp voor groepstrips." \
  "https://goosielabs.com/apps/sofia/"

generate_app_note "proofofmove" "ProofOfMove" "experiment" \
  "Train bewegingen, schaduw corrigeert in realtime. Correct bewegen = sats verdienen." \
  "https://goosielabs.com/apps/proofofmove/"

# ── Ideeën ───────────────────────────────────────────────────────────────────
cat > "$VAULT/ideeen/nostr-voting-plan.md" << EOF
---
tags: [idee, plan, nostr, lightning]
status: in-planning
---

# Plan: Nostr Voting via DonationButton

Zie \`docs/plan-donation-voting.md\` in de systemsetup-repo voor het volledige plan.

## Kern
1. DonationButton betaalt → publiceert Nostr-event (stem)
2. Homepage leest events van relay → toont sats per app
3. Sortering op sats = community-ranking

## Gerelateerd
- [[visie/donatie-model]]
- [[apps/ididhere]]
EOF

cat > "$VAULT/ideeen/rgb-diploma.md" << EOF
---
tags: [idee, rgb, bitcoin, onderwijs]
status: idee
---

# RGB Diploma's — Gedecentraliseerde Certificates

Gedecentraliseerde leer-diploma's opgeslagen als Bitcoin/Ordinals.
Bewijs dat je iets geleerd hebt, on-chain.

## Techniek opties
- Ordinals (inscriptions op Bitcoin)
- OP_RETURN met hash van credential
- RGB protocol voor richer state

## Gerelateerd
- [[ganzen/v-formatie]]
EOF

cat > "$VAULT/ideeen/mountainbike-app.md" << EOF
---
tags: [idee, locatie, nostr]
status: idee
---

# Mountainbike Trip App — Live Locatie Groepsrit

Live locatie-tracking voor groepstrips.
Eerste idee: Bulgaria trip.

## Gerelateerd
- [[apps/sofia]]
EOF

# ── Eerste gesprek (dit gesprek als seed) ───────────────────────────────────
cat > "$VAULT/gesprekken/$DATUM-dual-world-architectuur-en-obsidian-vault.md" << EOF
---
date: $DATUM
session: seed
project: systemsetup
tags: [gesprek, visie, obsidian, donatie]
---

# Dual World Architecture + Obsidian Vault — eerste gesprek

## Prompt

Perry beschrijft de nieuwe visie:
- Beide werelden laten draaien: goosielabs.com (WordPress) én nsite.goosielabs.com
- Dezelfde apps in beide werelden (/var/www/apps)
- Explicit communiceren: alles hier is een experiment, nooit klaar
- Businessmodel: donaties = stemmen (sats per app)
- Nieuwe gebruikers krijgen sats om mee te beginnen (Cashu/RGB/Taproot tokens)
- Obsidian vault voor alle Claude-gesprekken en ideeën

## Wat er gebouwd is

1. \`docs/vision.md\` — kernvisie
2. \`docs/infra.md\` — nsite subdomain toegevoegd
3. \`claude/CLAUDE.md\` — Astrid kent nu dual-world + donatie model
4. \`templates/DonationButton.tsx\` — React component (LNURL-pay + webln)
5. \`scripts/newapp.sh\` — DonationButton + donation-veld in tile.json
6. \`scripts/obsidian/\` — vault setup + capture + import + hook
7. \`docs/plan-donation-voting.md\` — Nostr voting roadmap

## Gerelateerd
- [[visie/dual-world]]
- [[visie/donatie-model]]
- [[visie/token-onboarding]]
- [[visie/perpetual-beta]]
EOF

echo ""
echo "✅ Vault aangemaakt op $VAULT"
echo ""
echo "📁 Structuur:"
find "$VAULT" -name "*.md" | sort | sed "s|$VAULT/||"
echo ""
echo "Volgende stappen:"
echo "  1. Open de vault in Obsidian: File → Open folder → $VAULT"
echo "  2. Installeer de capture-hook: bash $REPO/scripts/obsidian/install-hook.sh"
echo "  3. Importeer bestaande Claude-sessies: python3 $REPO/scripts/obsidian/import-history.py"
