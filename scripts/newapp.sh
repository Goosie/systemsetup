#!/bin/bash
set -e

APPNAME=$1
APPDIR="/var/www/goosielabs/apps/$APPNAME"
CLAUDE_MD="/home/deploy/.claude/CLAUDE.md"
DATUM=$(date +%Y-%m-%d)

[[ -z "$APPNAME" ]] && { echo "Gebruik: newapp <naam>"; exit 1; }
[[ "$APPNAME" =~ [^a-z0-9-] ]] && { echo "❌ Naam mag alleen a-z, 0-9 en - bevatten"; exit 1; }

echo "🦆 Aanmaken app: $APPNAME"

python3 /home/deploy/create-app.py "$APPNAME"

cd "$APPDIR" || { echo "❌ $APPDIR bestaat niet — create-app.py mislukt"; exit 1; }

git init
git config init.defaultBranch main
gh repo create "Goosie/$APPNAME" --private --source=. --remote=origin &
GH_PID=$!

# Node memory beperken — server heeft 1.9Gi RAM + 2GB swap
export NODE_OPTIONS="--max-old-space-size=1024"

echo "📦 Packages installeren..."
npm install --no-audit --no-fund --prefer-offline
echo "🏗 Bouwen..."
npm run build 2>&1

wait $GH_PID

if ! grep -q "location /apps/$APPNAME/" /etc/nginx/sites-enabled/goosielabs.com; then
    sudo sed -i "s|    location /apps/ {|    location /apps/$APPNAME/ {\n        alias /var/www/goosielabs/apps/$APPNAME/dist/;\n        try_files \$uri \$uri/ /apps/$APPNAME/index.html;\n    }\n\n    location /apps/ {|" /etc/nginx/sites-enabled/goosielabs.com
    sudo nginx -t && sudo nginx -s reload
fi

echo ""
echo "💡 Type in Claude Code: Lees CLAUDE.md en stel je voor als Architect"
echo ""

DEFAULT_COLOR="#6366f1"

if [ ! -f "$APPDIR/tile.json" ]; then
    cat > "$APPDIR/tile.json" << TILEJSON
{
  "title": "$APPNAME",
  "description": "— beschrijving nog invullen in tile.json —",
  "status": "in-bouw",
  "url": "https://goosielabs.com/apps/$APPNAME/",
  "visible": true,
  "order": 50,
  "github": "https://github.com/Goosie/$APPNAME",
  "juridischadvies": "https://github.com/Goosie/$APPNAME/blob/main/juridischadvies.md",
  "icon": "/apps/$APPNAME/icons/icon-192.png",
  "icon_bg": "$DEFAULT_COLOR",
  "donation": {
    "lightning": "zoomer@getalby.com",
    "comment": "donation-$APPNAME"
  }
}
TILEJSON
    echo "📌 tile.json aangemaakt — pas title, description en icon_bg aan"
fi

echo "🎨 App icon genereren..."
mkdir -p "$APPDIR/public/icons" "$APPDIR/dist/icons"
node /var/www/goosielabs/generate-icons.mjs "$APPNAME" "$DEFAULT_COLOR" 2>&1
cp "$APPDIR/public/icons/icon-192.png" "$APPDIR/dist/icons/" 2>/dev/null || true
cp "$APPDIR/public/icons/icon-512.png" "$APPDIR/dist/icons/" 2>/dev/null || true
echo "🎨 Icon klaar — pas icon_bg aan in tile.json en hergeneer met:"
echo "   node /var/www/goosielabs/generate-icons.mjs $APPNAME <#kleur> [emoji-glyph]"

if [ ! -f "$APPDIR/juridischadvies.md" ]; then
    cat > "$APPDIR/juridischadvies.md" << JURIDISCH
# Juridisch Advies — $APPNAME
> Opgesteld door Jurry, juridisch agent Goosie Labs
> Laatste update: $DATUM
> Risicoclassificatie: ⚪ ONBEKEND — vul in na \`jurry review $APPNAME\`

---

## Privacy (AVG/GDPR)

- [ ] Sla je persoonsgegevens op? (naam, e-mail, locatie, IP-adres)
- [ ] Is er een privacy policy aanwezig of gepland?
- [ ] Voldoe je aan AVG/GDPR? (recht op verwijdering, dataminimalisatie)
- [ ] Worden gegevens gedeeld met derden?

## Nostr-specifiek

- [ ] Nostr-events zijn publiek en onomkeerbaar — is de gebruiker hiervan op de hoogte?
- [ ] NIP-07 login: privésleutel blijft bij de gebruiker — dit is correct
- [ ] NIP-62 (request to vanish) overwegen als gebruikers content willen verwijderen
- [ ] Geen nsec opslaan in localStorage of database

## Content / aansprakelijkheid

- [ ] Gebruikers kunnen content posten — heb je een moderatiebeleid?
- [ ] Ben je aansprakelijk voor user-generated content? (DSA/eCommerce richtlijn)
- [ ] NIP-56 rapportage overwegen

## Actiepunten vóór launch

- [ ] Risicoclassificatie bepalen: \`node /home/deploy/scripts/jurry/index.js review $APPNAME\`
- [ ] Privacy policy opstellen
- [ ] App toevoegen aan Jurry's profiel in \`scripts/jurry/skills/review.js\` en \`overview.js\`

JURIDISCH
    echo "⚖️  juridischadvies.md aangemaakt — run 'jurry review $APPNAME' voor een volledige analyse"
fi

TEMPLATES="/home/deploy/systemsetup/templates"

echo "🚩 Feature flags kopiëren..."
mkdir -p "$APPDIR/src/config" "$APPDIR/src/hooks" "$APPDIR/src/components" "$APPDIR/scripts"
for tmpl in features.ts useFeatureFlag.ts toggle-feature.mjs; do
    src="$TEMPLATES/$tmpl"
    if [ ! -f "$src" ]; then
        echo "⚠️  Template niet gevonden: $src"
        continue
    fi
    case "$tmpl" in
        features.ts)        dest="$APPDIR/src/config/features.ts" ;;
        useFeatureFlag.ts)  dest="$APPDIR/src/hooks/useFeatureFlag.ts" ;;
        toggle-feature.mjs) dest="$APPDIR/scripts/toggle-feature.mjs" ;;
    esac
    cp "$src" "$dest"
done
chmod +x "$APPDIR/scripts/toggle-feature.mjs"
echo "✅ Feature flags klaar — kill switch: node scripts/toggle-feature.mjs <feature> false"

echo "⚡ DonationButton kopiëren..."
if [ -f "$TEMPLATES/DonationButton.tsx" ]; then
    cp "$TEMPLATES/DonationButton.tsx" "$APPDIR/src/components/DonationButton.tsx"
    echo "✅ DonationButton.tsx klaar — gebruik: <DonationButton appName=\"$APPNAME\" />"
else
    echo "⚠️  DonationButton template niet gevonden"
fi

echo "🖼 Landing page bijwerken..."
/home/deploy/update-tiles.sh

if ! grep -q "| $APPNAME " "$CLAUDE_MD"; then
    # Patroon matcht alleen de projectentabel-rij (naam-cel exact "Astrid"),
    # niet "Astrid bijwerken" in de newapp-stappentabel — anders dubbele/foute insert.
    sed -i "/| Astrid *|/i | $APPNAME | — beschrijving nog toe te voegen — | IN BOUW | /apps/$APPNAME |" "$CLAUDE_MD"
    echo "✅ Astrid weet nu van $APPNAME (toegevoegd op $DATUM)"
else
    echo "ℹ️  Astrid kende $APPNAME al"
fi

echo "🔄 Claude config syncen..."
/home/deploy/sync-claude-config.sh quiet


echo ""
echo "✅ App $APPNAME live op https://goosielabs.com/apps/$APPNAME/"
