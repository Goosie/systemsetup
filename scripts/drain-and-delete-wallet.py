#!/usr/bin/env python3
"""
drain-and-delete-wallet.py — Drain an app LNbits wallet to Perry's wallet, then delete it.

Usage:
  python3 drain-and-delete-wallet.py <lnbits_inkey>

Flow:
  1. Look up wallet in DB via inkey → get adminkey + wallet_id
  2. Check balance
  3. If balance > 0: create invoice in Perry's wallet, pay from app wallet
  4. Mark wallet as deleted in DB
"""

import sys, sqlite3, json, urllib.request, urllib.error, time
from pathlib import Path

LNBITS_URL = 'http://127.0.0.1:5000'
LNBITS_DB  = Path('/home/deploy/lnbits/data/database.sqlite3')

if len(sys.argv) < 2:
    print('Usage: drain-and-delete-wallet.py <lnbits_inkey>', file=sys.stderr)
    sys.exit(1)

inkey = sys.argv[1].strip()

# 1. Look up wallet in DB
db = sqlite3.connect(str(LNBITS_DB))
row = db.execute(
    "SELECT id, name, adminkey FROM wallets WHERE inkey=? AND deleted=0 LIMIT 1", (inkey,)
).fetchone()

if not row:
    print(f'⚠️  Wallet not found or already deleted for inkey {inkey[:8]}…')
    sys.exit(0)

wallet_id, wallet_name, adminkey = row
print(f'💳 Wallet: {wallet_name} ({wallet_id[:8]}…)')

# 2. Check balance (msats)
def lnbits_get(path, api_key):
    req = urllib.request.Request(
        f'{LNBITS_URL}{path}',
        headers={'X-Api-Key': api_key},
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())

def lnbits_post(path, api_key, payload):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f'{LNBITS_URL}{path}',
        data=body,
        headers={'X-Api-Key': api_key, 'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

try:
    wallet_info = lnbits_get('/api/v1/wallet', inkey)
    balance_msat = wallet_info.get('balance', 0)
except Exception as e:
    print(f'⚠️  Could not check balance: {e}')
    balance_msat = 0

balance_sat = balance_msat // 1000
print(f'⚡ Balance: {balance_sat} sats ({balance_msat} msat)')

# 3. Drain to Perry's wallet if balance > 0
if balance_sat > 1:
    # Get Perry's adminkey from DB
    perry_row = db.execute(
        "SELECT adminkey FROM wallets WHERE name='Perry' AND deleted=0 LIMIT 1"
    ).fetchone()
    if not perry_row:
        print('❌ Perry wallet not found in DB — cannot drain, aborting delete')
        db.close()
        sys.exit(1)

    perry_adminkey = perry_row[0]

    try:
        # Create invoice in Perry's wallet
        invoice = lnbits_post('/api/v1/payments', perry_adminkey, {
            'out': False,
            'amount': balance_sat,
            'memo': f'Drain from deleted app wallet: {wallet_name}',
        })
        bolt11 = invoice.get('payment_request') or invoice.get('bolt11')
        if not bolt11:
            raise ValueError(f'No payment_request in response: {invoice}')

        print(f'📄 Invoice created, paying {balance_sat} sats to Perry…')

        # Pay from app wallet
        payment = lnbits_post('/api/v1/payments', adminkey, {
            'out': True,
            'bolt11': bolt11,
        })
        print(f'✅ Drained {balance_sat} sats to Perry\'s wallet')

        # Wait briefly for payment to settle
        time.sleep(2)

    except Exception as e:
        print(f'❌ Drain failed: {e}')
        db.close()
        sys.exit(1)
else:
    if balance_msat > 0:
        print(f'ℹ️  Balance too small to drain ({balance_msat} msat), skipping payment')
    else:
        print('ℹ️  Balance is 0, skipping drain')

# 4. Mark wallet as deleted in DB
now = int(time.time())
db.execute(
    "UPDATE wallets SET deleted=1, updated_at=? WHERE id=?",
    (now, wallet_id)
)
db.commit()
db.close()
print(f'🗑️  Wallet {wallet_name} deleted')
