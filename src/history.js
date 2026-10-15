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

function validRecord(record) {
  return record !== null && typeof record === 'object'
    && typeof record.day === 'string' && DAY_KEY.test(record.day) && !Number.isNaN(dayStart(record.day))
    && FRACTIONS.every((key) => isFraction(record[key]))
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
    green: record.green,
    yellow: record.yellow,
    red: record.red,
    none: record.none,
    worst: record.worst,
    incidents: record.incidents.map(({ from, to, state, reason }) => ({ from, to, state, reason })),
  }));
}

/** The seconds a day's fractions are of: the whole day, or the part of today elapsed. */
function dayLength(day, now) {
  return Math.max(0, Math.min(DAY_SECONDS, now - dayStart(day)));
}

/** The last `count` UTC days up to the day of `now`, oldest first. */
export function shownDays(now, count) {
  const today = dayStart(dayKey(now));
  return Array.from({ length: count }, (_, i) => dayKey(today - (count - 1 - i) * DAY_SECONDS));
}

function barLabel(t, record, day, now) {
  if (!record) return `${day} · ${t.history.noData}`;
  const length = dayLength(day, now);
  const parts = ['green', 'yellow', 'red']
    .filter((state) => record[state] > 0)
    .map((state) => `${t.state[state]} ${duration(record[state] * length)}`);
  if (record.none > 0) parts.push(`${t.history.noData} ${duration(record.none * length)}`);
  const incidents = record.incidents.map((i) => `${reasonText(t, i)} ${duration(i.to - i.from)}`);
  return [day, t.history.day[record.worst], ...parts, ...incidents].join(' · ');
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
 * or null when there is no file.
 */
export function historyView({ t, days, daysShown, now }) {
  const byDay = new Map((days ?? []).map((record) => [record.day, record]));
  let up = 0;
  let covered = 0;
  const bars = shownDays(now, daysShown).map((day) => {
    const record = byDay.get(day) ?? null;
    if (record) {
      const length = dayLength(day, now);
      up += (record.green + record.yellow) * length;
      covered += (1 - record.none) * length;
    }
    return { day, state: record?.worst ?? 'grey', label: barLabel(t, record, day, now) };
  });
  return { bars, uptime: covered > 0 ? t.history.uptime(uptimePercent(up / covered)) : null };
}

/**
 * The latest red and yellow incidents across `rows` (`{ name, days }` per
 * instance), newest first, at most `limit`, each with the words the page
 * shows. Only incidents within the last `daysShown` days count.
 */
export function incidentsView({ t, rows, daysShown, now, limit = INCIDENTS_SHOWN }) {
  const since = dayStart(shownDays(now, daysShown)[0]);
  return rows
    .flatMap(({ name, days }) => (days ?? []).flatMap((record) => record.incidents.map((incident) => ({ name, ...incident }))))
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
