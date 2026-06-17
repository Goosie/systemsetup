// Skein → Google Calendar bridge
//
// Tiny Express service that holds the host's Google OAuth refresh token and
// translates Skein "this booking is now formed" calls into events.insert on
// the host's primary calendar. Secrets live only in this process — the
// browser never sees client_secret or refresh_token.
//
// Endpoints (mounted under /api/skein/calendar/* by nginx):
//   POST   /event              — create the event, return { eventId }
//   DELETE /event/:eventId     — delete the event
//
// Auth: shared secret in the X-Skein-Secret header. v0 single-user; swap for
// NIP-98 verification later when more hosts are added.

import 'dotenv/config';
import express from 'express';
import { google } from 'googleapis';
import { verifyEvent } from 'nostr-tools/pure';

const {
  PORT = 3035,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
  GOOGLE_CALENDAR_ID = 'primary',
  HOST_PUBKEY,
  ALLOW_ATTENDEES = 'false',
} = process.env;

if (!HOST_PUBKEY || !/^[0-9a-f]{64}$/i.test(HOST_PUBKEY)) {
  console.error('FATAL: HOST_PUBKEY (hex) not set. Refusing to start.');
  process.exit(1);
}

const HOST_PUBKEY_LC = HOST_PUBKEY.toLowerCase();

// NIP-98 verification: Authorization: Nostr <base64(kind 27235 event)>
// The event must be signed by HOST_PUBKEY, tag the request URL + method, and
// be fresh (within 60s) so a leaked token can't be reused indefinitely.
function verifyNip98(req) {
  const auth = (req.headers['authorization'] || '').trim();
  if (!auth.startsWith('Nostr ')) return null;
  try {
    const event = JSON.parse(Buffer.from(auth.slice(6), 'base64').toString('utf8'));
    if (event.kind !== 27235) return null;
    if ((event.pubkey || '').toLowerCase() !== HOST_PUBKEY_LC) return null;
    if (!verifyEvent(event)) return null;
    const methodTag = event.tags.find(t => t[0] === 'method');
    if (!methodTag || methodTag[1].toUpperCase() !== req.method.toUpperCase()) return null;
    if (Math.abs(Math.floor(Date.now() / 1000) - event.created_at) > 60) return null;
    return event.pubkey;
  } catch {
    return null;
  }
}

function calendarClient() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error('Google OAuth credentials not configured on the server.');
  }
  const oauth2 = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return google.calendar({ version: 'v3', auth: oauth2 });
}

const app = express();
app.use(express.json({ limit: '32kb' }));

// CORS for the in-browser Skein client.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://goosielabs.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function authed(req) {
  return verifyNip98(req) === HOST_PUBKEY_LC || verifyNip98(req) === HOST_PUBKEY;
}

app.get('/health', (_, res) => res.json({ ok: true, time: Date.now() }));

// POST /event
// Body: { summary, location?, description?, start, end, iCalUID, attendees?: [{email}] }
// start/end: { dateTime: "YYYY-MM-DDTHH:MM:SS", timeZone: "Europe/Amsterdam" }
// iCalUID: stable identifier — re-posts with the same iCalUID return the existing event.
app.post('/event', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauthorized' });

  const {
    summary,
    location,
    description,
    start,
    end,
    iCalUID,
    attendees,
  } = req.body ?? {};

  if (!summary || !start?.dateTime || !end?.dateTime || !iCalUID) {
    return res.status(400).json({ error: 'missing required fields: summary, start.dateTime, end.dateTime, iCalUID' });
  }

  try {
    const cal = calendarClient();

    // Idempotency: if an event with this iCalUID already exists, return it.
    const existing = await cal.events.list({
      calendarId: GOOGLE_CALENDAR_ID,
      iCalUID,
      showDeleted: false,
    });
    if (existing.data.items?.length) {
      const ev = existing.data.items[0];
      return res.json({ eventId: ev.id, htmlLink: ev.htmlLink, deduped: true });
    }

    const attendeesAllowed = String(ALLOW_ATTENDEES).toLowerCase() === 'true';
    const attendeesField = attendeesAllowed && Array.isArray(attendees) && attendees.length
      ? attendees.filter(a => a?.email)
      : undefined;

    const inserted = await cal.events.insert({
      calendarId: GOOGLE_CALENDAR_ID,
      sendUpdates: attendeesField ? 'all' : 'none',
      requestBody: {
        summary,
        location,
        description,
        start,
        end,
        status: 'confirmed',
        iCalUID,
        attendees: attendeesField,
      },
    });

    res.json({
      eventId: inserted.data.id,
      htmlLink: inserted.data.htmlLink,
    });
  } catch (err) {
    console.error('events.insert failed', err);
    res.status(500).json({ error: err.message ?? String(err) });
  }
});

// DELETE /event/:eventId?notify=all|none
app.delete('/event/:eventId', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'unauthorized' });

  const { eventId } = req.params;
  const notify = req.query.notify === 'all' ? 'all' : 'none';

  try {
    const cal = calendarClient();
    await cal.events.delete({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId,
      sendUpdates: notify,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('events.delete failed', err);
    const status = err?.code === 404 || err?.code === 410 ? 404 : 500;
    res.status(status).json({ error: err.message ?? String(err) });
  }
});

app.listen(PORT, () => {
  const credsOk = GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN;
  console.log(`skein-calendar-api listening on :${PORT}${credsOk ? '' : ' (Google creds missing — endpoints will 500 until configured)'}`);
});
