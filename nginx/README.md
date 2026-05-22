# Nginx configs

**Let op:** dit zijn **kopieën** ter referentie. De echte configs leven in
`/etc/nginx/sites-available/` en worden geactiveerd via
`/etc/nginx/sites-enabled/`.

## Actieve sites

| Bestand                       | Wat                          |
|-------------------------------|------------------------------|
| `goosielabs.com`              | Hoofddomein + relay + WordPress |
| `api.ididhere.goosielabs.com` | IDidHere API                 |
| `ididhere.goosielabs.com`     | IDidHere frontend            |
| `lnbits.goosielabs.com`       | LNbits                       |
| `mint.goosielabs.com`         | Cashu mint (Nutshell)        |

## Verversen

Na een wijziging in `/etc/nginx/`:

```bash
~/systemsetup/scripts/sync-configs.sh
cd ~/systemsetup && git diff nginx/
```

## Wijzigen

Bewerk eerst `/etc/nginx/sites-available/<naam>` (vereist sudo), test met
`sudo nginx -t`, herlaad met `sudo systemctl reload nginx`, en sync daarna
deze kopieën met `sync-configs.sh`.
