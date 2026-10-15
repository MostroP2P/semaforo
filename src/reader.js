// The reader rules of the Mostro health event (kind 38389) and the info event
// (kind 38385), as pure functions. The page and the sampler share this module,
// so it depends on neither: no DOM, no network, no clock. The caller passes
// `now` in unix seconds and `verify`, which checks the NIP-01 id and
// signature (nostr-tools' `verifyEvent`).
//
// Source of truth: `src/health_event.md` in MostroP2P/protocol, "What a
// reader owes". Ported from the status page in MostroP2P/mostro-watchdog#48.

export const HEALTH_KIND = 38389;
export const INFO_KIND = 38385;
export const MIN_INTERVAL = 30;
export const MAX_INTERVAL = 3600;
export const MAX_SEQ = Number.MAX_SAFE_INTEGER;
/** Events dated further ahead than this, in seconds, are ignored. */
export const MAX_FUTURE_SKEW = 300;
/** Longest name or version kept from the network, in characters. */
export const MAX_TEXT_LENGTH = 64;

/** The check names of this version of the protocol, in display order. */
export const CHECK_NAMES = Object.freeze(['lnd_sync', 'payouts', 'cashu_mint', 'relays', 'database']);
export const CHECK_STATES = Object.freeze(['ok', 'warn', 'fail', 'unknown']);
export const STATUSES = Object.freeze(['ok', 'degraded', 'down']);
/** The `lnd_network` values of the protocol; anything else is malformed. */
export const NETWORKS = Object.freeze(['mainnet', 'testnet', 'testnet4', 'signet', 'regtest', 'simnet']);

const INSTANCE_REQUIRED = ['d', 'y', 'z', 'status', 'escrow_mode', 'maintenance_mode', 'mostro_version', 'interval', 'seq', 'expiration'];
/** The checks the protocol says each escrow mode publishes. */
const EXPECTED_CHECKS = {
  lightning: ['lnd_sync', 'payouts', 'relays', 'database'],
  cashu: ['cashu_mint', 'relays', 'database'],
};
/** The info event tags read here; each appears at most once. */
const INFO_REQUIRED = ['d', 'z'];
const INFO_OPTIONAL = ['y', 'fee', 'mostro_version'];
// Bidirectional controls: they can reorder what a name appears to say.
const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;
// Control characters (newlines, NUL and the like) become spaces.
const CONTROL_CHARACTERS = /\p{Cc}/gu;
const INSTANCE_OPTIONAL = ['lnd_block_height', 'lnd_synced_to_chain', 'lnd_network', 'p'];
const WATCHER_REQUIRED = ['d', 'y', 'z', 'interval', 'seq', 'expiration'];
const HEX_KEY = /^[0-9a-f]{64}$/;
// Base-10, no sign, no leading zero, no fraction: the protocol's "integer".
const INTEGER = /^(0|[1-9][0-9]*)$/;
// A plain decimal such as "0.006": no exponent, no sign.
const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/**
 * A protocol integer as a number, or null. Values past 2^53 − 1 are refused:
 * JavaScript would round them, so a height or a seq could silently change.
 */
function toInteger(value) {
  if (typeof value !== 'string' || !INTEGER.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function isHexKey(value) {
  return typeof value === 'string' && HEX_KEY.test(value);
}

/** The value of the first tag called `name`, or undefined. */
function single(tags, name) {
  const tag = tags.find((t) => t[0] === name);
  return tag ? tag[1] : undefined;
}

/**
 * Text from the network without control or bidirectional characters, with
 * runs of whitespace as one space, cut to MAX_TEXT_LENGTH characters, or null
 * when nothing is left. It is still rendered as text, never as HTML.
 */
function cleanText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value
    .replace(BIDI_CONTROLS, '')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!trimmed) return null;
  const chars = [...trimmed];
  return chars.length > MAX_TEXT_LENGTH ? `${chars.slice(0, MAX_TEXT_LENGTH - 1).join('')}…` : trimmed;
}

const fail = (reason) => ({ valid: false, reason });

/**
 * Whether `verify` accepts the event. A verifier that throws, for example on
 * a signature that is not hex, rejects it: one hostile event must not break
 * the loop that reads a relay.
 */
function verifies(event, verify) {
  try {
    return verify(event) === true;
  } catch {
    return false;
  }
}

/**
 * The checks every event gets before its tags are read: the envelope, the
 * tags as lists of strings, and the signature. Returns a reason or null.
 */
function envelopeProblem(event, kind, verify) {
  if (!event || event.kind !== kind || !Array.isArray(event.tags)) return `not kind ${kind}`;
  if (!isHexKey(event.id) || !isHexKey(event.pubkey) || typeof event.content !== 'string') return 'malformed event';
  const wellFormed = event.tags.every((t) => Array.isArray(t) && t.length >= 1 && t.every((v) => typeof v === 'string'));
  if (!wellFormed) return 'malformed tags';
  if (!Number.isSafeInteger(event.created_at) || event.created_at < 0) return 'bad created_at';
  if (!verifies(event, verify)) return 'invalid signature';
  if (single(event.tags, 'd') !== event.pubkey) return 'd is not the author';
  return null;
}

/**
 * Each tag of the table at most once and never without a value; each
 * required one present. Returns a reason or null.
 */
function tableProblem(tags, required, optional) {
  for (const name of [...required, ...optional]) {
    const found = tags.filter((t) => t[0] === name);
    if (found.length > 1) return `repeated ${name}`;
    // Present but with no value is malformed, never "absent".
    if (found.length === 1 && found[0].length < 2) return `bad ${name}`;
  }
  const missing = required.find((name) => single(tags, name) === undefined);
  return missing ? `missing ${missing}` : null;
}

/** interval, seq and expiration, shared by instances and watchers. */
function parseTiming(event) {
  const interval = toInteger(single(event.tags, 'interval'));
  if (interval === null || interval < MIN_INTERVAL || interval > MAX_INTERVAL) return fail('bad interval');
  const seq = toInteger(single(event.tags, 'seq'));
  if (seq === null || seq < 1 || seq > MAX_SEQ) return fail('bad seq');
  const expiration = toInteger(single(event.tags, 'expiration'));
  if (expiration === null || expiration !== event.created_at + 3 * interval) return fail('bad expiration');
  return { valid: true, timing: { interval, seq, expiration } };
}

/**
 * The `check` tags: once per name; unknown names skipped. A check the
 * escrow mode should publish but the event leaves out reads as unknown with
 * no `since`, so a Lightning instance without `lnd_sync` is never green.
 */
function parseChecks(event, escrowMode) {
  const checks = [];
  const seen = new Set();
  const tags = event.tags.filter((t) => t[0] === 'check');
  if (tags.length === 0) return fail('no check');
  for (const tag of tags) {
    const [, name, state, since] = tag;
    const sinceN = toInteger(since);
    if (tag.length < 4 || sinceN === null || sinceN > event.created_at || seen.has(name)) return fail('bad check');
    seen.add(name);
    // A later protocol version may add names: ignore them, never reject.
    if (CHECK_NAMES.includes(name)) {
      checks.push({ name, state: CHECK_STATES.includes(state) ? state : 'unknown', since: sinceN });
    }
  }
  for (const name of EXPECTED_CHECKS[escrowMode].filter((n) => !seen.has(n))) {
    checks.push({ name, state: 'unknown', since: null });
  }
  return { valid: true, checks };
}

/** The optional LND tags: absent means null, malformed rejects the event. */
function parseLnd(tags) {
  const height = single(tags, 'lnd_block_height');
  const blockHeight = height === undefined ? null : toInteger(height);
  if (height !== undefined && blockHeight === null) return fail('bad lnd_block_height');
  const synced = single(tags, 'lnd_synced_to_chain');
  if (synced !== undefined && synced !== 'true' && synced !== 'false') return fail('bad lnd_synced_to_chain');
  const network = single(tags, 'lnd_network');
  if (network !== undefined && !NETWORKS.includes(network)) return fail('bad lnd_network');
  return {
    valid: true,
    lnd: { blockHeight, synced: synced === undefined ? null : synced === 'true', network: network ?? null },
  };
}

function parseInstance(event, base) {
  const { tags } = event;
  const y = tags.find((t) => t[0] === 'y');
  if (y[1] !== 'mostro') return fail('bad y');
  const status = single(tags, 'status');
  if (!STATUSES.includes(status)) return fail('bad status');
  const escrowMode = single(tags, 'escrow_mode');
  if (escrowMode !== 'lightning' && escrowMode !== 'cashu') return fail('bad escrow_mode');
  const maintenance = single(tags, 'maintenance_mode');
  if (maintenance !== 'true' && maintenance !== 'false') return fail('bad maintenance_mode');
  const checks = parseChecks(event, escrowMode);
  if (!checks.valid) return checks;
  const lnd = parseLnd(tags);
  if (!lnd.valid) return lnd;
  const p = single(tags, 'p');
  if (p !== undefined && !isHexKey(p)) return fail('bad p');
  if ((p !== undefined) === (event.content === '')) return fail('p and content disagree');
  return {
    valid: true,
    report: {
      shape: 'instance',
      ...base,
      name: cleanText(y[2]),
      status,
      escrowMode,
      maintenance: maintenance === 'true',
      version: cleanText(single(tags, 'mostro_version')),
      ...lnd.lnd,
      checks: checks.checks,
    },
  };
}

function parseWatcher(event, base) {
  const watching = [];
  for (const tag of event.tags.filter((t) => t[0] === 'watching')) {
    if (!isHexKey(tag[1]) || watching.includes(tag[1])) return fail('bad watching');
    watching.push(tag[1]);
  }
  return {
    valid: true,
    report: { shape: 'watcher', ...base, software: cleanText(single(event.tags, 'y')), watching },
  };
}

/**
 * Validates a kind-38389 event, an instance's health event (`z` = health) or
 * a watcher's heartbeat (`z` = watcher). Returns `{ valid: true, report }` or
 * `{ valid: false, reason }`. No field is trusted before it is checked.
 */
export function parseHealthEvent(event, now, verify) {
  const problem = envelopeProblem(event, HEALTH_KIND, verify);
  if (problem) return fail(problem);
  const z = single(event.tags, 'z');
  if (z !== 'health' && z !== 'watcher') return fail('bad z');
  const isInstance = z === 'health';
  const table = isInstance
    ? tableProblem(event.tags, INSTANCE_REQUIRED, INSTANCE_OPTIONAL)
    : tableProblem(event.tags, WATCHER_REQUIRED, []);
  if (table) return fail(table);
  if (event.created_at > now + MAX_FUTURE_SKEW) return fail('dated in the future');
  const timing = parseTiming(event);
  if (!timing.valid) return timing;
  const base = { pubkey: event.pubkey, id: event.id, createdAt: event.created_at, ...timing.timing };
  return isInstance ? parseInstance(event, base) : parseWatcher(event, base);
}

/**
 * Whether `report` can still be trusted at `now`: before its expiration, no
 * older than three intervals, and not more than MAX_FUTURE_SKEW ahead.
 */
export function isFresh(report, now) {
  if (!report) return false;
  return now < report.expiration
    && now - report.createdAt <= 3 * report.interval
    && report.createdAt <= now + MAX_FUTURE_SKEW;
}

/**
 * The one rule that orders revisions of a publisher across relays: a higher
 * seq wins, and on an equal seq the lower event id. A revision never beats
 * itself, and every reader picks the same one.
 */
export function better(a, b) {
  if (!a) return false;
  if (!b) return true;
  return a.seq > b.seq || (a.seq === b.seq && a.id < b.id);
}

const STATUS_RANK = { ok: 0, degraded: 1, down: 2 };

/** The worse of two statuses: down, then degraded, then ok. */
export function worseStatus(a, b) {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

/**
 * `status` from the checks and maintenance, as "Deriving status" in the
 * protocol orders it. The reader keeps the worse of this and the published
 * one, so a check it doesn't know can never make an instance look better.
 */
export function deriveStatus(checks, maintenance) {
  const state = (name) => checks.find((c) => c.name === name)?.state;
  const down = ['fail', 'unknown'].includes(state('lnd_sync'))
    || state('cashu_mint') === 'fail'
    || state('database') === 'fail'
    || state('relays') === 'fail';
  if (down) return 'down';
  if (maintenance || checks.some((c) => c.state !== 'ok')) return 'degraded';
  return 'ok';
}

/** A plain decimal fee between 0 and 1, or null. */
function parseFee(value) {
  if (typeof value !== 'string' || !DECIMAL.test(value)) return null;
  const fee = Number(value);
  return fee <= 1 ? fee : null;
}

/**
 * Validates an info event (kind 38385) and keeps what the page shows: the
 * name in `y`, the fee and the version. Returns `{ valid: true, info }` or
 * `{ valid: false, reason }`. A missing or malformed optional value is null.
 * The tags read here may not repeat, and an event more than MAX_FUTURE_SKEW
 * ahead is ignored: info events carry no seq, so one dated far ahead would
 * otherwise beat every later one.
 */
export function parseInfoEvent(event, now, verify) {
  const problem = envelopeProblem(event, INFO_KIND, verify);
  if (problem) return fail(problem);
  const table = tableProblem(event.tags, INFO_REQUIRED, INFO_OPTIONAL);
  if (table) return fail(table);
  if (single(event.tags, 'z') !== 'info') return fail('bad z');
  if (event.created_at > now + MAX_FUTURE_SKEW) return fail('dated in the future');
  const y = event.tags.find((t) => t[0] === 'y');
  return {
    valid: true,
    info: {
      pubkey: event.pubkey,
      id: event.id,
      createdAt: event.created_at,
      name: y && y[1] === 'mostro' ? cleanText(y[2]) : null,
      fee: parseFee(single(event.tags, 'fee')),
      version: cleanText(single(event.tags, 'mostro_version')),
    },
  };
}

/**
 * Whether info `a` replaces `b`. Info events carry no seq, so the newer
 * created_at wins, as relays keep addressable events, and on the same second
 * the lower id, so every reader agrees.
 */
export function newerInfo(a, b) {
  if (!b) return true;
  return a.createdAt > b.createdAt || (a.createdAt === b.createdAt && a.id < b.id);
}
