import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDaily, historyView, incidentsView, shownDays } from '../src/history.js';
import { catalogue } from '../src/i18n.js';
import { dayStart } from '../src/rollup.js';

const t = catalogue('en');
// 2026-10-14 12:00 UTC.
const NOW = dayStart('2026-10-14') + 12 * 3600;
const DAY = 86400;
const COVERAGE = 0.5;
/** A record judged over its whole day, or up to now for today. */
const record = (day, overrides = {}) => ({
  day, until: Math.min(dayStart(day) + DAY, NOW), green: 1, yellow: 0, red: 0, none: 0, worst: 'green', incidents: [], ...overrides,
});

test('the shown days end today and run oldest first', () => {
  assert.deepEqual(shownDays(NOW, 3), ['2026-10-12', '2026-10-13', '2026-10-14']);
});

test('a file the rollup wrote parses to its records and nothing else', () => {
  const raw = [{ ...record('2026-10-13'), extra: 'ignored', incidents: [{ from: 1, to: 2, state: 'red', reason: 'payouts', more: 1 }] }];

  const days = parseDaily(raw);

  assert.deepEqual(days, [{ ...record('2026-10-13'), incidents: [{ from: 1, to: 2, state: 'red', reason: 'payouts' }] }]);
});

test('a file that is not a list of valid records is refused whole', () => {
  assert.equal(parseDaily({}), null);
  assert.equal(parseDaily([record('2026-10-13', { worst: 'purple' })]), null);
  assert.equal(parseDaily([record('2026-10-13', { green: 1.2 })]), null);
  assert.equal(parseDaily([record('13-10-2026')]), null);
  assert.equal(parseDaily([record('2026-13-40')]), null);
  assert.equal(parseDaily([record('2026-10-13', { incidents: [{ from: 2, to: 1, state: 'red', reason: null }] })]), null);
  assert.equal(parseDaily([record('2026-10-13', { incidents: [{ from: 1, to: 2, state: 'green', reason: null }] })]), null);
  assert.equal(parseDaily([record('2026-10-13', { green: 0.5, none: 0.4 })]), null);
  assert.equal(parseDaily([record('2026-10-13', { green: 0.6, none: 0.5 })]), null);
  assert.equal(parseDaily([record('2026-10-13', { until: undefined })]), null);
  assert.equal(parseDaily([record('2026-10-13', { until: dayStart('2026-10-13') })]), null);
  assert.equal(parseDaily([record('2026-10-13', { until: dayStart('2026-10-13') + DAY + 1 })]), null);
  assert.equal(parseDaily([null]), null);
});

test('each shown day becomes a bar with its colour; days without a record are grey, no data', () => {
  // Arrange
  const days = [record('2026-10-13', { worst: 'red', green: 0.5, red: 0.5 }), record('2026-10-14')];

  // Act
  const { bars } = historyView({ t, days, daysShown: 3, minDayCoverage: COVERAGE, now: NOW });

  // Assert
  assert.deepEqual(bars.map((b) => [b.day, b.state]), [['2026-10-12', 'grey'], ['2026-10-13', 'red'], ['2026-10-14', 'green']]);
  assert.equal(bars[0].label, '2026-10-12 · no data');
  assert.equal(bars[1].label, '2026-10-13 · Down · Operational 12 h 0 min · Down 12 h 0 min');
});

test("today's bar measures its times over the part of the day elapsed", () => {
  const days = [record('2026-10-14', { green: 0.5, none: 0.5, worst: 'green' })];

  const { bars } = historyView({ t, days, daysShown: 1, minDayCoverage: COVERAGE, now: NOW });

  assert.equal(bars[0].label, '2026-10-14 · Operational · Operational 6 h 0 min · no data 6 h 0 min');
});

test('a bar names its incidents with their reason and length', () => {
  const from = dayStart('2026-10-13') + 3600;
  const days = [record('2026-10-13', { worst: 'red', green: 0.9, red: 0.1, incidents: [{ from, to: from + 76320, state: 'red', reason: 'lnd_sync' }] })];

  const { bars } = historyView({ t, days, daysShown: 2, minDayCoverage: COVERAGE, now: NOW });

  assert.match(bars[0].label, /LND not synced 21 h 12 min$/);
});

test('the uptime is the time not red over the time with data, and grey time counts for nothing', () => {
  // Arrange: one day half red, one day fully green, one day with no data at all, one day half unsampled.
  const days = [
    record('2026-10-10', { green: 0.5, red: 0.5, worst: 'red' }),
    record('2026-10-11'),
    record('2026-10-12', { green: 0, none: 1, worst: 'grey' }),
    record('2026-10-13', { green: 0.5, none: 0.5, worst: 'green' }),
  ];

  // Act
  const { uptime } = historyView({ t, days, daysShown: 5, minDayCoverage: COVERAGE, now: dayStart('2026-10-14') });

  // Assert: 12 + 24 + 12 hours up of the 24 + 24 + 12 with data.
  assert.equal(uptime, '80 % uptime');
});

test('the uptime keeps two decimals and drops trailing zeros', () => {
  const days = [record('2026-10-13', { green: 0.8705, red: 0.1295, worst: 'red' })];

  assert.equal(historyView({ t, days, daysShown: 2, minDayCoverage: COVERAGE, now: NOW }).uptime, '87.05 % uptime');
});

test('yellow time counts as up', () => {
  const days = [record('2026-10-13', { green: 0.5, yellow: 0.5, worst: 'yellow' })];

  assert.equal(historyView({ t, days, daysShown: 2, minDayCoverage: COVERAGE, now: NOW }).uptime, '100 % uptime');
});

test('with no data at all there is no uptime, and the bars are all grey', () => {
  const view = historyView({ t, days: null, daysShown: 2, minDayCoverage: COVERAGE, now: NOW });

  assert.equal(view.uptime, null);
  assert.deepEqual(view.bars.map((b) => b.state), ['grey', 'grey']);
});

test('the incident list has the latest red and yellow periods across instances, newest first', () => {
  // Arrange
  const day = dayStart('2026-10-13');
  const rows = [
    { key: 'a', name: 'Mostro', days: [record('2026-10-13', { incidents: [{ from: day + 100, to: day + 700, state: 'red', reason: 'payouts' }] })] },
    { key: 'b', name: 'Other', days: [record('2026-10-13', { incidents: [{ from: day + 200, to: day + 500, state: 'yellow', reason: null }] })] },
    { key: 'c', name: 'Quiet', days: null },
  ];

  // Act
  const incidents = incidentsView({ t, rows, daysShown: 2, now: NOW });

  // Assert
  assert.deepEqual(incidents, [
    { name: 'Other', state: 'yellow', word: 'Degraded', reason: null, from: '2026-10-13 00:03 UTC', length: '5 min' },
    { name: 'Mostro', state: 'red', word: 'Down', reason: 'Payouts failing', from: '2026-10-13 00:01 UTC', length: '10 min' },
  ]);
});

test('incidents before the shown days are left out, and the list is capped', () => {
  const old = dayStart('2026-10-01');
  const recent = dayStart('2026-10-14');
  const rows = [{
    key: 'a',
    name: 'Mostro',
    days: [
      record('2026-10-01', { incidents: [{ from: old, to: old + 60, state: 'red', reason: 'payouts' }] }),
      record('2026-10-14', { incidents: Array.from({ length: 12 }, (_, i) => ({ from: recent + i * 100, to: recent + i * 100 + 50, state: 'red', reason: 'database' })) }),
    ],
  }];

  const incidents = incidentsView({ t, rows, daysShown: 7, now: NOW });

  assert.equal(incidents.length, 10);
  assert.equal(incidents[0].from, '2026-10-14 00:18 UTC');
});

test('an unknown reason code leaves only the state word, which every incident carries', () => {
  const day = dayStart('2026-10-13');
  const rows = [{ key: 'a', name: 'Mostro', days: [record('2026-10-13', { incidents: [{ from: day, to: day + 60, state: 'red', reason: 'something_new' }] })] }];

  const [incident] = incidentsView({ t, rows, daysShown: 2, now: NOW });

  assert.equal(incident.word, 'Down');
  assert.equal(incident.reason, null);
});

test("today's record judged hours ago counts the time since as no data, and goes grey when that is most of the day", () => {
  // Arrange: the sampler last ran at 04:00; it is noon, and the record was all green until then.
  const days = [record('2026-10-14', { until: dayStart('2026-10-14') + 4 * 3600 })];

  // Act
  const { bars, uptime } = historyView({ t, days, daysShown: 1, minDayCoverage: COVERAGE, now: NOW });

  // Assert
  assert.equal(bars[0].state, 'grey');
  assert.equal(bars[0].label, '2026-10-14 · No data · Operational 4 h 0 min · no data 8 h 0 min');
  assert.equal(uptime, '100 % uptime');
});

test("today's record judged recently keeps its colour while the day is still mostly covered", () => {
  const days = [record('2026-10-14', { until: dayStart('2026-10-14') + 11 * 3600 })];

  const { bars } = historyView({ t, days, daysShown: 1, minDayCoverage: COVERAGE, now: NOW });

  assert.equal(bars[0].state, 'green');
  assert.equal(bars[0].label, '2026-10-14 · Operational · Operational 11 h 0 min · no data 1 h 0 min');
});

test('a past day whose record was never finalised is judged on the whole day, not the part it saw', () => {
  const days = [record('2026-10-13', { until: dayStart('2026-10-13') + 3600 })];

  const { bars } = historyView({ t, days, daysShown: 2, minDayCoverage: COVERAGE, now: NOW });

  assert.equal(bars[0].state, 'grey');
  assert.equal(bars[0].label, '2026-10-13 · No data · Operational 1 h 0 min · no data 23 h 0 min');
});

test('an outage across midnight is one incident in the list, not one fragment per day', () => {
  // Arrange: red from 23:30 on the 12th to 00:30 on the 13th, clipped by the rollup to each day.
  const midnight = dayStart('2026-10-13');
  const rows = [{
    key: 'a',
    name: 'Mostro',
    days: [
      record('2026-10-12', { worst: 'red', incidents: [{ from: midnight - 1800, to: midnight, state: 'red', reason: 'lnd_sync' }] }),
      record('2026-10-13', { worst: 'red', incidents: [{ from: midnight, to: midnight + 1800, state: 'red', reason: 'lnd_sync' }] }),
    ],
  }];

  // Act
  const incidents = incidentsView({ t, rows, daysShown: 3, now: NOW });

  // Assert
  assert.deepEqual(incidents, [{ name: 'Mostro', state: 'red', word: 'Down', reason: 'LND not synced', from: '2026-10-12 23:30 UTC', length: '1 h 0 min' }]);
});

test('fragments that meet at midnight with a different reason, or on another instance, stay separate', () => {
  const midnight = dayStart('2026-10-13');
  const rows = [
    { key: 'a', name: 'Mostro', days: [
      record('2026-10-12', { incidents: [{ from: midnight - 60, to: midnight, state: 'red', reason: 'lnd_sync' }] }),
      record('2026-10-13', { incidents: [{ from: midnight, to: midnight + 60, state: 'red', reason: 'payouts' }] }),
    ] },
    { key: 'b', name: 'Other', days: [record('2026-10-13', { incidents: [{ from: midnight, to: midnight + 60, state: 'red', reason: 'lnd_sync' }] })] },
  ];

  const incidents = incidentsView({ t, rows, daysShown: 3, now: NOW });

  assert.equal(incidents.length, 3);
});

test('fractions rounded to four decimals each still add up close enough to one', () => {
  // Arrange: the rollup rounds each of four fractions on its own, so the sum can be off by up to 0.0002.
  const days = [record('2026-10-13', { green: 0.3333, yellow: 0.3333, red: 0.3333, none: 0.0002, worst: 'red' })];

  assert.notEqual(parseDaily(days), null);
  assert.notEqual(parseDaily([record('2026-10-13', { green: 0.3334, yellow: 0.3334, red: 0.3334, none: 0 })]), null);
});

test('two instances that share a name are never joined into one incident', () => {
  // Arrange: one outage ends at midnight on one instance, another starts then on the other.
  const midnight = dayStart('2026-10-13');
  const rows = [
    { key: 'a', name: 'Mostro', days: [record('2026-10-12', { incidents: [{ from: midnight - 600, to: midnight, state: 'red', reason: 'lnd_sync' }] })] },
    { key: 'b', name: 'Mostro', days: [record('2026-10-13', { incidents: [{ from: midnight, to: midnight + 600, state: 'red', reason: 'lnd_sync' }] })] },
  ];

  // Act
  const incidents = incidentsView({ t, rows, daysShown: 3, now: NOW });

  // Assert
  assert.deepEqual(incidents.map((i) => i.length), ['10 min', '10 min']);
});

test('the uptime never passes 100 % when the rounded fractions add up to a little over one', () => {
  // Arrange: fractions the rollup can write, each rounded on its own, summing to 1.0001.
  const days = [record('2026-10-13', { green: 0.0278, yellow: 0.0417, red: 0, none: 0.9306, worst: 'grey' })];

  // Act
  const { uptime } = historyView({ t, days: parseDaily(days), daysShown: 2, minDayCoverage: COVERAGE, now: NOW });

  // Assert
  assert.equal(uptime, '100 % uptime');
});
