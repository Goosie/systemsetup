# Infrastructuur

## Server

- **Host:** `deploy` (SSH alias: `ssh deploy`)
- **OS:** Ubuntu 24.04
- **Webroot:** `/var/www/goosielabs/`
- **Apps:** `/var/www/goosielabs/apps/`
- **Node:** v20.20.2

## Dual World Architecture

Goosie Labs draait in twee parallelle werelden:

| Wereld | URL | Techniek |
|--------|-----|----------|
| Centraal | `goosielabs.com` | WordPress + nginx, serveert apps via `/apps/<naam>/` |
| Decentraal | `nsite.goosielabs.com` | nsite-gateway (`/home/deploy/nsite-gateway/`), bestanden gesigneerd op Nostr |

Beide werelden draaien dezelfde apps uit `/var/www/goosielabs/apps/`. Content wordt ontwikkeld op WordPress en ook naar nsite gepusht. Zie `docs/vision.md` voor de achtergrond.

## Subdomeinen

| Subdomein                    | Wat                            | Poort |
|------------------------------|--------------------------------|-------|
| goosielabs.com               | WordPress + homepage           | 80/443 |
| nsite.goosielabs.com         | Nostr-native nsite gateway     | —     |
| mint.goosielabs.com          | Cashu mint (Nutshell)          | 3338  |
| lnbits.goosielabs.com        | LNbits                         | 5000  |
| goosielabs.com/apps/ididhere/      | IDidHere app                   | —     |
| api.goosielabs.com/apps/ididhere/  | IDidHere API                   | —     |

## Nostr & Bitcoin

- **Relay:** `wss://goosielabs.com/relay` (strfry 1.1.0)
- **Cashu mint:** `mint.goosielabs.com`
- **Lightning hub:** Alby Hub op Umbrel, NWC voor app-integraties
- **Lightning address:** `zoomer@getalby.com`
- **Nostr npub:** `npub14qpe36rvq0l6m3crplsntmnkzjm04weqflq0veqc8ra5hz4lpvxqqkdffc`

## WordPress

- Admin: `goosielabs.com/wp-admin`
- DB: `wp_identity_demo`
- WP-CLI: altijd met `--allow-root --path=/var/www/goosielabs`

## Services (systemd)

- `strfry.service` — Nostr relay
- `lnbits.service` — Lightning wallets
- `nutshell.service` — Cashu mint
- `goosielabs-backup.service` + `.timer` — geplande backups
