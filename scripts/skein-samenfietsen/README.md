# skein-samenfietsen poller

Reads SamenFietsen's live trip data 3× per day and publishes it as a kind 30078 event signed by Skeiny. Skein's frontend engine picks it up (author=Skeiny.pubkey, d=`skein:bike-trips`) and uses the real bookings as busy intervals instead of the fixture.

No SamenFietsen API token. Logs in via the visible form (headless Chromium) with Perry's own SamenFietsen credentials, captures any bearer token the SPA attaches to its API calls, then queries the GraphQL `trips()` endpoint. Look-and-feel matches what a logged-in user does.

## Setup

```bash
cd /home/deploy/scripts/skein-samenfietsen
cp .env.example .env
chmod 600 .env
nano .env   # fill SF_EMAIL / SF_PASSWORD, adjust SF_BIKE_IDS to your fleet
```

`.env` defaults:
- `SF_LOGIN_URL=https://my.samenfietsen.nl/inloggen` (adjust if the URL is different)
- `SF_LOCATION_ID=14a88b98-…` (Demo Vennep from the earlier brief)
- `SF_BIKE_IDS=cff61909-…` (Fiets 6)
- `RANGE_DAYS=21`
- `RUNS_PER_DAY=3` random times within `08:00–22:00` Europe/Amsterdam

## One-shot test

The first time, run with `HEADED=1` and Chromium opens visibly so you can spot UI changes / 2FA prompts:

```bash
HEADED=1 DRY_RUN=1 node poll.mjs
```

`DRY_RUN=1` skips the publish so you can verify the trips payload first. Success looks like:

```
[poll] login ok — bearer=yes cookies=N
[poll] fetched X trips for Y bikes
[poll] DRY_RUN — would publish: {...}
```

If the login fails: open the visible browser, inspect the selectors that actually exist on the SamenFietsen login form, then update `SELECTORS` in `poll.mjs`.

## Once you're happy: run as a daemon

```bash
sudo cp /home/deploy/scripts/skein-samenfietsen/skein-samenfietsen-poller.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now skein-samenfietsen-poller
journalctl -u skein-samenfietsen-poller -f
```

`schedule.mjs` picks 3 random times each day inside the configured window (default 08:00–22:00), at least 2 hours apart, and replans at midnight.

## Verify on the relay

After a successful poll:

```bash
nak req -k 30078 -a bb3d07213d95cb793ff00505147edbd65017d69516c91d9beaf1e3ced7b33337 -d skein:bike-trips wss://relay.goosielabs.com | jq '.content | fromjson'
```

You should see a JSON body with `source: "samenfietsen"`, `fetchedAt`, and `trips: [...]`.

## How Skein consumes it

`src/lib/skeiner.ts` queries the relay for Skeiny's bike-trips event on each `/book/bike` load and uses it as the bike's busy-source if present, falling back to the embedded fixture otherwise. No browser-side SamenFietsen calls, no token in the bundle.
