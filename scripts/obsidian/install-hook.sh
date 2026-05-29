#!/bin/bash
# Voegt de Claude Code Stop-hook toe die elk gesprek opslaat in de Obsidian vault.
# Schrijft naar ~/.claude/settings.json (of ~/.config/claude/settings.json).
# Gebruik: bash /home/deploy/systemsetup/scripts/obsidian/install-hook.sh

set -e

CAPTURE_SCRIPT="/home/deploy/systemsetup/scripts/obsidian/capture.py"
SETTINGS_CANDIDATES=(
    "$HOME/.claude/settings.json"
    "$HOME/.config/claude/settings.json"
)

# Zoek bestaand settings-bestand
SETTINGS=""
for candidate in "${SETTINGS_CANDIDATES[@]}"; do
    if [ -f "$candidate" ]; then
        SETTINGS="$candidate"
        break
    fi
done

# Als geen gevonden, maak aan in ~/.claude/
if [ -z "$SETTINGS" ]; then
    mkdir -p "$HOME/.claude"
    SETTINGS="$HOME/.claude/settings.json"
    echo "{}" > "$SETTINGS"
    echo "📄 Nieuw settings.json aangemaakt: $SETTINGS"
fi

echo "⚙️  Instellingen: $SETTINGS"

# Controleer of Python en het capture-script beschikbaar zijn
if ! command -v python3 &> /dev/null; then
    echo "❌ python3 niet gevonden — kan hook niet installeren"
    exit 1
fi

if [ ! -f "$CAPTURE_SCRIPT" ]; then
    echo "❌ Capture script niet gevonden: $CAPTURE_SCRIPT"
    exit 1
fi

# Voeg de hook toe via Python (zodat JSON correct blijft)
python3 << PYTHON
import json
import sys

settings_path = "$SETTINGS"
capture_script = "$CAPTURE_SCRIPT"

with open(settings_path, "r") as f:
    try:
        settings = json.load(f)
    except json.JSONDecodeError:
        settings = {}

hooks = settings.setdefault("hooks", {})
stop_hooks = hooks.setdefault("Stop", [])

# Controleer of de hook al bestaat
hook_command = f"python3 {capture_script}"
already_installed = any(
    h.get("command") == hook_command
    for entry in stop_hooks
    for h in entry.get("hooks", [])
    if isinstance(h, dict)
)

if already_installed:
    print("ℹ️  Hook was al geïnstalleerd — niks gewijzigd")
    sys.exit(0)

# Voeg toe
stop_hooks.append({
    "matcher": "",
    "hooks": [
        {
            "type": "command",
            "command": hook_command
        }
    ]
})

with open(settings_path, "w") as f:
    json.dump(settings, f, indent=2)

print(f"✅ Stop-hook toegevoegd aan {settings_path}")
print(f"   Commando: {hook_command}")
PYTHON

echo ""
echo "🔁 Herstart Claude Code om de hook actief te maken."
echo "   Vanaf nu wordt elk gesprek opgeslagen in:"
echo "   /home/deploy/ObsidianClaudeFault/gesprekken/"
echo ""
echo "💡 Tip: importeer ook bestaande sessies met:"
echo "   python3 $HOME/systemsetup/scripts/obsidian/import-history.py"
