import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explorerReference, peerMedian, peerHeights, crossCheck } from '../src/crosscheck.js';
import { parseHealthEvent } from '../src/reader.js';
import { NOW, PK, OTHER, yes, healthEvent } from './helpers/events.js';

const MEMPOOL = 'https://mempool.space/api/blocks/tip/height';
const BLOCKSTREAM = 'https://blockstream.info/api/blocks/tip/height';
const MAX_AGE = 1800;
const EXPLORERS = new Map([['mainnet', [MEMPOOL, BLOCKSTREAM]], ['signet', []]]);

const report = (overrides = {}, options = {}) => parseHealthEvent(healthEvent(overrides, options), NOW, yes).report;
const entry = (overrides = {}) => ({ pubkey: PK, name: 'Mostro', network: 'mainnet', monitored: true, relays: [], ...overrides });
const key = (n) => String(n).repeat(64);

function check(overrides = {}) {
  return crossCheck({
    report: report(),
    entry: entry(),
    explorers: EXPLORERS,
    tips: new Map([[MEMPOOL, { height: 971486, at: NOW }]]),
    peers: [],
    now: NOW,
    tipMaxAgeSeconds: MAX_AGE,
    ...overrides,
  });
}

test('the reference is the highest fresh explorer tip, so a lagging explorer hides nothing', () => {
  // Arrange
  const tips = new Map([[MEMPOOL, { height: 971480, at: NOW }], [BLOCKSTREAM, { height: 971490, at: NOW - 60 }]]);

  // Act
  const reference = explorerReference([MEMPOOL, BLOCKSTREAM], tips, NOW, MAX_AGE);

  // Assert
  assert.deepEqual(reference, { height: 971490, source: BLOCKSTREAM });
});

test('a tip older than the maximum age is not a reference', () => {
  const tips = new Map([[MEMPOOL, { height: 971480, at: NOW - MAX_AGE - 1 }], [BLOCKSTREAM, { height: 971470, at: NOW - MAX_AGE }]]);

  assert.deepEqual(explorerReference([MEMPOOL, BLOCKSTREAM], tips, NOW, MAX_AGE), { height: 971470, source: BLOCKSTREAM });
  assert.equal(explorerReference([MEMPOOL], tips, NOW, MAX_AGE), null);
  assert.equal(explorerReference([MEMPOOL, BLOCKSTREAM], new Map(), NOW, MAX_AGE), null);
});

test('equal tips name the first explorer of the list', () => {
  const tips = new Map([[MEMPOOL, { height: 5, at: NOW }], [BLOCKSTREAM, { height: 5, at: NOW }]]);

  assert.equal(explorerReference([BLOCKSTREAM, MEMPOOL], tips, NOW, MAX_AGE).source, BLOCKSTREAM);
});

test('the peer median needs at least three heights', () => {
  assert.equal(peerMedian([]), null);
  assert.equal(peerMedian([10, 11]), null);
  assert.equal(peerMedian([12, 10, 11]), 11);
  assert.equal(peerMedian([10, 11, 13, 14]), 12);
  assert.equal(peerMedian([10, 11, 12, 14]), 11);
});

test('peers are the other fresh, monitored Lightning instances on the same network', () => {
  // Arrange
  const row = (pubkey, entryOverrides = {}, reportOverrides = {}, reportOptions = {}) => ({
    entry: entry({ pubkey, ...entryOverrides }),
    report: report(reportOverrides, { pubkey, ...reportOptions }),
  });
  const rows = [
    row(PK),
    row(key(1), {}, { lnd_block_height: ['100'] }),
    row(key(2), { monitored: false }, { lnd_block_height: ['200'] }),
    row(key(3), { network: 'signet' }, { lnd_network: ['signet'], lnd_block_height: ['300'] }),
    row(key(4), {}, { lnd_network: ['signet'], lnd_block_height: ['400'] }),
    row(key(5), {}, { lnd_block_height: null }),
    row(key(6), {}, { lnd_block_height: ['600'] }, { createdAt: NOW - 181 }),
    row(key(7), {}, { escrow_mode: ['cashu'], lnd_block_height: ['700'] }),
    { entry: entry({ pubkey: key(8) }), report: undefined },
    row(key(9), {}, { lnd_block_height: ['900'] }),
  ];

  // Act
  const heights = peerHeights(PK, 'mainnet', rows, NOW);

  // Assert
  assert.deepEqual(heights, [100, 900]);
});

test('an instance at the explorer tip has no lag', () => {
  const result = check({ tips: new Map([[MEMPOOL, { height: 971485, at: NOW }]]) });

  assert.deepEqual(result, { kind: 'explorer', height: 971485, source: MEMPOOL, lag: 0, networkMismatch: false });
});

test('the lag is the reference minus the reported height', () => {
  assert.equal(check({ tips: new Map([[MEMPOOL, { height: 971488, at: NOW }]]) }).lag, 3);
});

test('without a fresh explorer tip, three or more peers give the reference', () => {
  const result = check({ tips: new Map(), peers: [971490, 971489, 971488] });

  assert.deepEqual(result, { kind: 'peers', height: 971489, count: 3, lag: 4, networkMismatch: false });
});

test('with neither an explorer tip nor three peers, the cross-check is unavailable', () => {
  assert.deepEqual(check({ tips: new Map(), peers: [971490, 971489] }), { kind: 'unavailable', networkMismatch: false });
});

test('a network with no explorer is exempt from the cross-check', () => {
  const result = check({ report: report({ lnd_network: ['regtest'] }), entry: entry({ network: 'regtest' }) });

  assert.deepEqual(result, { kind: 'exempt', networkMismatch: false });
});

test('a network with an empty explorer list is exempt too', () => {
  const result = check({ report: report({ lnd_network: ['signet'] }), entry: entry({ network: 'signet' }) });

  assert.equal(result.kind, 'exempt');
});

test('a reported network other than the trusted one is a mismatch, checked against the trusted network', () => {
  // A regtest node listed as mainnet does not earn regtest's exemption.
  const result = check({ report: report({ lnd_network: ['regtest'], lnd_block_height: ['150'] }) });

  assert.deepEqual(result, { kind: 'explorer', height: 971486, source: MEMPOOL, lag: 971336, networkMismatch: true });
});

test('a Cashu instance has no LND to cross-check', () => {
  const cashu = report({ escrow_mode: ['cashu'], lnd_block_height: null, lnd_synced_to_chain: null, lnd_network: null });

  assert.deepEqual(check({ report: cashu }), { kind: 'none', networkMismatch: false });
});

test('a Lightning instance that cannot reach LND reports no height to compare', () => {
  const unreachable = report({ lnd_block_height: null, lnd_synced_to_chain: null, lnd_network: null });

  assert.deepEqual(check({ report: unreachable }), { kind: 'no_height', networkMismatch: false });
});

test('the peers given to the cross-check never include the instance itself', () => {
  const rows = [{ entry: entry(), report: report() }, { entry: entry({ pubkey: OTHER }), report: report({}, { pubkey: OTHER }) }];

  assert.deepEqual(peerHeights(PK, 'mainnet', rows, NOW), [971485]);
});

test('a tip whose height is not a safe integer is skipped, never taken as the reference', () => {
  const tips = new Map([[MEMPOOL, { height: Number.NaN, at: NOW }], [BLOCKSTREAM, { height: 1000, at: NOW }]]);

  assert.deepEqual(explorerReference([MEMPOOL, BLOCKSTREAM], tips, NOW, MAX_AGE), { height: 1000, source: BLOCKSTREAM });
  assert.equal(explorerReference([MEMPOOL], new Map([[MEMPOOL, { height: '971485', at: NOW }]]), NOW, MAX_AGE), null);
});

test('a tip fetched exactly the maximum age ago is still fresh, and one dated in the future is not', () => {
  assert.notEqual(explorerReference([MEMPOOL], new Map([[MEMPOOL, { height: 5, at: NOW - MAX_AGE }]]), NOW, MAX_AGE), null);
  assert.equal(explorerReference([MEMPOOL], new Map([[MEMPOOL, { height: 5, at: NOW + 1 }]]), NOW, MAX_AGE), null);
});

test('a Lightning height with no reported network is a mismatch: it cannot be placed on a chain', () => {
  const result = check({ report: report({ lnd_network: null }) });

  assert.equal(result.networkMismatch, true);
  assert.equal(result.kind, 'explorer');
});

test('LND tags on a Cashu event are not read, so they cannot flag a mismatch', () => {
  const cashu = report({ escrow_mode: ['cashu'], lnd_network: ['regtest'] });

  assert.deepEqual(check({ report: cashu }), { kind: 'none', networkMismatch: false });
});

test('a negative explorer height is not a reference', () => {
  const tips = new Map([[MEMPOOL, { height: -1, at: NOW }]]);

  assert.equal(explorerReference([MEMPOOL], tips, NOW, MAX_AGE), null);
  assert.equal(check({ tips, peers: [] }).kind, 'unavailable');
});

test('a Lightning report with no height but the wrong network still shows the mismatch', () => {
  const noHeight = report({ lnd_block_height: null, lnd_network: ['regtest'] });

  assert.deepEqual(check({ report: noHeight }), { kind: 'no_height', networkMismatch: true });
});
