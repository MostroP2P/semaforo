// The traffic light of one instance (SPEC § 5.1) and the liveness of a
// watcher (§ 3.4), as pure functions of the trusted entry, its newest valid
// report, the cross-check and the clock. The page draws what these return and
// the sampler stores it, so both always agree on a colour and its reasons.

import { CHECK_NAMES, deriveStatus, isFresh, worseStatus } from './reader.js';

const STATUS_RANK = { ok: 0, degraded: 1, down: 2 };

/** The cross-check kinds that compare against a reference height. */
const COMPARED = ['explorer', 'peers'];

/**
 * The reasons a report is anything but green, in one fixed order so the
 * same state always gives the same list: the checks in protocol order,
 * then the cross-check, then what the status alone says.
 */
function reasonsFor({ report, status, derived, lagRed, unverified, networkMismatch }) {
  const failing = new Set(report.checks.filter((c) => c.state !== 'ok').map((c) => c.name));
  const reasons = CHECK_NAMES.filter((name) => failing.has(name));
  if (lagRed) reasons.push('block_lag');
  if (unverified) reasons.push('unverified');
  if (networkMismatch) reasons.push('network_mismatch');
  // Published worse than the checks the reader knows explain: a later
  // protocol version may have added the check that drove it down.
  if (STATUS_RANK[report.status] > STATUS_RANK[derived]) reasons.push('reported_status');
  if (report.maintenance) reasons.push('maintenance');
  return reasons;
}

function colourFor({ status, lagRed, unverified, networkMismatch }) {
  if (status === 'down' || lagRed) return 'red';
  if (status === 'degraded' || unverified || networkMismatch) return 'yellow';
  return 'green';
}

/**
 * The state of one trusted instance at `now`:
 * - `state`: green, yellow, red or grey;
 * - `status`: the worse of the published and the derived status, or null
 *   when there is no fresh report;
 * - `reasons`: why it is not green, the codes of the history samples;
 * - `labels`: the qualifiers shown next to the state word;
 * - `lag`: blocks behind the reference, or null when nothing was compared.
 * `crossCheck` is the result of `crossCheck()` for this report.
 */
export function instanceLight({ entry, report, crossCheck, now, blockLagRed }) {
  if (!entry.monitored) return { state: 'grey', status: null, reasons: [], labels: [], lag: null };
  if (!isFresh(report, now)) {
    // No data is not good data: a monitored instance that can't prove it
    // is working is not safe to trade on.
    return { state: 'red', status: null, reasons: ['not_reporting'], labels: ['not_reporting'], lag: null };
  }
  const derived = deriveStatus(report.checks, report.maintenance);
  const status = worseStatus(report.status, derived);
  const lag = COMPARED.includes(crossCheck.kind) ? crossCheck.lag : null;
  const facts = {
    report,
    status,
    derived,
    lagRed: lag !== null && lag >= blockLagRed,
    unverified: crossCheck.kind === 'unavailable',
    networkMismatch: crossCheck.networkMismatch,
  };
  const labels = [];
  if (facts.unverified) labels.push('unverified');
  if (facts.networkMismatch) labels.push('network_mismatch');
  if (report.maintenance) labels.push('maintenance');
  return { state: colourFor(facts), status, reasons: reasonsFor(facts), labels, lag };
}

/**
 * A watcher is alive while its newest valid heartbeat is fresh; otherwise
 * it is not reporting. A relay serving an old heartbeat can't keep a
 * stopped watcher alive, because freshness is judged at `now`.
 */
export function watcherState(report, now) {
  return isFresh(report, now) ? 'alive' : 'not_reporting';
}
