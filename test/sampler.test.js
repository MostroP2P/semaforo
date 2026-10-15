import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldSample, sampleRecord, takeSamples, sampleFile, expiredSampleFiles, TOLERANCE_SECONDS } from '../src/sampler.js';
import { emptyStore, addEvent } from '../src/store.js';
import { NOW, PK, OTHER, yes, healthEvent } from './helpers/events.js';

const MEMPOOL = 'https://mempool.space/api/blocks/tip/height';
const config = {
  explorers: new Map([['mainnet', [MEMPOOL]]]),
  sampleIntervalMinutes: 10,
  rawSampleRetentionDays: 90,
  blockLagRed: 3,
  explorerTipMaxAgeMinutes: 30,
};
const trusted = {
  instances: [
    { pubkey: PK, name: 'Mostro', network: 'mainnet', monitored: true, relays: [] },
    { pubkey: OTHER, name: 'Grey One', network: 'mainnet', monitored: false, relays: [] },
  ],
  watchers: [],
};
const tips = new Map([[MEMPOOL, { height: 971485, at: NOW }]]);

function storeWith(...events) {
  let store = emptyStore();
  for (const event of events) ({ store } = addEvent(store, { event, relay: 'wss://one', now: NOW, verify: yes, trusted }));
  return store;
}

test('the first run ever samples', () => {
  assert.equal(shouldSample(null, NOW, 10), true);
});

test('a run samples once the interval has passed, with a minute of tolerance for a late start', () => {
  assert.equal(shouldSample(NOW, NOW + 600, 10), true);
  assert.equal(shouldSample(NOW, NOW + 600 - TOLERANCE_SECONDS, 10), true);
  assert.equal(shouldSample(NOW, NOW + 600 - TOLERANCE_SECONDS - 1, 10), false);
  assert.equal(shouldSample(NOW, NOW + 60, 10), false);
});

test('a green sample records the event it came from and no reasons', () => {
  // Arrange
  const [{ light, report }] = takeSamples({ trusted, config, store: storeWith(healthEvent()), tips, now: NOW + 30 }).map((s) => s.source);

  // Act
  const record = sampleRecord({ light, report, now: NOW + 30 });

  // Assert
  assert.deepEqual(record, { t: NOW + 30, state: 'green', status: 'ok', lag: 0, reasons: [], event: 'e'.repeat(64), seq: 7 });
});

test('a monitored instance with no fresh event samples as red, not reporting, with no event', () => {
  const [sample] = takeSamples({ trusted, config, store: emptyStore(), tips, now: NOW });

  assert.deepEqual(sample.record, { t: NOW, state: 'red', status: null, lag: null, reasons: ['not_reporting'], event: null, seq: null });
});

test('an expired event is not the event of a not-reporting sample', () => {
  const [sample] = takeSamples({ trusted, config, store: storeWith(healthEvent()), tips, now: NOW + 181 });

  assert.equal(sample.record.state, 'red');
  assert.equal(sample.record.event, null);
  assert.equal(sample.record.seq, null);
});

test('a lagging instance samples as red with the lag and the block_lag reason', () => {
  const store = storeWith(healthEvent({ lnd_block_height: ['971480'] }));

  const [sample] = takeSamples({ trusted, config, store, tips, now: NOW });

  assert.equal(sample.record.state, 'red');
  assert.equal(sample.record.lag, 5);
  assert.deepEqual(sample.record.reasons, ['block_lag']);
});

test('instances that are not monitored get no sample: no data is grey', () => {
  const samples = takeSamples({ trusted, config, store: storeWith(healthEvent()), tips, now: NOW });

  assert.deepEqual(samples.map((s) => s.pubkey), [PK]);
});

test('samples go to one file per instance per month, by UTC', () => {
  assert.equal(sampleFile(PK, 1792000000), `samples/${PK}/2026-10.ndjson`);
  assert.equal(sampleFile(PK, 1793491199), `samples/${PK}/2026-10.ndjson`);
  assert.equal(sampleFile(PK, 1793491200), `samples/${PK}/2026-11.ndjson`);
});

test('a month file is expired once its whole month is older than the retention', () => {
  // 2026-10-14, keeping 90 days: anything from July 16 on stays.
  const files = ['2026-04.ndjson', '2026-06.ndjson', '2026-07.ndjson', '2026-10.ndjson', 'notes.txt'];

  assert.deepEqual(expiredSampleFiles(files, NOW, 90), ['2026-04.ndjson', '2026-06.ndjson']);
});
