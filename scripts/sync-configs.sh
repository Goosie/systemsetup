#!/bin/bash
# Sync de read-only kopieën van /etc/-configs naar ~/systemsetup/
# Draai dit na een wijziging in nginx of systemd, dan toont 'git diff'
# wat er is veranderd en kun je het committen.

set -e
ROOT="$(dirname "$(realpath "$0")")/.."

# Nginx (alleen actieve sites in sites-enabled, geen .bak en geen default)
for site in goosielabs.com api.ididhere.goosielabs.com ididhere.goosielabs.com lnbits.goosielabs.com mint.goosielabs.com; do
  src="/etc/nginx/sites-enabled/$site"
  if [ -e "$src" ]; then
    cp -L "$src" "$ROOT/nginx/sites-enabled/$site"
  fi
done

# Systemd
for unit in strfry.service lnbits.service nutshell.service goosielabs-backup.service goosielabs-backup.timer; do
  src="/etc/systemd/system/$unit"
  if [ -e "$src" ]; then
    cp "$src" "$ROOT/systemd/$unit"
  fi
done

echo "Sync klaar. Check verschillen:"
echo "  cd $ROOT && git diff nginx/ systemd/"
