# Infrastructuur

## Server

- **Host:** `deploy@goosielabs.com` (SSH alias: `deploy`)
- **OS:** Ubuntu 24.04
- **Webroot:** `/var/www/goosielabs/`
- **Apps:** `/var/www/goosielabs/apps/`
- **Node:** v20.20.2

## Subdomeinen

| Subdomein                    | Wat                            | Poort |
|------------------------------|--------------------------------|-------|
| goosielabs.com               | WordPress + homepage           | 80/443 |
| mint.goosielabs.com          | Cashu mint (Nutshell)          | 3338  |
| lnbits.goosielabs.com        | LNbits                         | 5000  |
| ididhere.goosielabs.com      | IDidHere app                   | —     |
| api.ididhere.goosielabs.com  | IDidHere API                   | —     |

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
