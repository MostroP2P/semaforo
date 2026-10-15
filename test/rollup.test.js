import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coveredSpans, dayRecord, rollup, dayKey, dayStart } from '../src/rollup.js';

const config = { sampleIntervalMinutes: 10, dayStateThresholdMinutes: 15, minDayCoverage: 0.5, dailyRollupRetentionDays: 400 };
// 2026-10-14 00:00 UTC.
const DAY = dayStart('2026-10-14');
const MIN = 60;
const CAP = 15 * MIN;
const sample = (t, state, reasons = [], extra = {}) => ({ t, state, status: state === 'green' ? 'ok' : 'down', lag: 0, reasons, event: null, seq: null, ...extra });

/** Samples every `step` seconds from `from`, `count` of them, all `state`. */
function series(from, count, state, step = 10 * MIN, reasons = []) {
  return Array.from({ length: count }, (_, i) => sample(from + i * step, state, reasons));
}

test('a sample covers the time to the next one, capped at one and a half intervals', () => {
  const samples = [sample(DAY, 'green'), sample(DAY + 10 * MIN, 'green'), sample(DAY + 60 * MIN, 'red', ['payouts'])];

  const spans = coveredSpans(samples, CAP, DAY + 2 * 3600);

  assert.deepEqual(spans.map((s) => [s.from, s.to, s.state]), [
    [DAY, DAY + 10 * MIN, 'green'],
    [DAY + 10 * MIN, DAY + 25 * MIN, 'green'],
    [DAY + 60 * MIN, DAY + 75 * MIN, 'red'],
  ]);
});

test('the last sample never covers past now', () => {
  const spans = coveredSpans([sample(DAY, 'green')], CAP, DAY + 2 * MIN);

  assert.deepEqual(spans.map((s) => [s.from, s.to]), [[DAY, DAY + 2 * MIN]]);
});

test('samples are read in time order whatever order they came in', () => {
  const spans = coveredSpans([sample(DAY + 10 * MIN, 'red'), sample(DAY, 'green')], CAP, DAY + 3600);

  assert.deepEqual(spans.map((s) => s.from), [DAY, DAY + 10 * MIN]);
});

test('a fully sampled green day is green with every fraction on green', () => {
  // Arrange: 144 samples, one every 10 minutes.
  const samples = series(DAY, 144, 'green');

  // Act
  const record = dayRecord({ samples, day: '2026-10-14', now: DAY + 2 * 86400, config });

  // Assert
  assert.deepEqual(record, { day: '2026-10-14', green: 1, yellow: 0, red: 0, none: 0, worst: 'green', incidents: [] });
});

test('a day sampled less than half is grey, even when every sample is red', () => {
  const samples = series(DAY, 60, 'red', 10 * MIN, ['lnd_sync']);

  const record = dayRecord({ samples, day: '2026-10-14', now: DAY + 2 * 86400, config });

  assert.equal(record.worst, 'grey');
  // 59 samples cover 10 minutes each and the last one 15: 605 of 1440 minutes.
  assert.equal(record.red, 0.4201);
  assert.equal(record.none, 0.5799);
  assert.equal(record.incidents.length, 1);
});

test('a red sample counts for the time to the next sample: ten minutes is not a red day, fifteen is', () => {
  const red = sample(DAY + 1000 * MIN, 'red', ['payouts']);
  const tenMinutes = [...series(DAY, 100, 'green'), red, ...series(DAY + 1010 * MIN, 43, 'green')];
  const fifteenMinutes = [...series(DAY, 100, 'green'), red, ...series(DAY + 1015 * MIN, 43, 'green')];

  const short = dayRecord({ samples: tenMinutes, day: '2026-10-14', now: DAY + 2 * 86400, config });
  const long = dayRecord({ samples: fifteenMinutes, day: '2026-10-14', now: DAY + 2 * 86400, config });

  assert.equal(short.worst, 'green');
  assert.deepEqual(short.incidents, [{ from: DAY + 1000 * MIN, to: DAY + 1010 * MIN, state: 'red', reason: 'payouts' }]);
  assert.equal(long.worst, 'red');
  assert.deepEqual(long.incidents, [{ from: DAY + 1000 * MIN, to: DAY + 1015 * MIN, state: 'red', reason: 'payouts' }]);
});

test('fourteen minutes of yellow do not make a yellow day; fifteen do', () => {
  const short = [sample(DAY, 'yellow', ['unverified']), ...series(DAY + 14 * MIN, 143, 'green')];
  const long = [sample(DAY, 'yellow', ['unverified']), ...series(DAY + 15 * MIN, 143, 'green')];

  assert.equal(dayRecord({ samples: short, day: '2026-10-14', now: DAY + 2 * 86400, config }).worst, 'green');
  assert.equal(dayRecord({ samples: long, day: '2026-10-14', now: DAY + 2 * 86400, config }).worst, 'yellow');
});

test('red beats yellow for the day, whichever came first', () => {
  const samples = [...series(DAY, 72, 'yellow', 10 * MIN, ['maintenance']), ...series(DAY + 720 * MIN, 72, 'red', 10 * MIN, ['lnd_sync'])];

  const record = dayRecord({ samples, day: '2026-10-14', now: DAY + 2 * 86400, config });

  assert.equal(record.worst, 'red');
  assert.equal(record.yellow, 0.5);
  assert.equal(record.red, 0.5);
});

test('today is judged on the part of the day elapsed so far', () => {
  // Arrange: two hours into the day, sampled all along.
  const samples = series(DAY, 12, 'green');
  const now = DAY + 2 * 3600;

  // Act
  const record = dayRecord({ samples, day: '2026-10-14', now, config });

  // Assert
  assert.equal(record.worst, 'green');
  assert.equal(record.green, 1);
  assert.equal(record.none, 0);
});

test('a day in the future has no record', () => {
  assert.equal(dayRecord({ samples: [], day: '2026-10-15', now: DAY + 3600, config }), null);
});

test('a day with no sample at all is grey with everything on none', () => {
  const record = dayRecord({ samples: [], day: '2026-10-14', now: DAY + 2 * 86400, config });

  assert.deepEqual(record, { day: '2026-10-14', green: 0, yellow: 0, red: 0, none: 1, worst: 'grey', incidents: [] });
});

test('consecutive samples with the same state and first reason are one incident; a new reason starts another', () => {
  const samples = [
    ...series(DAY, 3, 'red', 10 * MIN, ['lnd_sync', 'payouts']),
    ...series(DAY + 30 * MIN, 2, 'red', 10 * MIN, ['payouts']),
    ...series(DAY + 50 * MIN, 94, 'green'),
  ];

  const { incidents } = dayRecord({ samples, day: '2026-10-14', now: DAY + 2 * 86400, config });

  assert.deepEqual(incidents, [
    { from: DAY, to: DAY + 30 * MIN, state: 'red', reason: 'lnd_sync' },
    { from: DAY + 30 * MIN, to: DAY + 50 * MIN, state: 'red', reason: 'payouts' },
  ]);
});

test('a gap in sampling splits an incident: the gap is no data, not more of the incident', () => {
  const samples = [sample(DAY, 'red', ['payouts']), sample(DAY + 40 * MIN, 'red', ['payouts']), ...series(DAY + 50 * MIN, 139, 'green')];

  const { incidents } = dayRecord({ samples, day: '2026-10-14', now: DAY + 2 * 86400, config });

  assert.deepEqual(incidents.map((i) => [i.from, i.to]), [[DAY, DAY + 15 * MIN], [DAY + 40 * MIN, DAY + 50 * MIN]]);
});

test('an incident across midnight is clipped to each day', () => {
  const samples = series(DAY - 30 * MIN, 6, 'red', 10 * MIN, ['database']);

  const before = dayRecord({ samples, day: '2026-10-13', now: DAY + 2 * 86400, config });
  const after = dayRecord({ samples, day: '2026-10-14', now: DAY + 2 * 86400, config });

  assert.deepEqual(before.incidents, [{ from: DAY - 30 * MIN, to: DAY, state: 'red', reason: 'database' }]);
  assert.deepEqual(after.incidents, [{ from: DAY, to: DAY + 35 * MIN, state: 'red', reason: 'database' }]);
});

test('a sample with a state the rollup does not know counts as no data', () => {
  const samples = [...series(DAY, 72, 'green'), ...series(DAY + 720 * MIN, 72, 'purple')];

  const record = dayRecord({ samples, day: '2026-10-14', now: DAY + 2 * 86400, config });

  assert.equal(record.none, 0.5);
  assert.equal(record.worst, 'green');
});

test('the rollup recomputes every day the samples cover, keeps older records, and drops those past retention', () => {
  // Arrange: samples on Oct 13 and 14; records already there for Oct 12 and for a day 500 days ago.
  const samples = [...series(DAY - 86400, 144, 'green'), ...series(DAY, 144, 'green')];
  const existing = [
    { day: dayKey(DAY - 500 * 86400), green: 1, yellow: 0, red: 0, none: 0, worst: 'green', incidents: [] },
    { day: '2026-10-12', green: 0, yellow: 0, red: 1, none: 0, worst: 'red', incidents: [] },
    { day: '2026-10-13', green: 0, yellow: 0, red: 1, none: 0, worst: 'red', incidents: [] },
  ];

  // Act
  const days = rollup({ samples, existing, now: DAY + 86400 + 3600, config });

  // Assert
  assert.deepEqual(days.map((d) => [d.day, d.worst]), [['2026-10-12', 'red'], ['2026-10-13', 'green'], ['2026-10-14', 'green'], ['2026-10-15', 'grey']]);
});

test('with no samples yet, the rollup keeps what it had', () => {
  const existing = [{ day: '2026-10-12', green: 1, yellow: 0, red: 0, none: 0, worst: 'green', incidents: [] }];

  assert.deepEqual(rollup({ samples: [], existing, now: DAY + 3600, config }), existing);
  assert.deepEqual(rollup({ samples: [], existing: [], now: DAY + 3600, config }), []);
});

test('days are keyed by UTC date', () => {
  assert.equal(dayKey(DAY), '2026-10-14');
  assert.equal(dayKey(DAY - 1), '2026-10-13');
  assert.equal(dayStart('2026-10-14'), 1791936000);
});
