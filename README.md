# Goosielabs Systemsetup

Hoe de Goosielabs server in elkaar zit — voor mezelf om scherp te houden,
voor anderen om te begrijpen wat hier gebeurt.

## Wat staat hier?

Centrale plek voor alles wat de server *vormt* — geen apps, maar de
configuratie, scripts en agents eromheen.

| Map           | Wat                                                      |
|---------------|----------------------------------------------------------|
| `claude/`     | Astrid — persoonlijke Claude assistent (CLAUDE.md, settings) |
| `scripts/`    | haitje, jurry, backup, newapp — server-tooling           |
| `nginx/`      | Kopieën van `/etc/nginx/sites-enabled/*` als referentie  |
| `systemd/`    | Service files voor strfry, lnbits, nutshell, backups     |
| `templates/`  | nostr-boilerplate, mcp-template.json                     |
| `docs/`       | Uitleg per onderdeel                                     |

## Server in één blik

- **Host:** `deploy@goosielabs.com` (Ubuntu 24.04)
- **Webroot:** `/var/www/goosielabs/`
- **Apps:** `/var/www/goosielabs/apps/`
- **Node:** v20.20.2

Subdomeinen: zie [`docs/infra.md`](docs/infra.md).

**`goosie` helpcommando:** typ `goosie` in de terminal voor een overzicht van alle beschikbare commando's (newapp, openapp, gans, tmux-sneltoetsen, exit2, etc.). Bronbestand: `~/.bashrc.d/goosie.sh`

## De V-formatie

Goosie Labs werkt met AI-ganzen, ieder met een eigen rol. Zie [`docs/ganzen.md`](docs/ganzen.md).

## Centrale TODO

Alle openstaande taken staan in `~/todo.md`. Zeg `@Astrid zet op #todo <taak>` om iets toe te voegen.
Filter per app: `grep "#app:naam" ~/todo.md`
App CLAUDE.md bestanden bevatten geen eigen TODO-lijsten meer — die verwijzen naar `~/todo.md`.

## Apps

Overzicht van wat er draait, in bouw is, of experiment is: zie [`docs/apps.md`](docs/apps.md).

## Hoe is dit opgebouwd?

TODO — Perry schrijft hier zelf het verhaal van hoe Goosielabs is ontstaan
en hoe de stukken samenhangen.
