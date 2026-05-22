#!/bin/bash
APPNAME=$1
APPDIR="/var/www/goosielabs/apps/$APPNAME"
CLAUDE_MD="/home/deploy/.claude/CLAUDE.md"

echo "🦆 Aanmaken app: $APPNAME"

# Python template engine
python3 /home/deploy/create-app.py $APPNAME

cd $APPDIR

# Geheugen-vriendelijk bouwen (server heeft 1.9Gi RAM + 2GB swap)
export NODE_OPTIONS="--max-old-space-size=1024"

# Build de app
echo "📦 Packages installeren..."
npm install --no-audit --no-fund --prefer-offline
echo "🏗 Bouwen..."
npm run build 2>&1

# Nginx — alleen toevoegen als nog niet bestaat
if ! grep -q "location /apps/$APPNAME/" /etc/nginx/sites-enabled/goosielabs.com; then
    sudo sed -i "s|    location /apps/ {|    location /apps/$APPNAME/ {\n        alias /var/www/goosielabs/apps/$APPNAME/dist/;\n        try_files \$uri \$uri/ =404;\n    }\n\n    location /apps/ {|" /etc/nginx/sites-enabled/goosielabs.com
fi
sudo nginx -t && sudo nginx -s reload

echo ""
echo "💡 Type in Claude Code: Lees CLAUDE.md en stel je voor als Architect"
echo ""

# Git
git init
git config init.defaultBranch main
git config user.email "perry.smit@gmail.com"
git config user.name "Goosie"
gh repo create Goosie/$APPNAME --private --source=. --remote=origin

# Tile aanmaken voor landing page
if [ ! -f "$APPDIR/tile.json" ]; then
    cat > "$APPDIR/tile.json" << TILEJSON
{
  "title": "$APPNAME",
  "description": "— beschrijving nog invullen in tile.json —",
  "status": "in-bouw",
  "url": "https://goosielabs.com/apps/$APPNAME/",
  "visible": true,
  "order": 50,
  "juridischadvies": "https://github.com/Goosie/$APPNAME/blob/main/juridischadvies.md"
}
TILEJSON
    echo "📌 tile.json aangemaakt — pas de beschrijving aan in $APPDIR/tile.json"
fi

# Juridisch advies aanmaken
if [ ! -f "$APPDIR/juridischadvies.md" ]; then
    DATUM=$(date +%Y-%m-%d)
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

# Juridisch advies HTML genereren
python3 /home/deploy/scripts/generate-juridisch-html.py "$APPNAME"

# Landing page bijwerken
echo "🖼 Landing page bijwerken..."
/home/deploy/update-tiles.sh

# Astrid bijwerken — voeg nieuwe app toe aan CLAUDE.md
echo "📋 Astrid bijwerken..."
DATUM=$(date +%Y-%m-%d)

if ! grep -q "| $APPNAME " "$CLAUDE_MD"; then
    sed -i "/| Astrid /i | $APPNAME | — beschrijving nog toe te voegen — | IN BOUW | /apps/$APPNAME |" "$CLAUDE_MD"
    echo "✅ Astrid weet nu van $APPNAME (toegevoegd op $DATUM)"
else
    echo "ℹ️  Astrid kende $APPNAME al"
fi

echo ""
echo "✅ App $APPNAME live op https://goosielabs.com/apps/$APPNAME/"

