# Goosie Labs — Visie

## Twee Werelden, Één Lab

Goosie Labs draait in twee parallelle werelden:

| Wereld | URL | Wat het is |
|--------|-----|------------|
| Centraal | `goosielabs.com` | WordPress + Nostr apps — vertrouwd, vindbaar, makkelijk te delen |
| Decentraal | `nsite.goosielabs.com` | Nostr-native nsite — bestanden gesigneerd op Nostr, geen server nodig |

De **apps** (`/var/www/goosielabs/apps/`) zijn dezelfde in beide werelden. WordPress serveert ze via nginx. De nsite gateway serveert dezelfde builds via Nostr-gecertificeerde bestanden.

We bouwen op WordPress, maar pushen content ook naar nsite. We houden allebei in de lucht.

---

## Dit Lab Is Nooit Klaar

Dat is een functie, geen bug.

Elke dag nieuwe ideeën. Uitvoeren. Pivotten. Soms halverwege stoppen. Soms terugkomen. Soms weggooien en opnieuw beginnen. We delen het proces, niet alleen het eindproduct.

**Wat dit betekent op de site:**
- We zijn eerlijk dat alles hier experiment is
- Gebruikers mogen spelen met wat er staat
- Ideeën mogen worden geforkt, aangepast, verbeterd
- We leggen **uit waarom** we iets bouwen en waarom we veranderen van koers

---

## Bouwen in het Openbaar

We bouwen live. Soms op een conference call. Soms midden in een gesprek. Dat is de methode.

De site vertelt het verhaal achter de apps:
- Waarom bouwen we dit?
- Wat proberen we te leren?
- Waarom zijn we gestopt of van richting veranderd?
- Wat is het volgende idee?

Bezoekers zijn geen gebruikers — het zijn medeëxperimenteerders.

---

## Businessmodel: Donaties als Stemmen

Geen abonnementen. Geen ads. Geen investor-druk.

**Elke app krijgt een "Motiveer ons" knop.** Als een idee je aanspreekt, geef je sats. Dat is tegelijk een donatie én een stem.

> "Vind je dit leuk? Geef 21 sats — direct, anoniem, via Lightning."

Effecten:
- We zien welke ideeën mensen raken (sats = stemmen)
- Geen druk om iets "af te maken" — alleen om iets te *proberen*
- Perry en het lab lopen op community-energie

### Technische implementatie

- Elke app heeft een `DonationButton` component
- Betaling via Lightning (LNURL-pay of NWC)
- Betaling wordt optioneel als Nostr-event gepubliceerd (zap of vote-note)
- Tile op de homepage toont totaal ontvangen sats per app
- Per app: eigen LNbits wallet voor tracking, fallback naar `zoomer@getalby.com`

---

## Nieuwe Gebruikers Ontvangen Sats

Idee: een nieuwe gebruiker (onbekende Nostr-pubkey, nooit eerder op onze relay) krijgt automatisch een kleine hoeveelheid sats om mee te spelen.

Doel: geen drempel. Meteen ervaren hoe Lightning + Nostr aanvoelt.

**Mogelijke vormen:**
- Cashu ecash token in een NIP-04 DM bij eerste login
- RGB token als experiment met taproot assets
- Taproot Assets (Taro) voor on-chain experiments

Status: **gepland experiment** — nog niet gebouwd.

Vragen om op te lossen:
- Hoe voorkomen we misbruik (meerdere accounts aanmaken)?
- Welke bedragen zijn zinvol? (21 sats? 100 sats?)
- Conditioneel: alleen als je een actie doet (eerste badge, eerste zap)?

---

## Wanneer Pivotten We?

Transparant communiceren over richtingswijzigingen is onderdeel van het experiment.

Voorbeelden van wat we publiek delen:
- "We dachten dat X zou werken. Het werkt niet omdat Y. Nu proberen we Z."
- "Dit idee is te vroeg voor de markt — we parkeren het."
- "Beter idee gekomen — dit gaat de la in."

Elk idee dat een andere richting inslaat krijgt een korte note in de tile.json:
```json
"status": "geparkeerd",
"pivot_reden": "Te weinig tractie, idee hernoemd naar X"
```

---

## Hulp Nodig?

We helpen mensen hun eigen versie te bouwen. We bouwen live. We leggen uit wat we doen. Als je een idee hebt — kom praten. We zitten waarschijnlijk op een call.
