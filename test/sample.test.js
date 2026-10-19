import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSample, readRelays } from '../scripts/sample.mjs';
import { NOW, PK, OTHER, yes, healthEvent } from './helpers/events.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MEMPOOL = 'https://mempool.space/api/blocks/tip/height';

/** A repository with its own settings: two relays, one explorer, two instances. */
async function repoWith(t, { instances } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'semaforo-sample-root-'));
  const dataDir = join(root, 'data');
  t.after(() => rm(root, { recursive: true, force: true }));
  const committed = JSON.parse(await readFile(join(ROOT, 'config.json'), 'utf8'));
  await writeFile(join(root, 'config.json'), JSON.stringify({
    ...committed, relays: ['wss://a', 'wss://b'], explorers: { mainnet: [MEMPOOL] },
  }));
  await writeFile(join(root, 'trusted.json'), JSON.stringify({
    instances: instances ?? [
      { pubkey: PK, name: 'Mostro', network: 'mainnet', monitored: true },
      { pubkey: OTHER, name: 'Silent', network: 'mainnet', monitored: true },
    ],
    watchers: [],
  }));
  return { root, dataDir };
}

/** A relay that answers the subscription with `events`, then EOSE; or fails to connect. */
function relayWith(events, { fails = false } = {}) {
  if (fails) return () => Promise.reject(new Error('refused'));
  return async () => ({
    onclose: null,
    subscribe(filters, params) {
      for (const event of events) params.onevent(event);
      params.oneose();
    },
    close() {},
  });
}

const fetchTip = async () => ({ ok: true, text: async () => '971485' });
const fetchFails = async () => { throw new Error('offline'); };

function runWith({ root, dataDir }, { relays, fetchImpl = fetchTip, now = NOW + 30 }) {
  return runSample({
    root,
    dataDir,
    // relayUrls normalises each relay, so the keys carry the trailing slash.
    connect: (url) => relays[url](),
    verify: yes,
    fetchImpl,
    now: () => now,
    relayTimeoutMs: 1000,
    explorerTimeoutMs: 1000,
  });
}

test('a run stores one sample per monitored instance from the events the relays return', async (t) => {
  // Arrange
  const repo = await repoWith(t);
  const relays = { 'wss://a/': relayWith([healthEvent()]), 'wss://b/': relayWith([]) };

  // Act
  const result = await runWith(repo, { relays });

  // Assert
  assert.equal(result.stored, true);
  assert.equal(result.answered, 2);
  assert.deepEqual(result.samples.map((s) => [s.pubkey, s.state, s.reasons]), [[PK, 'green', []], [OTHER, 'red', ['not_reporting']]]);
  const lines = (await readFile(join(repo.dataDir, 'samples', PK, '2026-10.ndjson'), 'utf8')).trim().split('\n');
  assert.deepEqual(JSON.parse(lines[0]), { t: NOW + 30, state: 'green', status: 'ok', lag: 0, reasons: [], event: 'e'.repeat(64), seq: 7 });
  assert.deepEqual(JSON.parse(await readFile(join(repo.dataDir, 'last.json'), 'utf8')), { t: NOW + 30 });
});

const fetchHeight = (height) => async () => ({ ok: true, text: async () => String(height) });

test('a burst of blocks the run had not seen when the node signed is no lag in the sample', async (t) => {
  // Arrange: the first run sees 971485; the next one, ten minutes later,
  // sees three more blocks, and the node signed just before it looked.
  const repo = await repoWith(t);
  const first = { 'wss://a/': relayWith([healthEvent()]), 'wss://b/': relayWith([]) };
  await runWith(repo, { relays: first, fetchImpl: fetchHeight(971485) });
  const signedAt = NOW + 30 + 590;
  const later = { 'wss://a/': relayWith([healthEvent({ seq: ['8'] }, { createdAt: signedAt })]), 'wss://b/': relayWith([]) };

  // Act
  const result = await runWith(repo, { relays: later, fetchImpl: fetchHeight(971488), now: NOW + 30 + 600 });

  // Assert
  const sample = result.samples.find((s) => s.pubkey === PK);
  assert.deepEqual([sample.state, sample.lag, sample.reasons], ['green', 0, []]);
});

test('a run too soon to sample still looks at the explorers, so the blocks it saw count against later reports', async (t) => {
  const repo = await repoWith(t);
  const relays = { 'wss://a/': relayWith([healthEvent()]), 'wss://b/': relayWith([]) };
  await runWith(repo, { relays, fetchImpl: fetchHeight(971485) });
  await runWith(repo, { relays, fetchImpl: fetchHeight(971488), now: NOW + 30 + 300 });
  const signedAt = NOW + 30 + 590;
  const later = { 'wss://a/': relayWith([healthEvent({ seq: ['8'] }, { createdAt: signedAt })]), 'wss://b/': relayWith([]) };

  const result = await runWith(repo, { relays: later, fetchImpl: fetchHeight(971488), now: NOW + 30 + 600 });

  const sample = result.samples.find((s) => s.pubkey === PK);
  assert.deepEqual([sample.state, sample.lag, sample.reasons], ['red', 3, ['block_lag']]);
  const stored = JSON.parse(await readFile(join(repo.dataDir, 'tips.json'), 'utf8'));
  assert.deepEqual(stored, [[MEMPOOL, { height: 971488, at: NOW + 30 + 600, since: NOW + 30 + 300, previous: { height: 971485, at: NOW + 30 } }]]);
});

test('a second run too soon after the last sample stores nothing', async (t) => {
  const repo = await repoWith(t);
  const relays = { 'wss://a/': relayWith([healthEvent()]), 'wss://b/': relayWith([]) };
  await runWith(repo, { relays });

  const result = await runWith(repo, { relays, now: NOW + 30 + 300 });

  assert.deepEqual(result, { stored: false, reason: 'too soon' });
  const lines = (await readFile(join(repo.dataDir, 'samples', PK, '2026-10.ndjson'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 1);
});

test('a run that reached no relay stores nothing, so an outage on our side is a gap', async (t) => {
  const repo = await repoWith(t);
  const relays = { 'wss://a/': relayWith([], { fails: true }), 'wss://b/': relayWith([], { fails: true }) };

  const result = await runWith(repo, { relays });

  assert.deepEqual(result, { stored: false, reason: 'no relay answered' });
  await assert.rejects(readdir(join(repo.dataDir, 'samples')));
});

test('one relay answering is enough, and the samples say which events it had', async (t) => {
  const repo = await repoWith(t);
  const relays = { 'wss://a/': relayWith([], { fails: true }), 'wss://b/': relayWith([healthEvent()]) };

  const result = await runWith(repo, { relays });

  assert.equal(result.stored, true);
  assert.equal(result.answered, 1);
  assert.equal(result.samples[0].state, 'green');
});

test('without an explorer tip a Lightning instance is sampled yellow, not independently verified', async (t) => {
  const repo = await repoWith(t);
  const relays = { 'wss://a/': relayWith([healthEvent()]), 'wss://b/': relayWith([]) };

  const result = await runWith(repo, { relays, fetchImpl: fetchFails });

  assert.equal(result.samples[0].state, 'yellow');
  assert.deepEqual(result.samples[0].reasons, ['unverified']);
});

test('month files older than the raw retention are removed after a run', async (t) => {
  const repo = await repoWith(t);
  await mkdir(join(repo.dataDir, 'samples', PK), { recursive: true });
  await writeFile(join(repo.dataDir, 'samples', PK, '2026-03.ndjson'), '{"t":1}\n');
  const relays = { 'wss://a/': relayWith([healthEvent()]), 'wss://b/': relayWith([]) };

  const result = await runWith(repo, { relays });

  assert.deepEqual(result.removed, [`${PK}/2026-03.ndjson`]);
  assert.deepEqual(await readdir(join(repo.dataDir, 'samples', PK)), ['2026-10.ndjson']);
});

test('invalid settings stop the run before it touches anything', async (t) => {
  const repo = await repoWith(t, { instances: [{ pubkey: 'nope', name: 'x', network: 'mainnet', monitored: true }] });

  await assert.rejects(runWith(repo, { relays: {} }), /instances\[0\]\.pubkey must be a lowercase hex key/);
});

test('reading the relays gives up on one that never answers once the timeout passes', async () => {
  // Arrange: a relay that connects and stays silent.
  const silent = async () => ({ onclose: null, subscribe() {}, close() {} });
  let fire = null;
  const timers = {
    setTimeout(fn, ms) { if (ms === 50) fire = fn; return { fn }; },
    clearTimeout() {},
  };
  const trusted = { instances: [{ pubkey: PK }], watchers: [] };

  // Act
  const pending = readRelays({ urls: ['wss://a'], trusted, connect: silent, verify: yes, now: () => NOW, timeoutMs: 50, timers });
  await new Promise((resolve) => setImmediate(resolve));
  fire();
  const result = await pending;

  // Assert
  assert.equal(result.answered, 0);
  assert.equal(result.store.health.size, 0);
});

test('a relay that answered and then dropped still counts as answered, so the run is not discarded', async () => {
  // Arrange: relay A answers with EOSE and closes at once; relay B refuses a moment later.
  const answersThenDrops = async () => {
    const relay = {
      onclose: null,
      subscribe(filters, params) {
        params.oneose();
        queueMicrotask(() => relay.onclose?.());
      },
      close() {},
    };
    return relay;
  };
  const refuses = () => new Promise((_, reject) => setImmediate(() => reject(new Error('refused'))));
  const connect = (url) => (url === 'wss://a' ? answersThenDrops() : refuses());
  const trusted = { instances: [{ pubkey: PK }], watchers: [] };

  // Act
  const result = await readRelays({ urls: ['wss://a', 'wss://b'], trusted, connect, verify: yes, now: () => NOW, timeoutMs: 1000 });

  // Assert
  assert.equal(result.answered, 1);
});
