// The history shown on the page (SPEC § 5.3): the daily records the sampler
// wrote, validated before use, as bars, an uptime and an incident list.
// Pure functions of the records, the catalogue and the clock; the live
// colour never comes from here.

import { dayKey, dayStart } from './rollup.js';
import { duration, utcTime } from './format.js';

const DAY_SECONDS = 86400;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const BAR_STATES = ['grey', 'green', 'yellow', 'red'];
const INCIDENT_STATES = ['yellow', 'red'];
const FRACTIONS = ['green', 'yellow', 'red', 'none'];
/** The rollup rounds each fraction to four decimals on its own, so four of them can miss 1 by this much. */
const FRACTION_SUM_TOLERANCE = 0.0002;
/** "99.54 %": the uptime with two decimals, as the spec shows it. */
const uptimePercent = (fraction) => `${(fraction * 100).toFixed(2).replace(/\.?0+$/, '')} %`;
/** The most recent incidents the page lists. */
export const INCIDENTS_SHOWN = 10;

const isFraction = (value) => typeof value === 'number' && value >= 0 && value <= 1;

function validIncident(incident) {
  return incident !== null && typeof incident === 'object'
    && Number.isSafeInteger(incident.from) && Number.isSafeInteger(incident.to) && incident.to > incident.from
    && INCIDENT_STATES.includes(incident.state)
    && (incident.reason === null || typeof incident.reason === 'string');
}

/** `until` is inside the day: after its start, no later than its end. */
function validUntil(record) {
  const start = dayStart(record.day);
  return Number.isSafeInteger(record.until) && record.until > start && record.until <= start + DAY_SECONDS;
}

function validRecord(record) {
  return record !== null && typeof record === 'object'
    && typeof record.day === 'string' && DAY_KEY.test(record.day) && !Number.isNaN(dayStart(record.day))
    && validUntil(record)
    && FRACTIONS.every((key) => isFraction(record[key]))
    && Math.abs(FRACTIONS.reduce((sum, key) => sum + record[key], 0) - 1) <= FRACTION_SUM_TOLERANCE + Number.EPSILON
    && BAR_STATES.includes(record.worst)
    && Array.isArray(record.incidents) && record.incidents.every(validIncident);
}

/**
 * The daily records of one instance from a fetched file, or null when the
 * file is not what the rollup writes. The file comes from this repository,
 * but it is still input: a bad record must not break the page.
 */
export function parseDaily(raw) {
  if (!Array.isArray(raw) || !raw.every(validRecord)) return null;
  return raw.map((record) => ({
    day: record.day,
    until: record.until,
    green: record.green,
    yellow: record.yellow,
    red: record.red,
    none: record.none,
    worst: record.worst,
    incidents: record.incidents.map(({ from, to, state, reason }) => ({ from, to, state, reason })),
  }));
}

/**
 * How a record stands at `now`: `seen` is the seconds its fractions are
 * of (up to `until`), `elapsed` the seconds of the day gone by, and
 * `covered` the seconds with data. A record judged early, by a sampler
 * that has not run since, covers nothing of the time after `until`: that
 * time is no data, so a stalled sampler shows as grey, never as a colour
 * it did not see.
 */
function standing(record, now) {
  const start = dayStart(record.day);
  const seen = record.until - start;
  const elapsed = Math.max(seen, Math.min(DAY_SECONDS, now - start));
  return { seen, elapsed, covered: (1 - record.none) * seen };
}

/** The record's colour at `now`: grey once the time without data outweighs the threshold. */
function stateAt(record, minDayCoverage, now) {
  const { elapsed, covered } = standing(record, now);
  return covered < minDayCoverage * elapsed ? 'grey' : record.worst;
}

/** The last `count` UTC days up to the day of `now`, oldest first. */
export function shownDays(now, count) {
  const today = dayStart(dayKey(now));
  return Array.from({ length: count }, (_, i) => dayKey(today - (count - 1 - i) * DAY_SECONDS));
}

function barLabel(t, record, day, state, now) {
  if (!record) return `${day} · ${t.history.noData}`;
  const { seen, elapsed, covered } = standing(record, now);
  const parts = ['green', 'yellow', 'red']
    .filter((key) => record[key] > 0)
    .map((key) => `${t.state[key]} ${duration(record[key] * seen)}`);
  if (elapsed - covered > 0) parts.push(`${t.history.noData} ${duration(elapsed - covered)}`);
  const incidents = record.incidents.map((i) => `${reasonText(t, i)} ${duration(i.to - i.from)}`);
  return [day, t.history.day[state], ...parts, ...incidents].join(' · ');
}

/** The words for an incident's reason, or its state when it named none. */
function reasonText(t, incident) {
  return (incident.reason && t.reason[incident.reason]) ?? t.state[incident.state];
}

/**
 * The bars and the uptime of one instance over the last `daysShown` days:
 * `bars` has one entry per day, oldest first, with its colour and the text
 * shown on hover; `uptime` is the time not red over the time with data, as
 * text, or null with no data at all. `days` is the result of parseDaily,
 * or null when there is no file. `minDayCoverage` is the spec's threshold
 * under which a day is grey, applied again here because the clock has
 * moved on since the record was written.
 */
export function historyView({ t, days, daysShown, minDayCoverage, now }) {
  const byDay = new Map((days ?? []).map((record) => [record.day, record]));
  let up = 0;
  let covered = 0;
  const bars = shownDays(now, daysShown).map((day) => {
    const record = byDay.get(day) ?? null;
    if (!record) return { day, state: 'grey', label: barLabel(t, null, day, 'grey', now) };
    const { seen } = standing(record, now);
    up += (record.green + record.yellow) * seen;
    covered += (1 - record.none) * seen;
    const state = stateAt(record, minDayCoverage, now);
    return { day, state, label: barLabel(t, record, day, state, now) };
  });
  return { bars, uptime: covered > 0 ? t.history.uptime(uptimePercent(up / covered)) : null };
}

/**
 * The incidents of `rows` with the fragments the rollup clipped at
 * midnight joined again: two of the same instance, state and reason, one
 * ending where the next begins, are one incident. Oldest first.
 */
function joinedIncidents(rows) {
  const fragments = rows
    .flatMap(({ name, days }) => (days ?? []).flatMap((record) => record.incidents.map((incident) => ({ name, ...incident }))))
    .sort((a, b) => a.name.localeCompare(b.name) || a.from - b.from);
  return fragments.reduce((joined, fragment) => {
    const last = joined[joined.length - 1];
    const continues = last && last.name === fragment.name && last.state === fragment.state
      && last.reason === fragment.reason && last.to === fragment.from;
    return continues ? [...joined.slice(0, -1), { ...last, to: fragment.to }] : [...joined, fragment];
  }, []);
}

/**
 * The latest red and yellow incidents across `rows` (`{ name, days }` per
 * instance), newest first, at most `limit`, each with the words the page
 * shows. Only incidents within the last `daysShown` days count.
 */
export function incidentsView({ t, rows, daysShown, now, limit = INCIDENTS_SHOWN }) {
  const since = dayStart(shownDays(now, daysShown)[0]);
  return joinedIncidents(rows)
    .filter((incident) => incident.to > since)
    .sort((a, b) => b.from - a.from || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((incident) => ({
      name: incident.name,
      state: incident.state,
      reason: reasonText(t, incident),
      from: utcTime(incident.from),
      length: duration(incident.to - incident.from),
    }));
}
