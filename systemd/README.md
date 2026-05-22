# Systemd units

**Let op:** dit zijn **kopieën** ter referentie. De echte units leven in
`/etc/systemd/system/` — daar leest systemd ze.

## Services

| Bestand                       | Wat                                   |
|-------------------------------|---------------------------------------|
| `strfry.service`              | Nostr relay (wss://goosielabs.com/relay) |
| `lnbits.service`              | LNbits Lightning wallets (port 5000)  |
| `nutshell.service`            | Cashu mint (port 3338)                |
| `goosielabs-backup.service`   | Dagelijkse backup (oneshot)           |
| `goosielabs-backup.timer`     | Trigger voor backup-service           |

## Status checken

```bash
systemctl status strfry lnbits nutshell
systemctl list-timers goosielabs-backup.timer
```

## Wijzigen

Bewerk eerst `/etc/systemd/system/<naam>` (vereist sudo), herlaad met
`sudo systemctl daemon-reload`, herstart met `sudo systemctl restart <naam>`,
en sync deze kopieën met `~/systemsetup/scripts/sync-configs.sh`.
