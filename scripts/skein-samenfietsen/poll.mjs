#!/usr/bin/env node
// SamenFietsen poller — one-shot.
//
// Logs in to samenfietsen.nl as the configured user via a headless browser,
// captures the auth token from the login response, queries the GraphQL API
// for the next-2-weeks trips on the configured bikes, then publishes a
// kind 30078 event to wss://relay.goosielabs.com signed by Skeiny.
//
// The Skein frontend engine reads the event (author=Skeiny.pubkey,
// d="skein:bike-trips") and uses the live trips as busy-intervals instead
// of the fixture.
//
// Usage:
//   node poll.mjs               # full cycle
//   HEADED=1 node poll.mjs      # show the browser (for first-time setup)
//   DRY_RUN=1 node poll.mjs     # log everything but don't publish

import 'dotenv/config';
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import 'websocket-polyfill';
import { finalizeEvent } from 'nostr-tools/pure';
import { Relay } from 'nostr-tools/relay';

const {
  SF_LOGIN_URL = 'https://my.samenfietsen.nl/inloggen',
  SF_EMAIL,
  SF_PASSWORD,
  SF_LOCATION_ID,
  SF_BIKE_IDS,                // comma-separated
  SF_GRAPHQL = 'https://api.samenfietsen.nl/graphql',
  RELAY_URL = 'wss://relay.goosielabs.com',
  RANGE_DAYS = '21',
  SKEINY_KEY_PATH = '/home/deploy/agents/skeiny/nostr-key.json',
  HEADED,
  DRY_RUN,
} = process.env;

if (!SF_EMAIL || !SF_PASSWORD) {
  console.error('FATAL: SF_EMAIL / SF_PASSWORD not configured. Copy .env.example to .env and fill in.');
  process.exit(1);
}
if (!SF_LOCATION_ID || !SF_BIKE_IDS) {
  console.error('FATAL: SF_LOCATION_ID / SF_BIKE_IDS not configured.');
  process.exit(1);
}

const bikeIds = SF_BIKE_IDS.split(',').map(s => s.trim()).filter(Boolean);
const headless = !HEADED;
const dryRun = !!DRY_RUN;

console.log(`[poll] ${new Date().toISOString()} — start`);
console.log(`[poll] login=${SF_LOGIN_URL} headless=${headless} bikes=${bikeIds.length} dry=${dryRun}`);

// ── Headless browser login ───────────────────────────────────────────────────
// Logs in via the visible form and captures any Authorization header / cookie
// the SPA uses for subsequent API calls. The selectors below are SamenFietsen-
// specific; if the login UI changes, update SELECTORS.

const SELECTORS = {
  email:    'input[type="email"], input[name="email"], input[autocomplete="username"]',
  password: 'input[type="password"]',
  submit:   'button[type="submit"], button:has-text("Inloggen"), button:has-text("Log in")',
};

async function loginAndCaptureToken() {
  const browser = await chromium.launch({ headless });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Skein/0.1 (perry@goosielabs.com)',
  });
  let bearer = null;
  let graphqlOrigin = null;

  // Intercept ALL requests to spot a Bearer token attached to API calls.
  ctx.on('request', (req) => {
    const auth = req.headers()['authorization'];
    if (auth && auth.startsWith('Bearer ')) {
      bearer = auth.slice(7);
      const u = new URL(req.url());
      graphqlOrigin = `${u.protocol}//${u.host}`;
    }
  });

  const page = await ctx.newPage();
  console.log('[poll] navigating to login page');
  await page.goto(SF_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Fill the form. Wait for either selector to appear so we tolerate slight
  // markup variations.
  await page.waitForSelector(SELECTORS.email, { timeout: 15000 });
  await page.fill(SELECTORS.email, SF_EMAIL);
  await page.fill(SELECTORS.password, SF_PASSWORD);
  console.log('[poll] form filled, submitting');
  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: 30000 }),
    page.click(SELECTORS.submit),
  ]);

  // Give the SPA a moment to hit its first authenticated endpoint so we can
  // grab the Bearer token.
  for (let i = 0; i < 10 && !bearer; i++) {
    await page.waitForTimeout(500);
  }

  const cookies = await ctx.cookies();
  await browser.close();
  return { bearer, cookies, graphqlOrigin };
}

// ── GraphQL: trips for the next N days, for each configured bike ─────────────
const TRIPS_QUERY = `query trips($input: TripsInput!) {
  trips(input: $input) {
    id startsAt endsAt isTestTrip
    bicycle { id name }
  }
}`;

async function queryTrips({ bearer, cookies }) {
  const startsAt = new Date().toISOString();
  const endsAt = new Date(Date.now() + Number(RANGE_DAYS) * 86400_000).toISOString();

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Skein/0.1 (Goosielabs poller)',
  };
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  if (cookies?.length) {
    headers['Cookie'] = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  }

  const res = await fetch(SF_GRAPHQL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      operationName: 'trips',
      query: TRIPS_QUERY,
      variables: { input: { locationId: SF_LOCATION_ID, startsAt, endsAt } },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  const all = json.data?.trips ?? [];
  // Keep only the bikes we care about, drop test trips.
  const filtered = all
    .filter(t => bikeIds.includes(t.bicycle?.id))
    .filter(t => !t.isTestTrip)
    .map(t => ({
      bikeId: t.bicycle.id,
      bikeName: t.bicycle.name,
      start: t.startsAt,
      end: t.endsAt,
    }));
  return filtered;
}

// ── Publish kind 30078 to the relay, signed by Skeiny ────────────────────────
async function publish(trips) {
  const key = JSON.parse(readFileSync(SKEINY_KEY_PATH, 'utf8'));
  const skHex = key.nsecHex;
  if (!skHex || !/^[0-9a-f]{64}$/.test(skHex)) {
    throw new Error(`Skeiny key file ${SKEINY_KEY_PATH} missing nsecHex`);
  }
  const sk = Uint8Array.from(skHex.match(/.{2}/g).map(b => parseInt(b, 16)));
  const content = JSON.stringify({
    v: 1,
    source: 'samenfietsen',
    locationId: SF_LOCATION_ID,
    bikes: bikeIds,
    fetchedAt: new Date().toISOString(),
    trips,
  });
  const evt = finalizeEvent({
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', 'skein:bike-trips'],
      ['t', 'skein'],
      ['t', 'skein-bike-trips'],
      ['source', 'samenfietsen'],
    ],
    content,
  }, sk);

  if (dryRun) {
    console.log('[poll] DRY_RUN — would publish:');
    console.log(JSON.stringify(evt, null, 2));
    return;
  }

  const relay = await Relay.connect(RELAY_URL);
  try {
    await relay.publish(evt);
    console.log(`[poll] published kind:30078 (${evt.id.slice(0, 12)}…) with ${trips.length} trips`);
  } finally {
    relay.close();
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
try {
  const auth = await loginAndCaptureToken();
  if (!auth.bearer && !auth.cookies?.length) {
    throw new Error('No bearer or cookies captured — login likely failed (check SELECTORS or run with HEADED=1)');
  }
  console.log(`[poll] login ok — bearer=${auth.bearer ? 'yes' : 'no'} cookies=${auth.cookies.length}`);
  const trips = await queryTrips(auth);
  console.log(`[poll] fetched ${trips.length} trips for ${bikeIds.length} bikes`);
  await publish(trips);
  console.log(`[poll] done`);
} catch (err) {
  console.error(`[poll] FAILED: ${err.message}`);
  process.exit(1);
}
