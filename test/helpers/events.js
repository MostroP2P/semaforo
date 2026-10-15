// Builders for the events the tests feed the reader. Signatures are checked
// by nostr-tools in the browser; the reader takes `verify` as a parameter,
// so the tests pass a stub and these events carry no real signature.

export const NOW = 1792000000;
export const PK = 'a'.repeat(64);
export const OTHER = 'b'.repeat(64);
export const ID = 'e'.repeat(64);
export const SINCE = '1791900000';

/** A verifier that accepts every event. */
export const yes = () => true;

/** A verifier that rejects every event. */
export const no = () => false;

/**
 * A valid instance health event. `overrides` replaces tag values by name
 * (`null` removes the tag); `checks` replaces the check tags.
 */
export function healthEvent(overrides = {}, options = {}) {
  const { createdAt = NOW, content = '', pubkey = PK, id = ID } = options;
  const checks = options.checks ?? [
    ['lnd_sync', 'ok', SINCE],
    ['payouts', 'ok', SINCE],
    ['relays', 'ok', SINCE],
    ['database', 'ok', SINCE],
  ];
  const tags = {
    d: [pubkey],
    y: ['mostro', 'Test Mostro'],
    z: ['health'],
    status: ['ok'],
    escrow_mode: ['lightning'],
    lnd_block_height: ['971485'],
    lnd_synced_to_chain: ['true'],
    lnd_network: ['mainnet'],
    maintenance_mode: ['false'],
    mostro_version: ['0.19.3'],
    interval: ['60'],
    seq: ['7'],
    expiration: [String(createdAt + 180)],
    ...overrides,
  };
  const list = Object.entries(tags)
    .filter(([, value]) => value !== null)
    .map(([name, value]) => [name, ...value]);
  for (const check of checks) list.push(['check', ...check]);
  return { id, pubkey, kind: 38389, created_at: createdAt, tags: list, content, sig: 'f'.repeat(128) };
}

/** A valid watcher heartbeat. */
export function watcherEvent(overrides = {}, options = {}) {
  const { createdAt = NOW, pubkey = PK, id = ID, watching = [] } = options;
  const tags = {
    d: [pubkey],
    y: ['mostro-watchdog'],
    z: ['watcher'],
    interval: ['60'],
    seq: ['88213'],
    expiration: [String(createdAt + 180)],
    ...overrides,
  };
  const list = Object.entries(tags)
    .filter(([, value]) => value !== null)
    .map(([name, value]) => [name, ...value]);
  for (const key of watching) list.push(['watching', key]);
  return { id, pubkey, kind: 38389, created_at: createdAt, tags: list, content: '', sig: 'f'.repeat(128) };
}

/** A valid info event (kind 38385). */
export function infoEvent(overrides = {}, options = {}) {
  const { createdAt = NOW, pubkey = PK, id = ID } = options;
  const tags = {
    d: [pubkey],
    y: ['mostro', 'Info Mostro'],
    z: ['info'],
    mostro_version: ['0.19.3'],
    fee: ['0.006'],
    ...overrides,
  };
  const list = Object.entries(tags)
    .filter(([, value]) => value !== null)
    .map(([name, value]) => [name, ...value]);
  return { id, pubkey, kind: 38385, created_at: createdAt, tags: list, content: '', sig: 'f'.repeat(128) };
}
