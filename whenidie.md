# Als ik er niet meer ben — Goosie Labs Overdracht

> Dit document is geschreven voor mijn zoon (of wie mijn werk wil voortzetten).
> Het beschrijft wat Goosie Labs is, wat ik heb gebouwd, hoe alles werkt,
> en wat je nodig hebt om het voort te zetten of netjes af te sluiten.
>
> Geschreven door: Perry Smit (Goosie)
> Laatste update: 2026-05-26
> Laatst herzien (feiten): 2026-06-30

---

## Wat is Goosie Labs?

Goosie Labs is mijn persoonlijk lab. Ik onderzoek nieuwe technologie — niet als programmeur die alles uitdenkt voor hij begint, maar als ontdekker die al doende leert. Ik vlieg als een gans voorop, land op vreemde plekken, en bouw dingen die nog niet bestaan.

Het centrale thema van alles wat ik bouw: **vrijheid zonder tussenpersoon**.

Elke app draait op principes die ik belangrijk vind:
- **Nostr** — een open communicatieprotocol dat niemand kan afsluiten of censureren
- **Bitcoin & Lightning** — geld dat van jou is, zonder bank
- **Cashu** — digitale cash tokens, privé en niet traceerbaar
- **Zelfsoevereine identiteit** — jij beheert jouw eigen data en identiteit

Ik geloof in Austrian Economics (vrije markt, zo klein mogelijke overheid), en in het recht van mensen om hun eigen digitale leven te beheersen — zonder afhankelijk te zijn van Facebook, Google, of een bank.

---

## De server

Alles draait op één server:

| Gegeven | Waarde |
|---------|--------|
| **Domeinnaam** | goosielabs.com |
| **Server-IP** | 209.38.106.245 |
| **Provider** | DigitalOcean (VPS) |
| **Besturingssysteem** | Ubuntu 24.04 |
| **Toegang** | SSH: `ssh deploy` |
| **SSH-gebruiker** | `deploy` |

De server is gehuurd. Als je hem wilt afsluiten: opzeg het abonnement bij DigitalOcean via de account waaronder hij is aangemaakt — https://www.digitalocean.com

### Wat draait er op de server?

| Dienst | Wat het is | Adres |
|--------|-----------|-------|
| **WordPress** | De hoofdwebsite + app-overzicht | goosielabs.com |
| **Nostr relay** | Mijn eigen berichtenserver (strfry) | wss://relay.goosielabs.com |
| **Cashu mint** | Digitale contant-geld machine (Nutshell) | mint.goosielabs.com |
| **LNbits** | Lightning wallet backend voor apps | lnbits.goosielabs.com |
| **Apps** | Alle mini-applicaties | goosielabs.com/apps/\<naam\> |
| **IDidHere** | App op eigen subdomein | goosielabs.com/apps/ididhere/ |

### Services herstarten (als iets kapot gaat)

```bash
sudo systemctl restart strfry       # Nostr relay
sudo systemctl restart lnbits       # Lightning wallets
sudo systemctl restart nutshell     # Cashu mint
sudo nginx -s reload                # Webserver
sudo systemctl restart catchzaps-api # CatchZaps backend
```

---

## De Umbrel (thuis)

De Umbrel is een kleine minicomputer thuis die mijn Bitcoin Lightning node draait. Je hebt hem nodig om Lightning-kanalen te sluiten en sats op te halen.

| Hoe | Commando/adres |
|-----|---------------|
| **Via browser** (zelfde netwerk thuis) | http://umbrel.local |
| **Via terminal** (zelfde netwerk thuis) | `ssh umbrel` |
| **Via Tailscale** (overal, ook via server) | http://100.111.14.11 |
| **Inloggegevens** | Staan in LastPass |
| **2FA** | Op mijn mobiel (authenticator-app) — je hebt de telefoon nodig |

> Zonder 2FA kom je niet in. De telefoon is dus ook onderdeel van de nalatenschap.

### Wat draait op de Umbrel?

| App | Wat het doet |
|-----|-------------|
| **Lightning Node (LND)** | Mijn Bitcoin Lightning node |
| **Alby Hub** | Beheersinterface voor de Lightning node |
| **Mempool** | Mijn eigen Bitcoin blockchain explorer (poort 3006) |
| **Lightning Terminal** | Bevat ook de Taproot Assets daemon (tapd) |

### Waarvoor wordt de Umbrel gebruikt vanuit de server

De server (goosielabs.com) maakt verbinding met de Umbrel via **Tailscale** (een privé VPN-netwerk). Zo kan de server data van de Umbrel gebruiken zonder dat die publiek toegankelijk is.

| Wat | Hoe | Gevolg als Umbrel uit staat |
|-----|-----|-----------------------------|
| **Blockchain scan** (perry.html) | Mempool API op poort 3006 | ⚠️ Niet erg — scan slaat over, rest van de pagina werkt gewoon |
| **Lightning betalingen** (apps) | NWC via Alby Hub → LNbits | 🔴 Kritisch — alle Lightning betalingen in apps stoppen |
| **Cashu mint** | Via LNbits → Alby Hub | 🔴 Kritisch — mint.goosielabs.com kan geen tokens aanmaken |
| **LNbits** | Via NWC naar Alby Hub | 🔴 Kritisch — alle app-wallets in LNbits werken niet |

**Kort gezegd:**
- Umbrel even uit voor een update (paar minuten): apps geven een betaalfout, maar herstellen vanzelf zodra Umbrel terug is.
- Umbrel permanent uit: alle Lightning- en Cashu-functionaliteit stopt. Apps die sats verwerken zijn dan onbruikbaar.
- De **Nostr relay, de website en alle apps zelf** blijven gewoon werken — die draaien op de server, niet op de Umbrel.

### Belangrijk bij afsluiten

Als je de Umbrel wilt afsluiten en sats wilt terughalen:
1. Open Alby Hub via http://umbrel.local (of http://100.111.14.11 via Tailscale)
2. Sluit het Lightning-kanaal (met Megalith LSP) — dit kost wat tijd en een kleine Bitcoin-transactiefee
3. Wacht tot de sats on-chain zijn bijgeschreven
4. Stuur de sats naar een Bitcoin wallet die jij beheert

**Doe dit niet haastig** — een force-close van een kanaal kan sats vastzetten voor honderden blokken (dagen).

---

## Bitcoin & Lightning

Ik heb een eigen Lightning node thuis draaien op een **Umbrel** minicomputer.

| Gegeven | Waarde |
|---------|--------|
| **Lightning address** | zoomer@getalby.com |
| **Nostr public key (npub)** | npub14qpe36rvq0l6m3crplsntmnkzjm04weqflq0veqc8ra5hz4lpvxqqkdffc |
| **Alby Hub** | Beheert de Lightning node, draait op Umbrel thuis |
| **LND versie** | 0.20.1-beta |

Er is één actief Lightning kanaal (met Megalith LSP).

De **Cashu mint** (mint.goosielabs.com) maakt digitale cash tokens aan die gebruikt worden in de apps. Die is verbonden met LNbits, dat rechtstreeks via Tailscale is verbonden met mijn LND node op Umbrel.

### De seed phrase (24 woorden) — KRITIEK

De 24 woorden voor mijn Lightning node liggen fysiek opgeschreven op een veilige plek. Vraag dit na bij mensen die het weten.

**Waar je hem vindt als de Umbrel nog werkt:**
1. Open `http://umbrel.local` in je browser (op hetzelfde netwerk als de Umbrel)
2. Log in → open de **Lightning Node** app → instellingen → **Recovery phrase**

**Wat je ermee kunt:** hiermee herstel je alle Bitcoin op mijn on-chain wallet én alle Lightning-kanalen (samen met de channel.backup, zie hieronder).

### Dagelijkse automatische backup — LND + LNbits

Elke dag (via Blocky, ~144 blokken) draait `scb-backup` en slaat op:

| Wat | Waar op server | Waar offsite |
|-----|---------------|-------------|
| `channel.backup` (LND) | `/home/deploy/backups/lnd-scb/` | — |
| LNbits databases (6x) | `/home/deploy/backups/lnbits/` | `umbrel@100.111.14.11:/home/umbrel/lnbits-backup/` |
| LNbits `.env` config | `/home/deploy/backups/lnbits/` | `umbrel@100.111.14.11:/home/umbrel/lnbits-backup/` |
| LND cert + macaroon | `/home/deploy/backups/lnbits/` | `umbrel@100.111.14.11:/home/umbrel/lnbits-backup/` |

Alles: 14 versies bewaard. Offsite kopie staat op de Umbrel thuis — twee fysieke locaties.

**channel.backup ophalen (voor LND herstel):**
```bash
scp deploy@209.38.106.245:/home/deploy/backups/lnd-scb/channel.backup.latest ~/channel.backup
```

**LNbits backup ophalen van Umbrel:**
```bash
scp umbrel@umbrel.local:/home/umbrel/lnbits-backup/database.sqlite3 ~/lnbits-database.sqlite3
```

### Lightning node herstellen na hardware crash

Je hebt nodig: **24 seed words** + **channel.backup** bestand

1. Haal `channel.backup.latest` op van de server (commando hierboven)
2. Nieuwe Umbrel installeren (of dezelfde herstarten)
3. Open de **Lightning Node** app → kies **"Restore existing wallet"**
4. Voer de 24 seed words in
5. Upload het `channel.backup` bestand
6. LND force-closet alle kanalen — sats komen na enkele uren/dagen terug op de on-chain wallet
7. Stuur de on-chain sats daarna naar een andere wallet die jij beheert

---

## Wachtwoordmanager

Alle wachtwoorden, API keys en privésleutels staan in **LastPass**.

- **Account:** inloggen op lastpass.com met mijn e-mailadres (`perry.smit@gmail.com`)
- **Master password:** het wachtwoord dat ik gebruikte voor LastPass zelf — vraag dit na bij mensen die het weten, of zoek het op in mijn fysieke nalatenschap

In LastPass vind je onder andere:
- SSH-toegang tot de server (wachtwoord of sleutelbestand)
- DigitalOcean account (server)
- Domeinregistrar (goosielabs.com)
- GitHub account (Goosie)
- Nostr privésleutel (nsec)
- Alby Hub / Umbrel wachtwoord (Lightning node)

---

## Mijn GitHub

Alle code staat op GitHub:
- **Organisatie:** https://github.com/Goosie
- **Credentials:** Opgeslagen in `~/.git-credentials` op de server (HTTPS tokens)

Elke app heeft z'n eigen privé repo. Als je iets wilt openmaken of archiveren: ga naar GitHub, ga naar de repo, settings → "Archive this repository" of "Delete this repository".

---

## De applicaties die ik heb gebouwd

### LIVE — Dit draait echt

| App | Wat het doet | Adres |
|-----|-------------|-------|
| **Routstr** | Nostr-identiteitsinfrastructuur voor organisaties — mijn meest volwassen project | goosielabs.com |
| **Goosie Mint** | Cashu ecash mint — digitale cash die je privé kunt uitgeven | mint.goosielabs.com |

### IN BOUW — Hier was ik mee bezig

| App | Wat het doet | Locatie op server | Repo |
|-----|-------------|------------------|------|
| **CatchZaps** | Drop sats (mini-Bitcoin) op de kaart. Anderen lopen erheen en vangen ze op | /apps/catchzaps | github.com/Goosie/catchzaps |
| **ZapHunt** | Bouw een quiz-speurtocht met AI-hulp. Prize pool via Lightning. Spelers verdienen sats per goed antwoord | /apps/zaphunt | github.com/Goosie/zaphunt |
| **IDidHere** | Bucket list van wat je wil doen en waar. Bewijs wat je gedaan hebt als badge in je Nostr-identiteit | goosielabs.com/apps/ididhere/ | github.com/Goosie/ididhere |
| **ZinIn** | Als twee mensen op hetzelfde moment ergens zin in hebben zonder het van elkaar te weten, brengt deze app hen samen | /apps/zinin | github.com/Goosie/zinin-demo |
| **LastWill** | Digitale nalatenschap op Nostr. Dead man's switch: druk regelmatig op "I'm still alive" anders worden je versleutelde acties uitgevoerd | /apps/lastwill | github.com/Goosie/lastwill |
| **Dilemma** | Post een dilemma met een sat-bounty. Anderen geven advies, de gemeenschap stemt, jij kiest de winnaar — die de sats krijgt | /apps/dilemma | github.com/Goosie/dilemma |
| **Feedback** | Eerlijke anonieme feedback op ideeën/producten. Anoniem via Nostr-cryptografie. Invuller krijgt direct sats betaald | /apps/feedback | github.com/Goosie/feedback |
| **Weddendat** | P2P wedden met sats. Gooi een weddenschap op tafel, tegenpartij accepteert, arbiter beslist, Lightning betaalt automatisch | /apps/weddendat | github.com/Goosie/weddendat |
| **Nospass** | Wachtwoord-achtig iets op Nostr (nog niet uitgewerkt) | /apps/nospass | github.com/Goosie/nospass |

### EXPERIMENT — Verkend, niet af

| App | Wat het doet | Locatie |
|-----|-------------|---------|
| **Sofia** | Nostr reisapp voor groepstrips — privé trip-coördinatie zonder Facebook | /apps/sofia |
| **ProofOfMove** | Train bewegingen: je schaduw over een avatar corrigeert je in realtime. Correct = sats verdienen | /apps/proofofmove |

---

## Het AI-team (de "V-formatie")

Ik werk samen met een team van AI-agenten — elk met een eigen rol. Dit zijn geen echte mensen, maar AI-assistenten die ik heb geconfigureerd om te helpen.

De naam "V-formatie" komt van hoe ganzen vliegen: de voorste gans breekt de wind, de rest volgt in formatie. Ik ben de voorste gans.

| Gans | Wat die doet | Hoe aanroepen |
|------|-------------|---------------|
| **Assistenty** | Mijn persoonlijke lab-assistent. Kent alles, houdt bij waar ik was, maakt overzichten. | De standaard assistent in Claude Code |
| **Blocky** | **De klok van de V-Formatie.** Luistert naar Bitcoin-blokken en triggert andere ganzen op het juiste moment. Geen cron, geen server-klok — Bitcoin is het ritme. | `goosie blocky schedule` voor overzicht |
| **Healthy** | Server health monitor. Stuurt elke ~40 minuten een Nostr DM naar Perry met de status van de server (RAM, swap, disk, services). Rood = probleem. | `goosie healthy check` of wacht op DM |
| **Jurry** | Juridisch adviseur. Controleert alle apps op juridische risico's (privacywet, gokwet, erfrecht etc.) | `goosie jurry overview` in terminal |
| **Ay** | AI-configuratie specialist. Checkt of alle ganzen-configuraties kloppen | `goosie ay check` in terminal |
| **Testy** | QA-tester. Test apps, maakt testdata aan | `goosie testy <appnaam> test` in terminal |
| **Devy** | DevOps rol — git, backups, server-onderhoud | Typ `@devy` in gesprek met Assistenty |
| **Transy** | Vertaler & lokalisatie — vertaalt de apps naar NL/DE/ES | Typ `@transy` in gesprek |
| **Finny** | Chief Financial Goose — bewaakt kosten en inkomsten in sats | Typ `@finny` in gesprek |

**Wat is Claude Code?**
Dit is de AI-tool waarmee ik bouw. Gemaakt door Anthropic. Je start het met het commando `claude` in de terminal. Assistenty "leeft" in de configuratiebestanden en weet alles over het project.

---

## Hoe ik werk (voor wie het wil voortzetten)

### SSH-toegang instellen

Ik werk vanaf twee apparaten: mijn desktop-pc en mijn mobiel (Termux). Beide hebben een eigen SSH-sleutel.

**Desktop → server:** de SSH-alias `deploy` staat ingesteld in `~/.ssh/config` op mijn pc. De sleutel zit in LastPass.

**Mobiel (Termux) → server:** Termux heeft een aparte sleutel. De configuratie staat in `~/.ssh/config` op de telefoon:

```
Host deploy
    HostName 209.38.106.245
    User deploy
    IdentityFile ~/.ssh/id_ed25519
```

Als je een nieuw apparaat toegang wilt geven:

```bash
# Op het nieuwe apparaat — sleutel aanmaken:
ssh-keygen -t ed25519 -C "omschrijving-apparaat"

# Publieke sleutel ophalen:
cat ~/.ssh/id_ed25519.pub

# Op de server (via een apparaat dat al toegang heeft):
echo "PLAK_PUBLIEKE_SLEUTEL" >> ~/.ssh/authorized_keys
```

---

### Sessies met tmux

Ik werk via een terminal op de server. Sessies blijven draaien ook als ik mijn pc uitzet, via **tmux**.

```bash
# Verbinden met de server:
ssh deploy

# Alle draaiende sessies zien:
tmux ls

# Verbinden met een sessie:
tmux attach -t <naam>

# Alle apps tegelijk openen:
startmytmux

# Een bestaande app hervatten:
openapp <appnaam>
```

### Een nieuwe app bouwen

```bash
newapp <naam>
```

Dit doet automatisch alles: map aanmaken, GitHub repo aanmaken, bouw, Nginx-configuratie, icon genereren.

### Een app deployen na wijzigingen

```bash
cd /var/www/goosielabs/apps/<naam>
npm run build
# Dat is het. Nginx serveert automatisch.
```

### Backup — vier lagen

**Laag 1 — Dagelijkse LND + LNbits backup (kritiek)**

Blocky triggert elke ~144 blokken (~1 dag) het `scb-backup` script:
- `channel.backup` van Umbrel → server
- Alle LNbits databases → server én offsite naar Umbrel
- LNbits config (`.env`, cert, macaroon) → server én Umbrel

Handmatig draaien:
```bash
goosie scb-backup backup
```

Offsite kopie op Umbrel: `/home/umbrel/lnbits-backup/`

**Laag 2 — Wekelijkse server-snapshot via Backy**

Blocky triggert elke ~1000 blokken (~1 week) een volledige DO server-snapshot via Backy.

```
Blocky (~1000 blokken) → NIP-90 job → Backy → DO snapshot API → DM resultaat → Perry
```

Handmatig triggeren:
```bash
honk from @perry "snapshot" to @backy
```

Restore na crash: DO dashboard → Snapshots → Create Droplet from snapshot.

**Laag 3 — Lokale backup vóór grote wijzigingen**

```bash
/home/deploy/backup.sh
```

Altijd doen vóór grote wijzigingen. Maakt git snapshot + SQLite dump.

**Laag 4 — Key rotation backups**

`rotatekey <gans>` maakt automatisch een backup van alle getroffen bestanden in:
`/home/deploy/key-rotation-backups/<gans>-<timestamp>/`

---

### Sleutelrotatie — als een gans-key gecompromitteerd is

```bash
rotatekey <naam>              # bijv: rotatekey finny
rotatekey <naam> --dry-run   # eerst kijken wat er verandert
```

Dit script doet automatisch (in volgorde):
1. Backup van alle bestanden
2. Bunker stoppen
3. Oude key **direct** uit whitelist — relay blokkeert die meteen
4. Nieuw keypaar genereren
5. Transitie-announcement publiceren vanuit de OUDE key
6. `nostr-key.json` + `bunker.env` bijwerken
7. `sync-configs` aanroepen → alle afgeleide bestanden regenereren
8. Kind:0 profiel publiceren vanuit NIEUWE key
9. Bunker herstarten + Swarm rebuilden

⚠️ Oude relay-events blijven staan — Nostr-events zijn immutable.
Monitor de relay na rotatie: `nak req -p <oude-pubkey> wss://relay.goosielabs.com`

---

## De technologie (kort)

Je hoeft dit niet allemaal te kennen, maar dit is wat er gebruikt wordt:

| Technologie | Wat het is | Waarom |
|-------------|-----------|--------|
| **React + TypeScript** | Frontend (wat je in de browser ziet) | Snel, typeveilig |
| **Vite** | Build-tool voor de frontend | Snel en modern |
| **Tailwind CSS** | Stijlen (hoe dingen eruitzien) | Makkelijk aanpassen |
| **Node.js + Express** | Backend (server-side logica) | Zelfde taal als frontend |
| **Nostr** | Open communicatieprotocol | Censuurresistent, geen centrale server |
| **nostr-tools + Nostrify** | Nostr-bibliotheken | Kant-en-klare bouwstenen |
| **NIP-07** | Login via browser-extensie (Alby, nos2x) | Privésleutel verlaat nooit je apparaat |
| **Lightning** | Betalingen in Bitcoin | Direct, goedkoop, wereldwijd |
| **Cashu** | Digitale cash tokens | Privé, niet traceerbaar |
| **WordPress** | Hoofdwebsite | Simpel te beheren |
| **Nginx** | Webserver | Stuurt verkeer naar de juiste app |
| **Ubuntu 24.04** | Server OS | Stabiel, veel ondersteuning |

---

## Nostr — het hart van alles

Bijna alle apps zijn gebouwd op **Nostr** (Notes and Other Stuff Transmitted by Relays).

**Wat is Nostr?**
Een open protocol waarbij berichten via meerdere servers (relays) worden verstuurd. Niemand kan je account verwijderen, niemand kan je censureren. Je identiteit is een cryptografisch sleutelpaar — jij beheert dat.

**Mijn Nostr-identiteit:**
- Publieke sleutel (npub): `npub14qpe36rvq0l6m3crplsntmnkzjm04weqflq0veqc8ra5hz4lpvxqqkdffc`
- De bijbehorende privésleutel (nsec) zit in mijn wachtwoordmanager

**Mijn relay:** `wss://goosielabs.com/relay`
Dit is mijn eigen Nostr-berichtenserver. Alle apps sturen berichten hier langs.

---

## Bestandsstructuur op de server

```
/home/deploy/
├── agents/             ← AI-team beschrijvingen (wie doet wat)
│   ├── astrid/
│   ├── jurry/
│   ├── haitje/
│   ├── tessa/
│   ├── danky/
│   ├── ruby/
│   └── finny/
├── scripts/            ← Hulpscripts (jurry, haitje)
├── systemsetup/        ← Server setup scripts
├── templates/
│   └── nostr-boilerplate/  ← Template voor nieuwe apps
├── CLAUDE.md           ← Instructies voor de AI (Astrid)
├── backup.sh           ← Backup script
└── whenidie.md         ← Dit bestand

/var/www/goosielabs/
├── (WordPress bestanden)
├── apps/
│   ├── catchzaps/      ← CatchZaps
│   ├── zaphunt/        ← ZapHunt
│   ├── ididhere/       ← IDidHere
│   ├── zinin/          ← ZinIn
│   ├── lastwill/       ← LastWill
│   ├── dilemma/        ← Dilemma
│   ├── feedback/       ← Feedback
│   ├── weddendat/      ← Weddendat
│   ├── nospass/        ← Nospass
│   ├── sofia/          ← Sofia
│   └── proofofmove/    ← ProofOfMove
└── generate-icons.mjs  ← App-icoon generator
```

---

## Juridische status van de apps

Jurry heeft alle apps beoordeeld (laatste check: 21 mei 2026).

**Hoog risico (juridisch consult aanbevolen voor launch):**
- **Weddendat** — valt mogelijk onder de Wet op de Kansspelen
- **LastWill** — raakt aan erfrecht; is géén juridisch geldig testament
- **CatchZaps** — locatiedata + betalingen combinatie
- **ZapHunt** — AI-aansprakelijkheid + deposito-structuur

**Gemiddeld risico:**
- **Dilemma** — escrow-constructie nooit via Goosie Labs wallet
- **ZinIn** — zorgplicht bij fysieke ontmoetingen, 18+ check
- **ProofOfMove** — camerabeelden client-side houden, blessure-disclaimer

**Laag risico:** IDidHere, Feedback, Sofia

**Openstaand voor alle apps:**
- Privacyverklaring ontbreekt op goosielabs.com
- Algemene voorwaarden ontbreken
- Lightning/Cashu: meldingsplicht DNB bij opschaling (als het echt groot wordt)

---

## Achtergrondprocessen (draaien altijd op de server)

Naast de AI-agenten zijn er processen die als systemd services draaien en direct met de relay en Bitcoin-netwerk communiceren.

| Service | Commando | Wat |
|---------|----------|-----|
| **Blocky** | `sudo systemctl status blocky` | De klok. Luistert naar Bitcoin-blokken en triggert alle ganzen via NIP-90. **Als Blocky stopt, stopt de hele V-formatie.** |
| **Backy** | `sudo systemctl status backy` | Maakt automatisch server-snapshots op Blocky's signaal via DigitalOcean API. |
| **Healthy** | `goosie healthy check` | Server health monitor. Stuurt Perry elke ~30 min een DM. Als Perry geen DMs meer krijgt: iets is mis. |
| **Goose-runner** | `sudo systemctl status goose-runner` | Luistert op de relay naar NIP-90 job requests van Blocky en voert de juiste gans uit. |
| **Assistenty DM** | `sudo systemctl status astrid-dm` | Luistert naar DM-commando's van Perry voor whitelist-beheer. |

**Schema bekijken (wie doet wat wanneer):**
```bash
goosie blocky schedule
```

**Als iets niet meer werkt:**
```bash
sudo systemctl restart blocky
sudo systemctl restart goose-runner
sudo systemctl restart backy
```

### Reed aansturen

Reed luistert op de relay naar versleutelde DMs (NIP-17) geadresseerd aan haar pubkey. Alleen jouw pubkey mag commando's sturen.

Stuur haar een DM via een Nostr client (bijv. Amethyst, Damus, Iris):

| Commando | Effect |
|----------|--------|
| `add <npub>` | Pubkey toelaten op de relay |
| `remove <npub>` | Pubkey blokkeren |
| `list` | Alle toegelaten pubkeys tonen |
| `help` | Beschikbare commando's |

**Reed herstarten:**
```bash
sudo systemctl restart reed
```

**Whitelist bekijken:**
```bash
cat /home/deploy/whitelist.json
```

**Code:** `/home/deploy/geese/reed/`

---

## Ideeën die ik nog had

- **Decentralized learning + Bitcoin diploma's** — Ordinals/OP_RETURN als bewijs van kennis
- **Termux mobiele workflow** — server beheren vanaf telefoon via Tailscale
- **Mountainbike trip webapp** — live locatie voor Bulgaria trip
- **Honky** — Matchmaker gans. Koppelt #ihave en #iwant events op de relay
- **Tai Chi song** — Nederlandse mnemonic voor 60 Chen-bewegingen (geen app, tekst)

---

## Wat kost dit?

- **Server (DigitalOcean):** maandelijkse kosten, exact bedrag in de e-mail van DigitalOcean
- **Domein (goosielabs.com):** jaarlijkse kosten bij de domeinregistrar
- **GitHub:** gratis voor privé repos (Goosie organisatie)
- **Umbrel Lightning node thuis:** eenmalige hardware, geen abonnement

---

## Als je het wilt voortzetten

1. **Verbinding maken met de server:** `ssh deploy` — je hebt mijn SSH-sleutel of wachtwoord nodig (staat in mijn wachtwoordmanager)
2. **Overzicht krijgen:** `tmux ls` en `ls /var/www/goosielabs/apps/`
3. **Alle beschikbare commando's zien:** typ `goosie` in de terminal — toont een overzicht van newapp, openapp, gans, tmux-sneltoetsen etc. (bronbestand: `~/.bashrc.d/goosie.sh`)
4. **AI-assistent starten:** `claude` in de terminal — Astrid kent alles
5. **Vraag Astrid** gewoon in het Nederlands wat je wilt weten

Astrid is geconfigureerd om dit project te begrijpen. Als je de server opent en `claude` typt, kun je gewoon vragen: *"Wat is de status van dit project?"* of *"Wat zijn de openstaande taken?"*

---

## Als je het wilt afsluiten

1. **Apps offline halen:** alle apps gaan offline als je de server opzegt
2. **Code bewaren:** download de repos van github.com/Goosie voor je ze verwijdert
3. **Server opzeggen:** via het DigitalOcean account
4. **Domein opzeggen:** via de domeinregistrar (staat in mijn e-mail)
5. **Lightning kanaal sluiten:** via Alby Hub op Umbrel — doe dit niet haastig, kanalen sluiten kost Bitcoin-transaction fees en duurt even

---

## Mijn overtuigingen — waarom ik dit deed

Ik geloof dat mensen recht hebben op:
- Geld dat van henzelf is (Bitcoin)
- Communicatie die niet afluisterd of gecensureerd kan worden (Nostr)
- Een digitale identiteit die niemand van hen af kan nemen

Grote tech-bedrijven, overheden en banken maken mensen afhankelijk. Ik bouw alternatieven. Kleine experimenten, maar samen vormen ze iets groters.

Als je dit werk wilt voortzetten: volg je instinct, leer al doende, en wees niet bang om te landen op vreemde plekken. Zo vliegen ganzen.

---

*"De eerste gans breekt de wind. De rest vliegt makkelijker."*

---

## Taking over with new keys — complete technical handover

> This section is written in English for technical clarity.
> It describes every step needed to take full control of Goosie Labs
> under a completely new set of Nostr keys.
>
> Read `key-management.md` alongside this section for more detail on key procedures.

### What keys exist and where they live

**Perry's main Nostr key (controls everything)**

| What | Value |
|---|---|
| npub | npub14qpe36rvq0l6m3crplsntmnkzjm04weqflq0veqc8ra5hz4lpvxqqkdffc |
| pubkey hex | a80398e86c03ffadc7030fe135ee7614b6fabb204fc0f6641838fb4b8abf0b0c |
| nsec | In LastPass (never stored on server) |
| NIP-05 identities | perry@goosielabs.com, goosie@goosielabs.com, zoomer@goosielabs.com |

**Drie sleutelcategorieën**

**Categorie 1 — Admins/Generaals** (menselijke identiteiten, niet in agents/)
Perry's eigen keys staan in zijn wachtwoordmanager. Op de server alleen de pubkeys in `whitelist.json`.

**Categorie 2 — Ganzen** (AI-agents, allemaal gelijk behandeld)
Elk keypaar: `/home/deploy/agents/<naam>/nostr-key.json`
Bevat: `pubkey`, `npub`, `nsec` (bech32), `nsecHex`

Live overzicht van alle ganzen en hun actuele npubs:
```bash
jq -r '.agents[] | "\(.name): \(.npub)"' /home/deploy/agents/agents.json
```

Of via NIP-05: elke gans is bereikbaar als `<naam>@goosielabs.com`

⚠️ De tabel hieronder is bewust NIET bijgehouden — keys kunnen roteren.
Gebruik altijd `agents.json` als actuele bron, nooit deze statische tabel.

**Categorie 3 — Apps/Projecten** (TBD)
Nog te bepalen: eigen projectgans per app of alleen Lightning-adres via LNbits.

---

### Step-by-step: taking full control with new keys

**Before you start:**
- You have SSH access to the server (`ssh deploy` from a terminal)
- You have access to LastPass (for reference, not for reusing Perry's keys)
- You have a fresh Nostr keypair (generate one — instructions below)

---

#### 1. Generate your own new keypair

SSH to the server, then run:

```bash
node --input-type=module << 'EOF'
import { generateSecretKey, getPublicKey } from '/var/www/goosielabs/apps/catchzaps/node_modules/nostr-tools/lib/esm/index.js';
import { nip19 } from '/var/www/goosielabs/apps/catchzaps/node_modules/nostr-tools/lib/esm/index.js';

const sk = generateSecretKey();
const pk = getPublicKey(sk);
const nsecHex = Buffer.from(sk).toString('hex');

console.log('nsec bech32:', nip19.nsecEncode(sk));
console.log('nsec hex   :', nsecHex);
console.log('npub bech32:', nip19.npubEncode(pk));
console.log('npub hex   :', pk);
EOF
```

Write both `nsec hex` and `npub hex` on paper. Store the nsec somewhere safe (password manager). Clear your terminal:
```bash
clear && history -c
```

We'll call your new values:
- `NEW_PUBKEY_HEX` = your new pubkey hex (64 chars, public)
- `NEW_NSEC_HEX`   = your new nsec hex (64 chars, keep secret)

---

#### 2. Update the nsite gateway

The gateway serves the website. It has Perry's pubkey hardcoded.

```bash
nano /home/deploy/nsite-gateway/server.js
```

Find line 6:
```javascript
const PUBKEY = 'a80398e86c03ffadc7030fe135ee7614b6fabb204fc0f6641838fb4b8abf0b0c';
```
Replace with your `NEW_PUBKEY_HEX`.

Save (Ctrl+O, Enter, Ctrl+X), then restart:
```bash
sudo systemctl restart nsite-gateway
```

---

#### 3. Update the relay whitelist

The relay only accepts events (posts, website manifests) from pubkeys in this list.

```bash
nano /home/deploy/whitelist.json
```

Add your `NEW_PUBKEY_HEX` as a new entry in the JSON array:
```json
[
  "NEW_PUBKEY_HEX",
  "a80398e86...",   ← keep Perry's for now, remove later
  ...
]
```

Save the file. The relay reads the whitelist in real time — no restart needed.

---

#### 4. Update Blossom (file storage)

Blossom stores the website files. Only whitelisted pubkeys get permanent storage.

```bash
nano /home/deploy/blossom/config.yml
```

There are two `pubkeys:` lists in this file (one under `image/*`, one under `*`).
In both lists, add your `NEW_PUBKEY_HEX`. You can also replace Perry's pubkey.

Example (both lists should be identical):
```yaml
    pubkeys:
      - "NEW_PUBKEY_HEX"        # You (new owner)
      - "008a049c363920..."      # Astrid (keep agent keys)
      - "0cd2e60d422b94..."      # Danky
      ... etc
```

Save, then restart:
```bash
sudo systemctl restart blossom
```

---

#### 5. Update NIP-05 verification

NIP-05 is how Nostr clients verify identities like `perry@goosielabs.com`.
The file is served from WordPress.

```bash
nano /var/www/goosielabs/.well-known/nostr.json
```

Current content:
```json
{
  "names": {
    "_":      "a80398e86...",
    "perry":  "a80398e86...",
    "goosie": "a80398e86...",
    "zoomer": "a80398e86...",
    "astrid": "008a049c3...",
    ...
  }
}
```

Replace all occurrences of Perry's pubkey with your `NEW_PUBKEY_HEX`.
Or replace the name entries entirely with your own name:
```json
{
  "names": {
    "_":       "NEW_PUBKEY_HEX",
    "yourname": "NEW_PUBKEY_HEX",
    "astrid":  "008a049c3...",
    ...
  }
}
```

Verify it works:
```bash
curl https://goosielabs.com/.well-known/nostr.json
```

---

#### 6. Republish the website with your new key

The website (nsite) is a set of files signed by the owner's Nostr key.
You need to sign and publish a new manifest.

```bash
read -s NOSTR_NSEC && export NOSTR_NSEC
# Type your NEW_NSEC_HEX and press Enter (nothing shown on screen)

cd /home/deploy/nsite-test
node publish.mjs ./site
```

Expected output:
```
Publishing 2 file(s) from ./site
  uploading /index.html ... ✓ abc123...
  uploading /404.html   ... ✓ def456...
  publishing kind 15128 manifest ... ✓ accepted
Done. Site is live at https://nsite.goosielabs.com
```

Wait 60 seconds (cache TTL), then open **https://nsite.goosielabs.com** — the site should load.

---

#### 7. Update the agent keys (optional but recommended)

The agent keypairs are stored in JSON files. If you want the AI team to have fresh identities:

```bash
# For each agent, generate a new keypair and update the file
# Example for Astrid:
node --input-type=module << 'EOF'
import { generateSecretKey, getPublicKey } from '/var/www/goosielabs/apps/catchzaps/node_modules/nostr-tools/lib/esm/index.js';
import { nip19 } from '/var/www/goosielabs/apps/catchzaps/node_modules/nostr-tools/lib/esm/index.js';
import { writeFileSync } from 'fs';

const sk = generateSecretKey();
const pk = getPublicKey(sk);
const data = {
  pubkey: pk,
  npub: nip19.npubEncode(pk),
  nsec: nip19.nsecEncode(sk),
  nsecHex: Buffer.from(sk).toString('hex'),
};
writeFileSync('/home/deploy/agents/astrid/nostr-key.json', JSON.stringify(data, null, 2));
console.log('Astrid new npub:', data.npub);
EOF
```

Repeat for each agent: danky, finny, haitje, jurry, ruby, secury, tessa.

After updating agent keys, also update:
- `/home/deploy/blossom/config.yml` — update agent pubkeys in both `pubkeys:` lists
- `/home/deploy/whitelist.json` — replace old agent pubkeys with new ones
- `/var/www/goosielabs/.well-known/nostr.json` — update agent entries

---

#### 8. Verify everything works

```bash
# Gateway serving correctly?
curl -s http://127.0.0.1:3340/ | head -3

# All services running?
systemctl is-active nsite-gateway blossom strfry lnbits nutshell

# NIP-05 returning your new pubkey?
curl -s https://goosielabs.com/.well-known/nostr.json | python3 -m json.tool

# Website loading?
curl -s https://nsite.goosielabs.com | head -5
```

---

#### 9. Update CLAUDE.md so Astrid knows the new owner

```bash
nano /home/deploy/.claude/CLAUDE.md
```

Find the line with Perry's npub and replace with yours.
Also update `/home/deploy/CLAUDE.md` (the project-level instructions).

This makes the AI assistant aware of the new owner identity.

---

#### 10. Lightning and Bitcoin (separate from Nostr)

The Lightning node is on the **Umbrel** (a home computer, not the server).
Nostr keys do NOT control Lightning directly — unless NWC connections were set up.

To take control of the Lightning funds:
1. Get physical access to the Umbrel, OR connect via the home network
2. Open Alby Hub: **http://umbrel.local:59000**
3. The login credentials are in LastPass
4. You also need the 2FA code from Perry's phone (authenticator app)

If you cannot get 2FA access, the funds are locked in Alby Hub but the LND node underneath can still be accessed directly via terminal if you have the Umbrel password.

**To withdraw all funds:**
1. In Alby Hub → Channels → Close channel with Megalith LSP
2. Wait for on-chain confirmation (can take hours to days)
3. The sats will appear in the on-chain wallet
4. Send them to a Bitcoin address you control

**Important:** Do not force-close a channel unless you have no other option. Force-close locks funds for ~144 blocks (~1 day) due to the Lightning protocol's safety mechanism.

---

#### Summary checklist

- [ ] Generated new keypair, nsec stored safely
- [ ] `/home/deploy/nsite-gateway/server.js` — PUBKEY updated → service restarted
- [ ] `/home/deploy/whitelist.json` — new pubkey added
- [ ] `/home/deploy/blossom/config.yml` — pubkeys updated → service restarted
- [ ] `/var/www/goosielabs/.well-known/nostr.json` — NIP-05 updated
- [ ] nsite republished with new key → https://nsite.goosielabs.com loads
- [ ] Agent keys regenerated (optional)
- [ ] CLAUDE.md files updated with new owner npub
- [ ] Lightning funds secured (if Umbrel accessible)
- [ ] Old pubkey removed from whitelist.json (after 1 week)

---

*Full key management procedures: `/home/deploy/key-management.md`*

<!-- last updated: 2026-05-28 -->
