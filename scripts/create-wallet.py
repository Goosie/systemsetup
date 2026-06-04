#!/usr/bin/env python3
"""
create-wallet.py — Create a single LNbits wallet for a V-formation agent.

Uses the LNbits REST API (POST /api/v1/account) — no direct DB access.

Usage:
  python3 create-wallet.py <name> <displayName>

Prints the saved lnbits-wallet.json to stdout.
Exits 0 on success or if wallet already exists (idempotent).
Exits 1 on error.
"""

import json, sys, urllib.request, urllib.error
from pathlib import Path

LNBITS_URL = 'http://127.0.0.1:5000'
AGENTS_DIR  = Path('/home/deploy/agents')

if len(sys.argv) < 3:
    print('Usage: create-wallet.py <name> <displayName>', file=sys.stderr)
    sys.exit(1)

name         = sys.argv[1]
display_name = sys.argv[2]
wallet_file  = AGENTS_DIR / name / 'lnbits-wallet.json'

# Already exists — idempotent, print and exit cleanly
if wallet_file.exists():
    print(wallet_file.read_text())
    sys.exit(0)

payload = json.dumps({'name': display_name}).encode()
req = urllib.request.Request(
    f'{LNBITS_URL}/api/v1/account',
    data=payload,
    headers={'Content-Type': 'application/json'},
    method='POST',
)

try:
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())
except urllib.error.URLError as e:
    print(f'LNbits API error: {e}', file=sys.stderr)
    sys.exit(1)

if 'inkey' not in data:
    print(f'Unexpected response: {data}', file=sys.stderr)
    sys.exit(1)

entry = {
    'name':             name,
    'displayName':      display_name,
    'wallet_id':        data['id'],
    'adminkey':         data['adminkey'],
    'inkey':            data['inkey'],
    'lnurlp_id':        '',
    'lightning_address': f'{name}@goosielabs.com',
}
wallet_file.parent.mkdir(parents=True, exist_ok=True)
wallet_file.write_text(json.dumps(entry, indent=2) + '\n')
print(json.dumps(entry))
