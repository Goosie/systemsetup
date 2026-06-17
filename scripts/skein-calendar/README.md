# skein-calendar-api

Tiny Express service that writes confirmed Skein bookings to the host's Google Calendar. Holds the Google OAuth client secret + refresh token server-side; the Skein frontend only knows the shared secret used to hit this service.

## Install

```bash
cd /home/deploy/scripts/skein-calendar
npm install
cp .env.example .env
nano .env   # fill in SKEIN_SHARED_SECRET (openssl rand -hex 32) + Google fields below
```

## One-off Google OAuth setup

Done once per host. Yields a long-lived refresh token written into `.env`.

1. **Google Cloud Console** → create / pick a project.
2. **APIs & Services** → **Library** → enable **Google Calendar API**.
3. **APIs & Services** → **OAuth consent screen** → "External" (or Internal if you have a Workspace). Add the scope `https://www.googleapis.com/auth/calendar.events` (plus `freebusy` if you want this same OAuth client to also serve the read side later).
4. **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID** → **Web application**.
   - Authorised redirect URI: `https://developers.google.com/oauthplayground` (we'll use the Playground to mint the refresh token without standing up a callback URL).
   - Save Client ID + Client Secret into `.env`.
5. Open **https://developers.google.com/oauthplayground** in your browser.
   - Gear icon → "Use your own OAuth credentials" → paste Client ID + Client Secret.
   - In the left list, **paste this scope** into "Input your own scopes" field:
     ```
     https://www.googleapis.com/auth/calendar.events
     ```
     (If you want to keep using the same client for freeBusy reads too, also paste `https://www.googleapis.com/auth/calendar.readonly` separated by a space.)
   - Click **Authorize APIs** → log in as the host's Google account → grant.
   - Back at the Playground: click **Exchange authorization code for tokens**.
   - Copy the **Refresh token** into `.env` as `GOOGLE_REFRESH_TOKEN`.
6. (Optional) Pin a non-primary calendar by setting `GOOGLE_CALENDAR_ID` to the calendar's id (you can find it under that calendar's Settings → "Integrate calendar").

The refresh token doesn't expire as long as the app isn't deleted from the host's Google account permissions.

## Install as a systemd service

```bash
sudo cp /home/deploy/scripts/skein-calendar/skein-calendar-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now skein-calendar-api
sudo systemctl status skein-calendar-api
```

## Nginx route

Already configured: `/api/skein/calendar/*` on `goosielabs.com` proxies to `127.0.0.1:3035`.

## Smoke test

```bash
# Health
curl -s https://goosielabs.com/api/skein/calendar/health

# Insert a dummy event (replace the secret + iCalUID).
curl -s -X POST https://goosielabs.com/api/skein/calendar/event \
  -H "Content-Type: application/json" \
  -H "X-Skein-Secret: $(grep SKEIN_SHARED_SECRET .env | cut -d= -f2)" \
  -d '{
    "summary":"Test van Skein",
    "description":"Smoke test",
    "start":{"dateTime":"2026-06-20T10:00:00","timeZone":"Europe/Amsterdam"},
    "end":  {"dateTime":"2026-06-20T11:30:00","timeZone":"Europe/Amsterdam"},
    "iCalUID":"skein-smoketest-1@goosielabs.com"
  }'
```

A second identical POST (same iCalUID) returns the same eventId with `deduped: true` — that's how the frontend stays idempotent across re-confirms.

## Endpoints

### POST /event

Body:
```json
{
  "summary": "Fietsen met Charly",
  "location": "Westerkim, Nieuw-Vennep",
  "description": "Via Skein. Activiteit: Fietsen (Fiets Aurora). Contact gast: charly@example.com",
  "start": { "dateTime": "2026-06-18T10:00:00", "timeZone": "Europe/Amsterdam" },
  "end":   { "dateTime": "2026-06-18T11:30:00", "timeZone": "Europe/Amsterdam" },
  "iCalUID": "skein-<skeinId>@goosielabs.com",
  "attendees": [{ "email": "charly@example.com" }]
}
```

Returns: `{ eventId, htmlLink, deduped? }`.

When `ALLOW_ATTENDEES=true` in `.env` *and* `attendees` is non-empty, the insert is made with `sendUpdates=all`: Google emails the guest an invite + adds it to their calendar.

### DELETE /event/:eventId?notify=all|none

Deletes the event. Use `?notify=all` to notify any attendees of cancellation.
