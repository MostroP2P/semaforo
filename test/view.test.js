import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageView } from '../src/view.js';
import { emptyStore, addEvent } from '../src/store.js';
import { catalogue } from '../src/i18n.js';
import { NOW, PK, OTHER, SINCE, yes, healthEvent, watcherEvent, infoEvent } from './helpers/events.js';

const MEMPOOL = 'https://mempool.space/api/blocks/tip/height';
const WATCHER = 'c'.repeat(64);
const WATCHER2 = 'd'.repeat(64);
const config = {
  relays: ['wss://one', 'wss://two', 'wss://three'],
  explorers: new Map([['mainnet', [MEMPOOL]]]),
  historyDaysShown: 90,
  blockLagRed: 3,
  explorerTipMaxAgeMinutes: 30,
};
const trusted = {
  instances: [
    { pubkey: PK, name: 'Mostro', region: 'Global', network: 'mainnet', monitored: true, website: 'https://mostro.network', relays: [] },
    { pubkey: OTHER, name: 'Grey One', region: null, network: 'mainnet', monitored: false, website: null, relays: [] },
  ],
  watchers: [],
};

function storeWith(...events) {
  let store = emptyStore();
  for (const [event, relay = 'wss://one'] of events) {
    ({ store } = addEvent(store, { event, relay, now: NOW, verify: yes, trusted: { ...trusted, watchers: [{ pubkey: WATCHER }, { pubkey: WATCHER2 }] } }));
  }
  return store;
}

function view(overrides = {}) {
  return pageView({
    t: catalogue('en'),
    trusted,
    config,
    store: storeWith([healthEvent()], [healthEvent(), 'wss://two']),
    relays: 'reachable',
    tips: new Map([[MEMPOOL, { height: 971485, at: NOW }]]),
    now: NOW + 45,
    ...overrides,
  });
}

const detail = (row, term) => row.details.find((d) => d.term === term)?.value;

test('a healthy monitored instance is a green row with its details', () => {
  // Act
  const [row] = view().rows;

  // Assert
  assert.equal(row.state, 'green');
  assert.equal(row.icon, '✓');
  assert.equal(row.word, 'Operational');
  assert.deepEqual(row.labels, []);
  assert.equal(row.name, 'Mostro');
  assert.equal(row.region, 'Global');
  assert.equal(row.escrow, 'Lightning');
  assert.equal(detail(row, 'Last seen'), '45 s ago (2026-10-14 17:46 UTC) · Returned by 2 of 3 relays');
  assert.equal(detail(row, 'Block height'), '971485 · tip 971485 at mempool.space · in sync');
  assert.equal(detail(row, 'Escrow'), 'Lightning');
  assert.equal(detail(row, 'Mostro version'), '0.19.3');
  assert.match(row.event.href, /^https:\/\/njump\.me\/nevent1[a-z0-9]+$/);
  assert.equal(row.note, null);
});

test('each check shows its state and since when', () => {
  const [row] = view().rows;

  assert.deepEqual(row.checks[0], {
    name: 'LND sync',
    state: 'ok',
    text: 'ok · since 2026-10-13 14:00 UTC (1 d 3 h)',
  });
});

test('a check the event left out says so', () => {
  const store = storeWith([healthEvent({}, { checks: [['relays', 'ok', SINCE], ['database', 'ok', SINCE]] })]);

  const [row] = view({ store }).rows;

  assert.deepEqual(row.checks.find((c) => c.name === 'LND sync'), { name: 'LND sync', state: 'unknown', text: 'unknown · not in the event' });
});

test('a monitored instance lagging three blocks is red and says how far behind', () => {
  const [row] = view({ tips: new Map([[MEMPOOL, { height: 971488, at: NOW }]]) }).rows;

  assert.equal(row.state, 'red');
  assert.equal(row.word, 'Down');
  assert.equal(detail(row, 'Block height'), '971485 · tip 971488 at mempool.space · 3 blocks behind');
});

test('a monitored instance with no event is red and says not reporting, not down', () => {
  const [row] = view({ store: emptyStore() }).rows;

  assert.equal(row.state, 'red');
  assert.equal(row.icon, '✕');
  assert.equal(row.word, 'Not reporting');
  assert.deepEqual(row.labels, []);
  assert.equal(detail(row, 'Last seen'), 'No valid health event seen');
  assert.equal(row.event, null);
});

test('before any relay has answered, a row without data is checking, not red', () => {
  const page = view({ store: emptyStore(), relays: 'connecting' });

  assert.equal(page.rows[0].state, 'checking');
  assert.equal(page.rows[0].word, 'Checking…');
  assert.equal(page.banner.text, 'Checking…');
});

test('when no relay can be reached, a row without data cannot be verified', () => {
  const page = view({ store: emptyStore(), relays: 'unreachable' });

  assert.equal(page.rows[0].state, 'unverifiable');
  assert.equal(page.rows[0].icon, '?');
  assert.equal(page.banner.text, 'Unable to verify status');
});

test('an instance that is not monitored is a grey row', () => {
  const row = view().rows[1];

  assert.equal(row.state, 'grey');
  assert.equal(row.icon, '?');
  assert.equal(row.word, 'Not monitored');
  assert.equal(row.escrow, null);
});

test('labels name maintenance, an unverified cross-check and a network mismatch', () => {
  const store = storeWith([healthEvent({ status: ['degraded'], maintenance_mode: ['true'], lnd_network: ['signet'] })]);

  const [row] = view({ store, tips: new Map() }).rows;

  assert.equal(row.state, 'yellow');
  assert.equal(row.word, 'Degraded');
  assert.deepEqual(row.labels, ['Not independently verified', 'Unexpected network', 'Maintenance']);
  assert.equal(detail(row, 'Network'), 'reports signet, listed on mainnet');
  assert.equal(detail(row, 'Maintenance'), 'on: new orders are not taken');
  assert.equal(detail(row, 'Block height'), '971485 · no independent reference right now');
});

test('a stale event keeps its details with a note that they may no longer hold', () => {
  const [row] = view({ now: NOW + 200 }).rows;

  assert.equal(row.state, 'red');
  assert.equal(row.note, 'These values come from the last valid event and may no longer hold.');
  assert.equal(detail(row, 'Last seen'), '3 min ago (2026-10-14 17:46 UTC) · Returned by 2 of 3 relays');
});

test('the info event gives the fee and the version', () => {
  const store = storeWith([healthEvent()], [infoEvent({ fee: ['0.006'], mostro_version: ['0.20.0'] })]);

  const [row] = view({ store }).rows;

  assert.equal(detail(row, 'Fee'), '0.6 %');
  assert.equal(detail(row, 'Mostro version'), '0.20.0');
});

test('the peer median and an exempt network are named in the height', () => {
  const regtest = { ...trusted, instances: [{ ...trusted.instances[0], network: 'regtest' }] };
  const store = storeWith([healthEvent({ lnd_network: ['regtest'] })]);

  assert.equal(detail(view({ trusted: regtest, store }).rows[0], 'Block height'), '971485 · no explorer for regtest');
});

test('LND that cannot be reached is said plainly', () => {
  const store = storeWith([healthEvent({ status: ['down'], lnd_block_height: null, lnd_synced_to_chain: null, lnd_network: null })]);

  assert.equal(detail(view({ store }).rows[0], 'Block height'), 'LND unreachable');
});

test('the banner and its counters count only monitored instances', () => {
  const { banner } = view();

  assert.deepEqual(banner, {
    state: 'green',
    text: 'All Mostros operational',
    counts: [
      { state: 'green', text: '1 operational' },
      { state: 'yellow', text: '0 degraded' },
      { state: 'red', text: '0 down' },
    ],
  });
});

test('the page reads in Spanish with the Spanish catalogue', () => {
  const page = view({ t: catalogue('es') });

  assert.equal(page.banner.text, 'Todos los Mostros operativos');
  assert.equal(page.rows[0].word, 'Operativo');
  assert.equal(page.history.title, 'Disponibilidad en los últimos 90 días');
});

test('with no watcher listed, the monitoring section says so', () => {
  assert.deepEqual(view().watchers, { state: 'none', summary: 'No watcher is listed yet.', items: [] });
});

test('each listed watcher is alive or not reporting, with its last heartbeat', () => {
  // Arrange
  const withWatchers = { ...trusted, watchers: [{ pubkey: WATCHER, name: 'Watchdog A' }, { pubkey: WATCHER2, name: 'Watchdog B' }] };
  const store = storeWith([watcherEvent({}, { pubkey: WATCHER })]);

  // Act
  const { watchers } = view({ trusted: withWatchers, store });

  // Assert
  assert.equal(watchers.state, 'yellow');
  assert.equal(watchers.summary, '1 of 2 watchers alive');
  assert.deepEqual(watchers.items, [
    { name: 'Watchdog A', state: 'alive', text: 'Alive · last heartbeat 45 s ago' },
    { name: 'Watchdog B', state: 'not_reporting', text: 'Not reporting · no heartbeat seen' },
  ]);
});

test('every listed watcher alive is green, and none alive is red', () => {
  const one = { ...trusted, watchers: [{ pubkey: WATCHER, name: 'A' }] };

  assert.equal(view({ trusted: one, store: storeWith([watcherEvent({}, { pubkey: WATCHER })]) }).watchers.state, 'green');
  assert.equal(view({ trusted: one, store: emptyStore() }).watchers.state, 'red');
  assert.equal(view({ trusted: one, store: emptyStore(), relays: 'connecting' }).watchers.state, 'checking');
});

test('a height with no reported network says it reports none', () => {
  const store = storeWith([healthEvent({ lnd_network: null })]);

  const [row] = view({ store }).rows;

  assert.equal(row.state, 'yellow');
  assert.equal(detail(row, 'Network'), 'reports no network, listed on mainnet');
});

test('the peer median is named in the height when no explorer answered', () => {
  // Arrange: three other monitored instances on mainnet, one of them behind.
  const keys = ['1', '2', '3'].map((n) => n.repeat(64));
  const many = {
    ...trusted,
    instances: [trusted.instances[0], ...keys.map((pubkey) => ({ ...trusted.instances[0], pubkey, name: pubkey.slice(0, 4) }))],
  };
  let store = emptyStore();
  const heights = ['971485', '971490', '971490', '971489'];
  [PK, ...keys].forEach((pubkey, i) => {
    ({ store } = addEvent(store, {
      event: healthEvent({ lnd_block_height: [heights[i]] }, { pubkey }), relay: 'wss://one', now: NOW, verify: yes, trusted: many,
    }));
  });

  // Act
  const [row] = view({ trusted: many, store, tips: new Map() }).rows;

  // Assert
  assert.equal(detail(row, 'Block height'), '971485 · median 971490 of 3 other instances · 5 blocks behind');
  assert.equal(row.state, 'red');
});
