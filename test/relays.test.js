import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relayState, createRelayPool, retryDelay } from '../src/relays.js';

test('one live relay makes the page reachable', () => {
  assert.equal(relayState(['down', 'live', 'connecting'], 0, 1, 10), 'reachable');
});

test('with no live relay, the page is connecting until the timeout, then unreachable', () => {
  assert.equal(relayState(['connecting', 'down'], 100, 109, 10), 'connecting');
  assert.equal(relayState(['connecting', 'down'], 100, 110, 10), 'unreachable');
  assert.equal(relayState([], 100, 200, 10), 'unreachable');
});

test('a relay that keeps failing is retried less and less often, up to a minute', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(retryDelay), [5000, 10000, 20000, 40000, 60000, 60000]);
});

/** A relay that records what the pool asks of it. */
function fakeRelay() {
  const relay = {
    subscriptions: [],
    closed: false,
    onclose: null,
    subscribe(filters, params) {
      relay.subscriptions.push({ filters, params });
      return { close() {} };
    },
    close() {
      relay.closed = true;
      relay.onclose?.();
    },
  };
  return relay;
}

/** Timers the test runs by hand. */
function fakeTimers() {
  const pending = [];
  return {
    pending,
    setTimeout(fn, ms) {
      pending.push({ fn, ms });
      return pending.length;
    },
    clearTimeout() {},
    runAll() {
      for (const timer of pending.splice(0)) timer.fn();
    },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('the pool subscribes each relay, passes events with their relay, and reports live after EOSE', async () => {
  // Arrange
  const relays = { 'wss://a': fakeRelay(), 'wss://b': fakeRelay() };
  const events = [];
  const statuses = [];
  const pool = createRelayPool({
    urls: ['wss://a', 'wss://b'],
    filters: [{ kinds: [38389] }],
    connect: async (url) => relays[url],
    onEvent: (event, url) => events.push([event.id, url]),
    onStatus: (status) => statuses.push(Object.fromEntries(status)),
    timers: fakeTimers(),
  });

  // Act
  pool.start();
  await flush();
  relays['wss://a'].subscriptions[0].params.onevent({ id: 'x' });
  relays['wss://a'].subscriptions[0].params.oneose();

  // Assert
  assert.deepEqual(relays['wss://b'].subscriptions[0].filters, [{ kinds: [38389] }]);
  assert.deepEqual(events, [['x', 'wss://a']]);
  assert.deepEqual(statuses.at(-1), { 'wss://a': 'live', 'wss://b': 'connecting' });
});

test('a relay that cannot connect is down and retried after the delay', async () => {
  const timers = fakeTimers();
  let attempts = 0;
  const relay = fakeRelay();
  const pool = createRelayPool({
    urls: ['wss://a'],
    filters: [],
    connect: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('refused');
      return relay;
    },
    onEvent() {},
    onStatus() {},
    timers,
  });

  pool.start();
  await flush();
  assert.equal(pool.status().get('wss://a'), 'down');
  assert.equal(timers.pending[0].ms, 5000);

  timers.runAll();
  await flush();
  assert.equal(attempts, 2);
  assert.equal(relay.subscriptions.length, 1);
});

test('a relay whose connection drops is down and reconnected', async () => {
  const timers = fakeTimers();
  const relay = fakeRelay();
  let connects = 0;
  const pool = createRelayPool({
    urls: ['wss://a'],
    filters: [],
    connect: async () => {
      connects += 1;
      return relay;
    },
    onEvent() {},
    onStatus() {},
    timers,
  });

  pool.start();
  await flush();
  relay.subscriptions[0].params.oneose();
  relay.onclose();

  assert.equal(pool.status().get('wss://a'), 'down');
  timers.runAll();
  await flush();
  assert.equal(connects, 2);
});

test('a subscription the relay closes drops the connection, which is then retried', async () => {
  const timers = fakeTimers();
  const relay = fakeRelay();
  const pool = createRelayPool({
    urls: ['wss://a'], filters: [], connect: async () => relay, onEvent() {}, onStatus() {}, timers,
  });

  pool.start();
  await flush();
  relay.subscriptions[0].params.onclose('auth-required');

  assert.equal(relay.closed, true);
  assert.equal(pool.status().get('wss://a'), 'down');
  assert.equal(timers.pending.length, 1, 'one retry, not one per close callback');
});

test('a stopped pool closes its relays and retries nothing', async () => {
  const timers = fakeTimers();
  const relay = fakeRelay();
  const pool = createRelayPool({
    urls: ['wss://a'], filters: [], connect: async () => relay, onEvent() {}, onStatus() {}, timers,
  });

  pool.start();
  await flush();
  pool.stop();

  assert.equal(relay.closed, true);
  assert.equal(timers.pending.length, 0);
});

test('a connection that completes after stop is closed at once', async () => {
  let release;
  const relay = fakeRelay();
  const pool = createRelayPool({
    urls: ['wss://a'],
    filters: [],
    connect: () => new Promise((resolve) => { release = () => resolve(relay); }),
    onEvent() {},
    onStatus() {},
    timers: fakeTimers(),
  });

  pool.start();
  pool.stop();
  release();
  await flush();

  assert.equal(relay.closed, true);
  assert.equal(relay.subscriptions.length, 0);
});
