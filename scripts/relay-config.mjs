/**
 * relay-config.mjs — central relay configuration for server-side scripts
 *
 * Apps (Vite/React) maintain their own relay lists in src/lib/appRelays.ts.
 * This file is for server scripts only: publish-homepage, publish-agent-pages,
 * publish-dm-relays, nostr-listener, etc.
 */

export const INTERNAL_RELAY = 'ws://127.0.0.1:7778';
export const EXTERNAL_RELAY = 'wss://relay.goosielabs.com';

/**
 * PUBLISH_RELAYS — used for one-shot publishing (manifests, kind:0, kind:10050).
 * Latency doesn't matter here; we want maximum reach.
 */
export const PUBLISH_RELAYS = [
  'wss://relay.goosielabs.com',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.nostr.band',
  'wss://purplepag.es',
  'wss://relay.snort.social',
  'wss://nostr.mom',
  'wss://nostr-pub.wellorder.net',
];

/**
 * LOOKUP_RELAYS — used for latency-sensitive queries (kind:10050 inbox lookup).
 * Fewer relays = faster DM delivery. Prefer reliable, fast relays only.
 */
export const LOOKUP_RELAYS = [
  'wss://relay.goosielabs.com',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://purplepag.es',
  'wss://relay.snort.social',
];

/**
 * PUBLIC_LISTEN_RELAYS — used for subscribing to public events (e.g. #goosielabs).
 * Must include relays where end-users post from.
 */
export const PUBLIC_LISTEN_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.nostr.band',
  'wss://relay.snort.social',
  'wss://purplepag.es',
];
