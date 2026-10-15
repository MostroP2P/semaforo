import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instanceLight, watcherState } from '../src/light.js';
import { crossCheck } from '../src/crosscheck.js';
import { parseHealthEvent } from '../src/reader.js';
import { NOW, SINCE, yes, healthEvent, watcherEvent } from './helpers/events.js';

const LAG_RED = 3;
const entry = (overrides = {}) => ({ pubkey: 'a'.repeat(64), name: 'Mostro', network: 'mainnet', monitored: true, relays: [], ...overrides });
const report = (overrides = {}, options = {}) => parseHealthEvent(healthEvent(overrides, options), NOW, yes).report;
const atTip = { kind: 'explorer', height: 971485, source: 'x', lag: 0, networkMismatch: false };
const checks = (states) => Object.entries(states).map(([name, state]) => [name, state, SINCE]);

function light(overrides = {}) {
  return instanceLight({ entry: entry(), report: report(), crossCheck: atTip, now: NOW, blockLagRed: LAG_RED, ...overrides });
}

test('a fresh ok report with no lag is green, with no reasons', () => {
  // Act
  const result = light();

  // Assert
  assert.deepEqual(result, { state: 'green', status: 'ok', reasons: [], labels: [], lag: 0 });
});

test('an instance that is not monitored is grey, whatever it publishes', () => {
  assert.deepEqual(light({ entry: entry({ monitored: false }) }), { state: 'grey', status: null, reasons: [], labels: [], lag: null });
  assert.equal(light({ entry: entry({ monitored: false }), report: undefined, crossCheck: null }).state, 'grey');
});

test('a monitored instance with no valid event is red, not reporting', () => {
  const expected = { state: 'red', status: null, reasons: ['not_reporting'], labels: ['not_reporting'], lag: null };

  assert.deepEqual(light({ report: undefined, crossCheck: null }), expected);
});

test('a monitored instance whose last event expired is red, not reporting', () => {
  assert.deepEqual(light({ now: NOW + 180 }).reasons, ['not_reporting']);
  assert.equal(light({ now: NOW + 180 }).state, 'red');
});

test('status down is red, with the failing checks as reasons in protocol order', () => {
  const down = report({ status: ['down'] }, { checks: checks({ payouts: 'fail', lnd_sync: 'fail', relays: 'ok', database: 'ok' }) });

  const result = light({ report: down });

  assert.equal(result.state, 'red');
  assert.equal(result.status, 'down');
  assert.deepEqual(result.reasons, ['lnd_sync', 'payouts']);
});

test('status degraded is yellow, with warn and unknown checks as reasons', () => {
  const degraded = report({ status: ['degraded'] }, { checks: checks({ lnd_sync: 'ok', payouts: 'warn', relays: 'unknown', database: 'ok' }) });

  const result = light({ report: degraded });

  assert.equal(result.state, 'yellow');
  assert.deepEqual(result.reasons, ['payouts', 'relays']);
});

test('maintenance is yellow, labelled maintenance', () => {
  const result = light({ report: report({ status: ['degraded'], maintenance_mode: ['true'] }) });

  assert.equal(result.state, 'yellow');
  assert.deepEqual(result.reasons, ['maintenance']);
  assert.deepEqual(result.labels, ['maintenance']);
});

test('a lag of block_lag_red or more is red whatever the status says', () => {
  const lagging = { ...atTip, height: 971488, lag: 3 };

  const result = light({ crossCheck: lagging });

  assert.equal(result.state, 'red');
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.reasons, ['block_lag']);
  assert.equal(result.lag, 3);
});

test('a lag below block_lag_red stays green', () => {
  assert.equal(light({ crossCheck: { ...atTip, lag: 2 } }).state, 'green');
});

test('a lag from the peer median counts the same as one from an explorer', () => {
  const peers = { kind: 'peers', height: 971490, count: 3, lag: 5, networkMismatch: false };

  assert.equal(light({ crossCheck: peers }).state, 'red');
});

test('an unavailable cross-check turns an otherwise green instance yellow, not independently verified', () => {
  const result = light({ crossCheck: { kind: 'unavailable', networkMismatch: false } });

  assert.deepEqual(result, { state: 'yellow', status: 'ok', reasons: ['unverified'], labels: ['unverified'], lag: null });
});

test('an unavailable cross-check never makes a red instance look better', () => {
  const down = report({ status: ['down'] }, { checks: checks({ lnd_sync: 'fail' }) });

  assert.equal(light({ report: down, crossCheck: { kind: 'unavailable', networkMismatch: false } }).state, 'red');
});

test('an exempt network, a Cashu instance or an unreachable LND add no cross-check reason', () => {
  for (const kind of ['exempt', 'none', 'no_height']) {
    assert.deepEqual(light({ crossCheck: { kind, networkMismatch: false } }).reasons, [], kind);
  }
});

test('a reported network other than the trusted one is yellow, unexpected network', () => {
  const result = light({ crossCheck: { ...atTip, networkMismatch: true } });

  assert.equal(result.state, 'yellow');
  assert.deepEqual(result.reasons, ['network_mismatch']);
  assert.deepEqual(result.labels, ['network_mismatch']);
});

test('a published status no known check explains is a reason of its own', () => {
  // A later protocol version may add a check that drove status down.
  const result = light({ report: report({ status: ['down'] }) });

  assert.equal(result.state, 'red');
  assert.deepEqual(result.reasons, ['reported_status']);
});

test('a recomputed status worse than the published one wins', () => {
  // Published ok, but LND is not synced: never better than the checks say.
  const allOkBut = checks({ lnd_sync: 'fail', payouts: 'ok', relays: 'ok', database: 'ok' });
  const result = light({ report: report({ status: ['ok'] }, { checks: allOkBut }) });

  assert.equal(result.state, 'red');
  assert.equal(result.status, 'down');
  assert.deepEqual(result.reasons, ['lnd_sync']);
});

test('reasons follow one fixed order, so every sample of the same state is the same', () => {
  const report_ = report(
    { status: ['down'], maintenance_mode: ['true'] },
    { checks: checks({ database: 'fail', relays: 'ok', payouts: 'ok', lnd_sync: 'warn' }) },
  );

  const result = light({ report: report_, crossCheck: { ...atTip, lag: 9, networkMismatch: true } });

  assert.deepEqual(result.reasons, ['lnd_sync', 'database', 'block_lag', 'network_mismatch', 'maintenance']);
  assert.deepEqual(result.labels, ['network_mismatch', 'maintenance']);
});

test('a watcher is alive while its newest heartbeat is fresh', () => {
  const { report: heartbeat } = parseHealthEvent(watcherEvent(), NOW, yes);

  assert.equal(watcherState(heartbeat, NOW), 'alive');
  assert.equal(watcherState(heartbeat, NOW + 179), 'alive');
  assert.equal(watcherState(heartbeat, NOW + 180), 'not_reporting');
  assert.equal(watcherState(undefined, NOW), 'not_reporting');
});

test('the lag threshold is inclusive: 2 blocks is green, 3 is red, a node ahead is green', () => {
  assert.equal(light({ crossCheck: { ...atTip, lag: 2 } }).state, 'green');
  assert.equal(light({ crossCheck: { ...atTip, lag: 3 } }).state, 'red');
  assert.equal(light({ crossCheck: { ...atTip, lag: -1 } }).state, 'green');
});

test('a lag that is not a number, or a missing threshold, fails closed to red', () => {
  assert.equal(light({ crossCheck: { ...atTip, lag: Number.NaN } }).state, 'red');
  assert.equal(light({ blockLagRed: undefined }).state, 'red');
});

test('from event to colour: a mismatch on an exempt trusted network is yellow, and a mismatch with a lag is red', () => {
  // Arrange
  const explorers = new Map([['mainnet', ['https://x.example/tip']]]);
  const tips = new Map([['https://x.example/tip', { height: 971500, at: NOW }]]);
  const run = (entryOverrides, reportOverrides) => {
    const e = entry(entryOverrides);
    const r = report(reportOverrides);
    const cc = crossCheck({ report: r, entry: e, explorers, tips, peers: [], now: NOW, tipMaxAgeSeconds: 1800 });
    return instanceLight({ entry: e, report: r, crossCheck: cc, now: NOW, blockLagRed: LAG_RED });
  };

  // Act
  const exempt = run({ network: 'regtest' }, { lnd_network: ['mainnet'] });
  const lagging = run({ network: 'mainnet' }, { lnd_network: ['regtest'] });

  // Assert
  assert.equal(exempt.state, 'yellow');
  assert.deepEqual(exempt.reasons, ['network_mismatch']);
  assert.equal(lagging.state, 'red');
  assert.deepEqual(lagging.reasons, ['block_lag', 'network_mismatch']);
});
