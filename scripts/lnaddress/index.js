#!/usr/bin/env node
/**
 * lnaddress — Lightning Address service for Goosie Labs V-formation agents
 *
 * Implements LNURL-pay protocol so each agent has a Lightning Address:
 *   assistenty@goosielabs.com, danky@goosielabs.com, etc.
 *
 * Endpoints (proxied by nginx from goosielabs.com):
 *   GET /.well-known/lnurlp/:name        → LNURL-pay metadata
 *   GET /lnurlp/callback/:name           → invoice (called with ?amount=<msat>)
 *
 * Service runs on port 3010.
 */

'use strict';

const http    = require('http');
const https   = require('https');
const { readFileSync, readdirSync, existsSync } = require('fs');
const { join } = require('path');

const PORT        = 3020;
const SCAN_DIRS   = ['/home/deploy/agents', '/home/deploy/people'];
const LNBITS_URL  = 'http://127.0.0.1:5000';
const PUBLIC_BASE = 'https://goosielabs.com';

// Load all wallet inkeys at startup from all scan dirs
const wallets = {};
for (const dir of SCAN_DIRS) {
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    const wf = join(dir, name, 'lnbits-wallet.json');
    if (existsSync(wf)) {
      const w = JSON.parse(readFileSync(wf, 'utf8'));
      wallets[name] = { inkey: w.inkey, displayName: w.displayName };
    }
  }
}

console.log(`⚡ lnaddress: loaded ${Object.keys(wallets).length} wallets`);
console.log(`   Names: ${Object.keys(wallets).sort().join(', ')}`);

function jsonResponse(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

function lnbitsRequest(path, method, body, inkey) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: 5000,
      path,
      method,
      headers: {
        'X-Api-Key': inkey,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch { resolve({ error: buf }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // ── GET /.well-known/lnurlp/:name ─────────────────────────────────────────
  const wellKnownMatch = path.match(/^\/.well-known\/lnurlp\/([a-z0-9-]+)$/);
  if (req.method === 'GET' && wellKnownMatch) {
    const name = wellKnownMatch[1];
    const wallet = wallets[name];
    if (!wallet) return jsonResponse(res, 404, { status: 'ERROR', reason: `Unknown agent: ${name}` });

    return jsonResponse(res, 200, {
      tag:           'payRequest',
      callback:      `${PUBLIC_BASE}/lnurlp/callback/${name}`,
      minSendable:   1000,       // 1 sat in msat
      maxSendable:   100000000,  // 100 000 sat in msat
      metadata:      JSON.stringify([
        ['text/plain', `${wallet.displayName} — Goosie Labs`],
        ['text/identifier', `${name}@goosielabs.com`],
      ]),
      commentAllowed: 255,
    });
  }

  // ── GET /lnurlp/callback/:name?amount=<msat> ──────────────────────────────
  const callbackMatch = path.match(/^\/lnurlp\/callback\/([a-z0-9-]+)$/);
  if (req.method === 'GET' && callbackMatch) {
    const name   = callbackMatch[1];
    const wallet = wallets[name];
    if (!wallet) return jsonResponse(res, 404, { status: 'ERROR', reason: `Unknown agent: ${name}` });

    const amountMsat = parseInt(url.searchParams.get('amount') || '0', 10);
    if (!amountMsat || amountMsat < 1000) {
      return jsonResponse(res, 400, { status: 'ERROR', reason: 'amount must be >= 1000 msat (1 sat)' });
    }

    const comment = url.searchParams.get('comment') || '';
    const memo    = comment
      ? `${wallet.displayName}: ${comment.slice(0, 200)}`
      : `${wallet.displayName} — Goosie Labs`;

    const invoice = await lnbitsRequest(
      '/api/v1/payments',
      'POST',
      { out: false, amount: Math.floor(amountMsat / 1000), memo },
      wallet.inkey,
    );

    if (invoice.payment_request) {
      return jsonResponse(res, 200, { pr: invoice.payment_request, routes: [] });
    }

    return jsonResponse(res, 500, { status: 'ERROR', reason: invoice.detail || 'Invoice creation failed' });
  }

  // ── health check ──────────────────────────────────────────────────────────
  if (path === '/health') {
    return jsonResponse(res, 200, { status: 'ok', agents: Object.keys(wallets).length });
  }

  jsonResponse(res, 404, { status: 'ERROR', reason: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`⚡ lnaddress service listening on 127.0.0.1:${PORT}`);
});
