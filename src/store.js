// What the page knows: per trusted key, the newest valid health event,
// heartbeat and info event, and which relays returned the health event
// shown. Events go through the reader first; keys outside the trusted list
// are ignored, so a stranger can never appear on the page. Every update
// returns a new store and leaves the old one as it was.

import { HEALTH_KIND, INFO_KIND, parseHealthEvent, parseInfoEvent, better, newerInfo } from './reader.js';

/** A store with nothing in it. */
export function emptyStore() {
  return { health: new Map(), heartbeats: new Map(), info: new Map() };
}

/** `map` with `key` set to `value`, as a new Map. */
function withEntry(map, key, value) {
  return new Map(map).set(key, value);
}

/**
 * Keeps `report` in `map` if it beats the revision there, or adds `relay` to
 * the relays of the same revision. Returns the new map, or null if nothing
 * changed.
 */
function keepRevision(map, report, relay) {
  const current = map.get(report.pubkey);
  if (current && current.report.id === report.id) {
    if (current.relays.includes(relay)) return null;
    return withEntry(map, report.pubkey, { report: current.report, relays: [...current.relays, relay] });
  }
  if (!better(report, current?.report)) return null;
  return withEntry(map, report.pubkey, { report, relays: [relay] });
}

function addHealth(store, { event, relay, now, verify, trusted }) {
  const { valid, report } = parseHealthEvent(event, now, verify);
  if (!valid) return null;
  const isInstance = trusted.instances.some((entry) => entry.pubkey === report.pubkey);
  const isWatcher = trusted.watchers.some((entry) => entry.pubkey === report.pubkey);
  if (report.shape === 'instance' && isInstance) {
    const health = keepRevision(store.health, report, relay);
    return health && { ...store, health };
  }
  if (report.shape === 'watcher' && isWatcher) {
    const heartbeats = keepRevision(store.heartbeats, report, relay);
    return heartbeats && { ...store, heartbeats };
  }
  return null;
}

function addInfo(store, { event, now, verify, trusted }) {
  const { valid, info } = parseInfoEvent(event, now, verify);
  if (!valid || !trusted.instances.some((entry) => entry.pubkey === info.pubkey)) return null;
  if (!newerInfo(info, store.info.get(info.pubkey))) return null;
  return { ...store, info: withEntry(store.info, info.pubkey, info) };
}

/**
 * The store after `event` arrived from `relay` at `now`, and whether it
 * changed. `verify` checks the signature; `trusted` is the parsed trusted
 * list.
 */
export function addEvent(store, { event, relay, now, verify, trusted }) {
  const args = { event, relay, now, verify, trusted };
  let next = null;
  if (event?.kind === HEALTH_KIND) next = addHealth(store, args);
  else if (event?.kind === INFO_KIND) next = addInfo(store, args);
  return next ? { store: next, changed: true } : { store, changed: false };
}
