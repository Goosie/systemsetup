#!/bin/bash
# Reads tile.json from each app and republishes the nsite homepage.
# Usage: ./update-tiles.sh
# Called automatically by newapp.sh

set -e

# Convert juridischadvies.md → juridischadvies.html per app (still useful)
python3 /home/deploy/scripts/generate-juridisch-html.py

# Sync icons to root-level icons/ dir so nsite nginx rule can serve them
for d in /var/www/goosielabs/apps/*/; do
  [ -f "$d/.archived" ] && continue
  [ ! -f "${d}tile.json" ] && continue
  if [ -d "${d}dist/icons" ]; then
    mkdir -p "${d}icons"
    cp "${d}dist/icons/"*.png "${d}icons/" 2>/dev/null || true
  elif [ -d "${d}frontend/dist/icons" ]; then
    mkdir -p "${d}icons"
    cp "${d}frontend/dist/icons/"*.png "${d}icons/" 2>/dev/null || true
    mkdir -p "${d}frontend/dist/icons"
    cp "${d}icons/"*.png "${d}frontend/dist/icons/" 2>/dev/null || true
  fi
done

# Republish nsite homepage (reads all tile.json files automatically)
source ~/.bashrc.local
export PERRY_NSEC
node /home/deploy/scripts/publish-homepage.mjs

if [ $? -eq 0 ]; then
  echo "✅ Homepage updated — tiles refreshed from tile.json files."
else
  echo "❌ Homepage publish failed."
  exit 1
fi
