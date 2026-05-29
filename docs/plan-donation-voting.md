# Plan: Nostr Voting via DonationButton

Roadmap voor het koppelen van donaties aan on-chain Nostr-stemmen en het tonen
van vote-totalen op de homepage-tiles.

---

## Overzicht

```
Gebruiker klikt "⚡ Motiveer ons"
  → betaalt via Lightning (LNURL-pay / webln)
  → DonationButton publiceert Nostr-event (stem)
  → relay slaat event op
  → homepage leest events → toont sats per app
  → tiles gesorteerd op ontvangen sats = community-ranking
```

---

## Fase 1 — Nostr vote event publiceren (in DonationButton)

Na bevestigde betaling publiceert `DonationButton.tsx` een Nostr-event.

**Gekozen kind:** `1` (text note) met speciale tags.
Reden: universeel ondersteund, leesbaar in elke Nostr-client, eenvoudig te filteren.
Later migreren naar kind `30078` (parameterized replaceable) als we per-app aggregatie
on-relay willen.

### Event structuur

```json
{
  "kind": 1,
  "content": "Ik steun dit idee: ZapHunt ⚡",
  "tags": [
    ["t", "glvote"],
    ["app", "zaphunt"],
    ["amount", "21"],
    ["relay", "wss://goosielabs.com/relay"]
  ]
}
```

### Code toevoeging in DonationButton.tsx

```typescript
import { useNostr } from 'nostr-tools/react'  // of directe pool

async function publishVote(appName: string, sats: number) {
  if (!window.nostr) return          // NIP-07 niet aanwezig → silently skip
  try {
    const event = {
      kind: 1,
      content: `Ik steun dit idee: ${appName} ⚡`,
      tags: [
        ['t', 'glvote'],
        ['app', appName],
        ['amount', String(sats)],
      ],
      created_at: Math.floor(Date.now() / 1000),
    }
    const signed = await window.nostr.signEvent(event)
    const pool = new SimplePool()
    await pool.publish(['wss://goosielabs.com/relay'], signed)
    pool.close(['wss://goosielabs.com/relay'])
  } catch {
    // Stemmen is optioneel — betaling is al geslaagd
  }
}
```

Aanroepen in `DonationButton.tsx` na `setState('paid')`:
```typescript
publishVote(appName, selectedAmount)
```

---

## Fase 2 — Vote-totalen cachen op de server

Een cron-job of systemd-timer vraagt de relay voor alle `#t:glvote` events,
telt sats per app op, en schrijft `/var/www/goosielabs/vote-totals.json`.

### Script: `/home/deploy/scripts/tally-votes.mjs`

```javascript
import { SimplePool } from 'nostr-tools'
import { writeFileSync } from 'fs'

const pool = new SimplePool()
const relay = 'wss://goosielabs.com/relay'

const events = await pool.querySync([relay], {
  kinds: [1],
  '#t': ['glvote'],
})

const totals = {}
for (const event of events) {
  const app = event.tags.find(t => t[0] === 'app')?.[1]
  const amount = parseInt(event.tags.find(t => t[0] === 'amount')?.[1] || '0')
  if (app && amount > 0) {
    totals[app] = (totals[app] || 0) + amount
  }
}

writeFileSync('/var/www/goosielabs/vote-totals.json', JSON.stringify(totals, null, 2))
pool.close([relay])
console.log('vote-totals.json bijgewerkt:', totals)
```

### Systemd timer (elke 10 minuten)

Maak `/etc/systemd/system/vote-tally.service` + `vote-tally.timer`.
Sjabloon staat in `systemd/` in deze repo (nog toe te voegen).

---

## Fase 3 — Tonen op homepage-tiles

De homepage-tiles lezen `vote-totals.json` en tonen het totaal per app.

### WordPress widget (js snippet in theme/plugin)

```javascript
fetch('/vote-totals.json')
  .then(r => r.json())
  .then(totals => {
    document.querySelectorAll('[data-app]').forEach(tile => {
      const app = tile.dataset.app
      const sats = totals[app]
      if (sats) {
        const badge = tile.querySelector('.vote-badge')
        if (badge) badge.textContent = `⚡ ${sats.toLocaleString()} sats`
      }
    })
  })
```

Elke tile-HTML heeft een `data-app="appname"` attribuut en een `.vote-badge` element.

### Sortering op sats

De homepage kan tiles sorteren op vote-totaal → populairste ideeën bovenaan.
Optioneel: toggle "sorteer op datum" vs "sorteer op community-stem".

---

## Fase 4 — Nieuwe gebruikers ontvangen sats (token airdrop)

### Watchdog service: `/home/deploy/scripts/airdrop-watchdog.mjs`

Idee:
1. Subscribet op relay voor alle nieuwe events (filter: since = startup)
2. Houdt bij welke pubkeys al een airdrop ontvangen hebben (SQLite: `airdrop.db`)
3. Nieuwe pubkey gedetecteerd → stuur Cashu token via NIP-04 DM

```
Nieuwe pubkey gezien
  → check airdrop.db: al gehad?
  → nee: fetch Cashu token van mint.goosielabs.com (21 sats)
  → NIP-04 DM sturen met token + welkomstbericht
  → opslaan in airdrop.db als "gedaan"
```

**Open vragen:**
- Hoe misbruik beperken? (meerdere keypairs aanmaken)
  - Optie: alleen airdrop bij eerste interactie met een van onze apps
  - Optie: proof-of-work op de Nostr-key (NIP-13)
- Welk bedrag? 21 sats symbolisch maar functioneel.
- Vervaldatum op Cashu tokens? (mint kan tokens laten verlopen)

### Later: RGB of Taproot Assets

Zelfde flow maar met RGB tokens (GOOSE.contract.rgb) of Taproot Assets.
Dit is een experiment — nog geen rijpe tooling voor end-user UX.
Eerst Cashu testen, dan eventueel uitbreiden.

---

## Implementatievolgorde

| # | Wat | Waar | Status |
|---|-----|------|--------|
| 1 | `publishVote()` in DonationButton | `templates/DonationButton.tsx` | TODO |
| 2 | `tally-votes.mjs` script | `scripts/tally-votes.mjs` | TODO |
| 3 | systemd timer voor tally | `systemd/vote-tally.*` | TODO |
| 4 | Homepage tile badge | WordPress theme / update-tiles.sh | TODO |
| 5 | Tile sortering op sats | WordPress / homepage JS | TODO |
| 6 | Airdrop watchdog | `scripts/airdrop-watchdog.mjs` | GEPLAND |
| 7 | RGB/Taproot airdrop | — | IDEE |

---

## Gerelateerd

- `templates/DonationButton.tsx` — het component zelf
- `docs/vision.md` — de filosofie achter doneren = stemmen
- `docs/infra.md` — relay, mint, LNbits
- Obsidian: `[[visie/donatie-model]]`, `[[visie/token-onboarding]]`
