// What the history sampler stores (SPEC § 3.5), as pure functions: whether
// a run is due, and the sample of each monitored instance from the same
// snapshot the page draws. The script in scripts/sample.mjs reads the relays
// and writes the files; nothing here touches the network or the disk.

import { snapshot } from './snapshot.js';

const DAY_SECONDS = 86400;
const MONTH_FILE = /^(\d{4})-(\d{2})\.ndjson$/;

/**
 * Whether an attempt at `now` should store samples, given the time of the
 * last stored sample (`null` when there is none) and the interval in
 * minutes. The whole interval must have passed: the loop tries every
 * minute, so any tolerance here would shorten every interval by that much.
 */
export function shouldSample(lastSampleAt, now, intervalMinutes) {
  if (lastSampleAt === null) return true;
  return now - lastSampleAt >= intervalMinutes * 60;
}

/**
 * The sample record of one instance at `now`: its light, and the event it
 * was drawn from. A not-reporting sample names no event, even when a stale
 * one is still in the store: it was not what decided the colour.
 */
export function sampleRecord({ light, report, now }) {
  const reporting = report !== null && !light.reasons.includes('not_reporting');
  return {
    t: now,
    state: light.state,
    status: light.status,
    lag: light.lag,
    reasons: light.reasons,
    event: reporting ? report.id : null,
    seq: reporting ? report.seq : null,
  };
}

/**
 * The samples of a run at `now`: one per monitored instance, as
 * `{ pubkey, record, source }` with the snapshot entry it came from. An
 * instance that is not monitored gets none: no sample is no data, grey.
 */
export function takeSamples({ trusted, config, store, tips, now }) {
  return snapshot({ trusted, config, store, tips, now })
    .filter(({ entry }) => entry.monitored)
    .map((source) => ({ pubkey: source.entry.pubkey, record: sampleRecord({ light: source.light, report: source.report, now }), source }));
}

/** The file, relative to the data directory, that a sample at `t` belongs in. */
export function sampleFile(pubkey, t) {
  return `samples/${pubkey}/${new Date(t * 1000).toISOString().slice(0, 7)}.ndjson`;
}

/**
 * The month files among `names` whose whole month ended more than
 * `retentionDays` before `now`. Other names are left alone.
 */
export function expiredSampleFiles(names, now, retentionDays) {
  const cutoff = now - retentionDays * DAY_SECONDS;
  return names.filter((name) => {
    const match = MONTH_FILE.exec(name);
    if (!match) return false;
    const monthEnd = Date.UTC(Number(match[1]), Number(match[2]), 1) / 1000;
    return monthEnd <= cutoff;
  });
}
