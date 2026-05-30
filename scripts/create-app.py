#!/usr/bin/env python3
import sys
import os
import re
import glob
import shutil
import subprocess

SECRET_VITE_RE = re.compile(
    r'^(VITE_\w*(?:KEY|SECRET|TOKEN|NSEC|ADMIN|NWC|PASSWORD|PWD)\w*)\s*=',
    re.IGNORECASE,
)

def check_vite_secrets(appdir):
    hits = []
    for env_file in glob.glob(os.path.join(appdir, '**', '.env*'), recursive=True):
        if 'node_modules' in env_file:
            continue
        try:
            with open(env_file) as f:
                for lineno, line in enumerate(f, 1):
                    if line.lstrip().startswith('#'):
                        continue
                    if SECRET_VITE_RE.match(line.strip()):
                        rel = os.path.relpath(env_file, appdir)
                        varname = line.split('=')[0].strip()
                        hits.append(f"  {rel}:{lineno}  {varname}")
        except Exception:
            pass
    if hits:
        print()
        print("🚨 WAARSCHUWING: VITE_-variabelen met geheim-achtige namen gevonden!")
        print("   Deze worden zichtbaar in de browser-bundle.")
        for h in hits:
            print(h)
        print("   → Verplaats geheimen naar backend/.env (zonder VITE_-prefix).")
        print()

def get_config(appname):
    return {
        "APPNAME": appname,
        "RELAY": "wss://goosielabs.com/relay",
        "TITLE": f"Hello {appname}",
        "DESCRIPTION": f"A Nostr app by Goosielabs",
        "AUTHOR": "Goosie",
        "MINT_URL": "https://mint.goosielabs.com",
        "LNBITS_URL": "https://lnbits.goosielabs.com",
        "SITE_URL": "https://goosielabs.com",
    }


def main():
    if len(sys.argv) < 2:
        print("Gebruik: python3 create-app.py <appnaam>")
        sys.exit(1)

    appname = sys.argv[1]
    config = get_config(appname)
    template = "/home/deploy/templates/nostr-boilerplate"
    appdir = f"/var/www/goosielabs/apps/{appname}"

    print(f"🦆 Aanmaken app: {appname}")

    # Update template van GitHub (eigen aanpassingen) + merge upstream MKStack
    print("🔄 Template updaten...")
    try:
        subprocess.run(["git", "-C", template, "pull", "--quiet"], check=True)
    except subprocess.CalledProcessError:
        print("⚠️  Template update mislukt, verder met huidige versie")

    # Verwijder als bestaat
    if os.path.exists(appdir):
        shutil.rmtree(appdir)

    # Kopieer template zonder node_modules en .git
    shutil.copytree(template, appdir, ignore=shutil.ignore_patterns('node_modules', '.git', '.github'))

    # Vervang alle placeholders
    for root, dirs, files in os.walk(appdir):
        dirs[:] = [d for d in dirs if d not in ['node_modules', '.git']]
        for filename in files:
            filepath = os.path.join(root, filename)
            try:
                with open(filepath, 'r') as f:
                    content = f.read()
                for key, value in config.items():
                    content = content.replace(f'__{key}__', value)
                with open(filepath, 'w') as f:
                    f.write(content)
            except:
                pass

    # Kopieer configs
    shutil.copy("/home/deploy/CLAUDE.md", f"{appdir}/CLAUDE.md")
    shutil.copy("/home/deploy/mcp-template.json", f"{appdir}/.mcp.json")

    print(f"✅ Placeholders vervangen: {list(config.keys())}")

    check_vite_secrets(appdir)

if __name__ == "__main__":
    main()
