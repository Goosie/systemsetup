# Als ik er niet meer ben — Goosie Labs Overdracht

> Dit document is geschreven voor mijn zoon (of wie mijn werk wil voortzetten).
> Het beschrijft wat Goosie Labs is, wat ik heb gebouwd, hoe alles werkt,
> en wat je nodig hebt om het voort te zetten of netjes af te sluiten.
>
> Geschreven door: Perry Smit (Goosie)
> Laatste update: 2026-05-26

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
| **Nostr relay** | Mijn eigen berichtenserver (strfry) | wss://goosielabs.com/relay |
| **Cashu mint** | Digitale contant-geld machine (Nutshell) | mint.goosielabs.com |
| **LNbits** | Lightning wallet backend voor apps | lnbits.goosielabs.com |
| **Apps** | Alle mini-applicaties | goosielabs.com/apps/\<naam\> |
| **IDidHere** | App op eigen subdomein | ididhere.goosielabs.com |

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
| **Inloggegevens** | Staan in LastPass |
| **2FA** | Op mijn mobiel (authenticator-app) — je hebt de telefoon nodig |

> Zonder 2FA kom je niet in. De telefoon is dus ook onderdeel van de nalatenschap.

### Wat draait op de Umbrel?

| App | Wat het doet |
|-----|-------------|
| **Lightning Node (LND)** | Mijn Bitcoin Lightning node |
| **Alby Hub** | Beheersinterface voor de Lightning node |
| **Lightning Terminal** | Bevat ook de Taproot Assets daemon (tapd) |

### Belangrijk bij afsluiten

Als je de Umbrel wilt afsluiten en sats wilt terughalen:
1. Open Alby Hub via http://umbrel.local
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

De **Cashu mint** (mint.goosielabs.com) maakt digitale cash tokens aan die gebruikt worden in de apps. Die is verbonden met LNbits, dat verbonden is met Alby Hub.

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
| **IDidHere** | Bucket list van wat je wil doen en waar. Bewijs wat je gedaan hebt als badge in je Nostr-identiteit | ididhere.goosielabs.com | github.com/Goosie/ididhere |
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
| **Astrid** | Mijn persoonlijke lab-assistent. Kent alles, houdt bij waar ik was, maakt overzichten. Dit ben ik aan het typen als ik "hey Astrid..." schrijf. | De standaard assistent in Claude Code |
| **Jurry** | Juridisch adviseur. Controleert alle apps op juridische risico's (privacywet, gokwet, erfrecht etc.) | `gans jurry overview` in terminal |
| **Haitje** | AI-configuratie specialist. Checkt of alle ganzen-configuraties kloppen | `gans haitje check` in terminal |
| **Tessa** | QA-tester. Test apps, maakt testdata aan | `gans tessa <appnaam> test` in terminal |
| **Danky** | DevOps rol — git, backups, server-onderhoud | Typ `@danky` in gesprek met Astrid |
| **Ruby** | Chief Reality Officer — stelt de kritische vragen, pikt onrealistische plannen op | Typ `@ruby` in gesprek met Astrid |
| **Finny** | Chief Financial Goose — bewaakt kosten en inkomsten in sats | Typ `@finny` in gesprek met Astrid |

**Wat is Claude Code?**
Dit is de AI-tool waarmee ik bouw. Gemaakt door Anthropic. Je start het met het commando `claude` in de terminal. Astrid "leeft" in de configuratiebestanden en weet alles over het project.

---

## Hoe ik werk (voor wie het wil voortzetten)

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

### Backup maken

```bash
/home/deploy/backup.sh
```

Altijd doen vóór grote wijzigingen.

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

## Relay-ganzen (draaien op de server, gekoppeld aan de Nostr relay)

Naast de AI-agenten zijn er ganzen die als achtergrondprocessen op de server draaien en direct met de Nostr relay communiceren.

| Gans | Status | Wat |
|------|--------|-----|
| **Reed** | LIVE — draait als systemd service (`reed.service`) | Poortwachter van de relay. Beheert de whitelist van pubkeys die naar de relay mogen schrijven. Je stuurt haar versleutelde DMs via een Nostr client. |
| **Honky** | IDEE — niet gebouwd | Matchmaker. Koppelt #iwant en #ihave events op de relay en stuurt een versleutelde intro tussen de twee partijen. |

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
3. **AI-assistent starten:** `claude` in de terminal — Astrid kent alles
4. **Vraag Astrid** gewoon in het Nederlands wat je wilt weten

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

<!-- last updated: 2026-05-26 -->
