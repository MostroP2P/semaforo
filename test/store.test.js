import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyStore, addEvent } from '../src/store.js';
import { NOW, PK, OTHER, yes, healthEvent, watcherEvent, infoEvent } from './helpers/events.js';

const WATCHER = 'c'.repeat(64);
const STRANGER = 'd'.repeat(64);
const trusted = { instances: [{ pubkey: PK }, { pubkey: OTHER }], watchers: [{ pubkey: WATCHER }] };
const add = (store, event, relay = 'wss://one') => addEvent(store, { event, relay, now: NOW, verify: yes, trusted });
const id = (n) => String(n).repeat(64);

test('a valid health event of a trusted instance is kept, with the relay that returned it', () => {
  // Act
  const { store, changed } = add(emptyStore(), healthEvent());

  // Assert
  assert.equal(changed, true);
  assert.equal(store.health.get(PK).report.seq, 7);
  assert.deepEqual(store.health.get(PK).relays, ['wss://one']);
});

test('the store it was given is never changed', () => {
  const before = emptyStore();

  add(before, healthEvent());

  assert.equal(before.health.size, 0);
});

test('the same event from another relay adds that relay, once', () => {
  let { store } = add(emptyStore(), healthEvent(), 'wss://one');
  ({ store } = add(store, healthEvent(), 'wss://two'));
  const again = add(store, healthEvent(), 'wss://two');

  assert.deepEqual(again.store.health.get(PK).relays, ['wss://one', 'wss://two']);
  assert.equal(again.changed, false);
});

test('a higher seq replaces the revision and starts its relay list again', () => {
  let { store } = add(emptyStore(), healthEvent({ seq: ['7'] }, { id: id(1) }), 'wss://one');
  ({ store } = add(store, healthEvent({ seq: ['8'] }, { id: id(2) }), 'wss://two'));

  assert.equal(store.health.get(PK).report.id, id(2));
  assert.deepEqual(store.health.get(PK).relays, ['wss://two']);
});

test('an older revision a relay still serves is ignored', () => {
  let { store } = add(emptyStore(), healthEvent({ seq: ['8'] }, { id: id(2) }));
  const result = add(store, healthEvent({ seq: ['7'] }, { id: id(1) }), 'wss://stale');

  assert.equal(result.changed, false);
  assert.equal(result.store.health.get(PK).report.id, id(2));
});

test('events of keys outside the trusted list are ignored', () => {
  const stranger = healthEvent({}, { pubkey: STRANGER });

  assert.equal(add(emptyStore(), stranger).changed, false);
  assert.equal(add(emptyStore(), infoEvent({}, { pubkey: STRANGER })).changed, false);
  assert.equal(add(emptyStore(), watcherEvent({}, { pubkey: STRANGER })).changed, false);
});

test('a heartbeat from an instance key or a health event from a watcher key is ignored', () => {
  assert.equal(add(emptyStore(), watcherEvent({}, { pubkey: PK })).changed, false);
  assert.equal(add(emptyStore(), healthEvent({}, { pubkey: WATCHER })).changed, false);
});

test('a watcher heartbeat is kept like a health event', () => {
  const { store } = add(emptyStore(), watcherEvent({}, { pubkey: WATCHER }));

  assert.equal(store.heartbeats.get(WATCHER).report.software, 'mostro-watchdog');
});

test('an invalid event changes nothing', () => {
  assert.equal(add(emptyStore(), healthEvent({ seq: ['0'] })).changed, false);
  assert.equal(add(emptyStore(), { kind: 1 }).changed, false);
});

test('the newest info event of a trusted instance is kept', () => {
  let { store } = add(emptyStore(), infoEvent({ fee: ['0.01'] }, { createdAt: NOW - 60, id: id(1) }));
  ({ store } = add(store, infoEvent({ fee: ['0.02'] }, { id: id(2) })));
  const older = add(store, infoEvent({ fee: ['0.03'] }, { createdAt: NOW - 120, id: id(3) }));

  assert.equal(older.changed, false);
  assert.equal(older.store.info.get(PK).fee, 0.02);
});

test('an invalid info event changes nothing', () => {
  assert.equal(add(emptyStore(), infoEvent({}, { createdAt: NOW + 1000 })).changed, false);
});
