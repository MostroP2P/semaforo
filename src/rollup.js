// The daily rollups (SPEC § 3.5 and § 5.3), as pure functions of the raw
// samples and the clock. A sample stands for the time to the next one,
// capped at one and a half sampling intervals; everything else is no data.
// Days are UTC. The sampler's rollup step and the tests are the only
// callers; the page reads the records this writes.

const DAY_SECONDS = 86400;
const STATES = ['green', 'yellow', 'red'];
/** Interval cap: a sample covers at most this many intervals (SPEC § 3.5). */
const CAP_INTERVALS = 1.5;
const DECIMALS = 4;

/** The UTC date of `t`, as "YYYY-MM-DD". */
export function dayKey(t) {
  return new Date(t * 1000).toISOString().slice(0, 10);
}

/** Unix seconds at the start of the UTC day `key`. */
export function dayStart(key) {
  return Date.parse(`${key}T00:00:00Z`) / 1000;
}

/**
 * The spans of time the samples cover, in time order: each from its own
 * timestamp to the next sample's, capped at `capSeconds` and never past
 * `now`. Each span carries the sample's state and reasons.
 */
export function coveredSpans(samples, capSeconds, now) {
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  return sorted.map((sample, i) => {
    const next = sorted[i + 1]?.t ?? Infinity;
    const to = Math.min(next, sample.t + capSeconds, now);
    return { from: sample.t, to, state: sample.state, reasons: sample.reasons };
  }).filter((span) => span.to > span.from);
}

/** A span clipped to [from, to), or null when nothing of it is inside. */
function clip(span, from, to) {
  const start = Math.max(span.from, from);
  const end = Math.min(span.to, to);
  return end > start ? { ...span, from: start, to: end } : null;
}

/**
 * The incidents among `spans` (already clipped to the day): maximal runs
 * of adjoining spans with the same non-green state and the same first
 * reason. A gap between two spans ends the run: the gap is no data.
 */
function incidentsOf(spans) {
  const incidents = [];
  let current = null;
  for (const span of spans) {
    const reason = span.reasons[0] ?? null;
    const continues = current && current.state === span.state && current.reason === reason && current.to === span.from;
    if (continues) {
      current = { ...current, to: span.to };
      incidents[incidents.length - 1] = current;
      continue;
    }
    current = null;
    if (span.state !== 'yellow' && span.state !== 'red') continue;
    current = { from: span.from, to: span.to, state: span.state, reason };
    incidents.push(current);
  }
  return incidents;
}

function colourOf(seconds, elapsed, config) {
  const covered = STATES.reduce((sum, state) => sum + seconds[state], 0);
  // Coverage first: a nearly unsampled day is never red or green.
  if (covered < config.minDayCoverage * elapsed) return 'grey';
  const threshold = config.dayStateThresholdMinutes * 60;
  if (seconds.red >= threshold) return 'red';
  if (seconds.yellow >= threshold) return 'yellow';
  return 'green';
}

const fraction = (part, whole) => Number((part / whole).toFixed(DECIMALS));

/**
 * The record of one UTC day from `samples` (any days, any order), judged
 * at `now`: the fraction of the day in each colour and with no data, the
 * day's colour, and its incidents. For today the fractions and the
 * coverage are of the part of the day elapsed so far. Null for a day that
 * has not started.
 */
export function dayRecord({ samples, day, now, config }) {
  const from = dayStart(day);
  const to = Math.min(from + DAY_SECONDS, now);
  const elapsed = to - from;
  if (elapsed <= 0) return null;
  const cap = config.sampleIntervalMinutes * 60 * CAP_INTERVALS;
  const spans = coveredSpans(samples, cap, now).map((span) => clip(span, from, to)).filter(Boolean);
  const seconds = { green: 0, yellow: 0, red: 0 };
  for (const span of spans) {
    if (span.state in seconds) seconds[span.state] += span.to - span.from;
  }
  const covered = STATES.reduce((sum, state) => sum + seconds[state], 0);
  return {
    day,
    green: fraction(seconds.green, elapsed),
    yellow: fraction(seconds.yellow, elapsed),
    red: fraction(seconds.red, elapsed),
    none: fraction(elapsed - covered, elapsed),
    worst: colourOf(seconds, elapsed, config),
    incidents: incidentsOf(spans),
  };
}

/**
 * The daily records after a run at `now`: every day from the oldest sample
 * to today recomputed from `samples`, the `existing` records kept for the
 * days before that (their samples are gone), and nothing older than
 * `daily_rollup_retention_days`. Sorted by day.
 */
export function rollup({ samples, existing, now, config }) {
  const oldest = existing.filter((record) => dayStart(record.day) > now - config.dailyRollupRetentionDays * DAY_SECONDS);
  if (samples.length === 0) return oldest;
  const first = Math.min(...samples.map((s) => s.t));
  const kept = oldest.filter((record) => dayStart(record.day) < dayStart(dayKey(first)));
  const recomputed = [];
  for (let start = dayStart(dayKey(first)); start < now; start += DAY_SECONDS) {
    const record = dayRecord({ samples, day: dayKey(start), now, config });
    if (record) recomputed.push(record);
  }
  return [...kept, ...recomputed];
}
