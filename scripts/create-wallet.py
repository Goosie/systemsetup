#!/usr/bin/env python3
"""
create-wallet.py — Create a single LNbits wallet for a V-formation agent.

Usage:
  python3 create-wallet.py <name> <displayName>

Prints a JSON object with wallet credentials to stdout.
Exits 0 on success, 1 if wallet already exists (no-op) or on error.

Called by humany during newgoose onboarding.
"""

import sqlite3, secrets, time, json, sys
from pathlib import Path

DB         = '/home/deploy/lnbits/data/database.sqlite3'
AGENTS_DIR = Path('/home/deploy/agents')
ADMIN_USER = '60347da1c33c450f92e69441fca53339'

if len(sys.argv) < 3:
    print('Usage: create-wallet.py <name> <displayName>', file=sys.stderr)
    sys.exit(1)

name         = sys.argv[1]
display_name = sys.argv[2]
wallet_file  = AGENTS_DIR / name / 'lnbits-wallet.json'

# Already exists — print existing and exit cleanly
if wallet_file.exists():
    print(wallet_file.read_text())
    sys.exit(0)

wallet_id = secrets.token_hex(16)
adminkey  = secrets.token_hex(32)
inkey     = secrets.token_hex(32)
ts        = time.time()

conn = sqlite3.connect(DB)
conn.execute(
    'INSERT INTO wallets (id, name, "user", adminkey, inkey, currency, deleted, wallet_type, created_at, updated_at)'
    ' VALUES (?,?,?,?,?,?,0,\'lightning\',?,?)',
    (wallet_id, display_name, ADMIN_USER, adminkey, inkey, 'sat', ts, ts)
)
conn.commit()
conn.close()

entry = {
    'name':             name,
    'displayName':      display_name,
    'wallet_id':        wallet_id,
    'adminkey':         adminkey,
    'inkey':            inkey,
    'lnurlp_id':        '',
    'lightning_address': f'{name}@goosielabs.com',
}
wallet_file.write_text(json.dumps(entry, indent=2) + '\n')
print(json.dumps(entry))
