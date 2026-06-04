# De V-Formatie

Wie vliegt waar in de Goosielabs V-formatie.

## Actieve ganzen

| Gans   | Rol                                    | Status | Locatie |
|--------|----------------------------------------|--------|---------|
| Astrid | Persoonlijke lab-assistent             | LIVE   | `~/.claude/CLAUDE.md` |
| Jurry  | Juridisch agent                        | LIVE   | `scripts/jurry/` |
| Haitje | AI-configuratie specialist             | LIVE   | `scripts/haitje/` |
| Tessy  | QA — test alles, drukt op knoppen     | LIVE   | `/apps/*/scripts/tessa/` |
| Ruby   | Chief Reality Officer                  | LIVE   | `scripts/ruby/` |
| Devy  | DevOps — git, backup, server-onderhoud | ROL    | — |
| Finny  | Chief Financial Gans (sats)            | ROL    | — |

## Hoe werkt de V?

Perry is de voorste gans — hij verkent nieuwe technologie, landt op vreemde
plekken, en vliegt weer verder. De andere ganzen ruimen op, bewaken
specifieke domeinen, en zorgen dat hij altijd terug kan vinden waar hij was.

---

## Per gans — trigger en aanroepen

### Astrid
**Trigger:** altijd — ze is de persoonlijke assistent van Perry.
**Aanroepen:** open Claude Code in willekeurig project.
**Bron:** `~/.claude/CLAUDE.md` op de server.

### Jurry
**Trigger:** nieuwe dependency, nieuwe app, betalingsfeature, privacy-gevoelige data.
```bash
node /home/deploy/scripts/jurry/index.js licenses      # npm licenties
node /home/deploy/scripts/jurry/index.js review <app>  # juridisch review
node /home/deploy/scripts/jurry/index.js overview       # alles in één
```

### Haitje
**Trigger:** nieuwe gans toegevoegd, MCP-configuratie gewijzigd, Claude Code herstart nodig.
```bash
node /home/deploy/scripts/haitje/index.js check    # config volledigheid
node /home/deploy/scripts/haitje/index.js advies   # proactief advies
node /home/deploy/scripts/haitje/index.js overview  # alles
```

### Ruby
**Trigger:** vóór elke merge naar main — verplicht.
```bash
node /home/deploy/scripts/ruby/index.mjs review              # review huidige branch
node /home/deploy/scripts/ruby/index.mjs review --save       # + schrijft RUBY-REVIEW.md
node /home/deploy/scripts/ruby/index.mjs review --branch <x> # specifieke branch
```
Ruby checkt automatisch: secrets, .env lekken, TODO's, console.log, ontbrekende
feature flags, nieuwe packages, juridische open punten, grote richtingswijzigingen.
Exit code 1 als er blockers zijn.

### Tessy
**Trigger:** na elke feature die user-interactie raakt.
**Locatie:** `scripts/tessa/` in de betreffende app.
**Aanroepen:** per app, zie de app's eigen README.

### Devy *(rol, nog niet gebouwd)*
**Trigger:** git operaties, server-updates, backup-controle.
**Taken:** git discipline bewaken, backup verifiëren, npm updates draaien.

### Finny *(rol, nog niet gebouwd)*
**Trigger:** nieuwe Lightning/Cashu integratie, donatie-totalen bekijken.
**Taken:** sat-balansen, donatie-totalen, kostencheck per app.
