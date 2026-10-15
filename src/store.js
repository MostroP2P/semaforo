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
 * Keeps `report` in `map` if it beats the revision there, with `relay` as
 * the first relay that returned it. Returns the new map, or null if nothing
 * changed. Copies of the stored revision are handled by sameRevision.
 */
function keepRevision(map, report, relay) {
  if (!better(report, map.get(report.pubkey)?.report)) return null;
  return withEntry(map, report.pubkey, { report, relays: [relay] });
}

/** Whether `verify` accepts `event`; a verifier that throws does not. */
function verifies(event, verify) {
  try {
    return verify(event) === true;
  } catch {
    return false;
  }
}

/**
 * The same revision as the one stored for its key, from another relay:
 * the stored report is reused, and the relay is counted once its copy
 * verifies, so a relay that only knows the public id is never counted. A
 * relay already counted costs nothing. Returns the new map, the same map
 * when nothing changes, or null when this is not the stored revision.
 */
function sameRevision(map, event, relay, verify) {
  const current = map.get(event.pubkey);
  if (!current || current.report.id !== event.id) return null;
  if (current.relays.includes(relay) || !verifies(event, verify)) return map;
  return withEntry(map, event.pubkey, { report: current.report, relays: [...current.relays, relay] });
}

function addHealth(store, { event, relay, now, verify, trusted }) {
  for (const key of ['health', 'heartbeats']) {
    const map = sameRevision(store[key], event, relay, verify);
    if (map === store[key]) return null;
    if (map) return { ...store, [key]: map };
  }
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
  // Keys first: an event from anyone else costs no signature check.
  const known = trusted.instances.some((e) => e.pubkey === event?.pubkey)
    || trusted.watchers.some((e) => e.pubkey === event?.pubkey);
  if (!known) return { store, changed: false };
  const args = { event, relay, now, verify, trusted };
  let next = null;
  if (event?.kind === HEALTH_KIND) next = addHealth(store, args);
  else if (event?.kind === INFO_KIND) next = addInfo(store, args);
  return next ? { store: next, changed: true } : { store, changed: false };
}
