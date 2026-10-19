// The independent block-height cross-check (SPEC § 3.3). A node on a stale
// chain does not necessarily know it is stale, so a Lightning instance's
// reported height is compared with a reference it does not control: the
// highest fresh explorer tip for its trusted network, or, failing that, the
// median height of at least three other trusted instances on that network.
// Pure functions: the page and the sampler must pick the same reference.

import { isFresh } from './reader.js';

/** Fewest peer heights the median fallback may use. */
export const MIN_PEERS = 3;

/**
 * Whether `tip` is a usable reference at `now`: a safe integer height,
 * fetched no more than `maxAgeSeconds` ago and not dated in the future.
 */
function isFreshTip(tip, now, maxAgeSeconds) {
  return Boolean(tip)
    && Number.isSafeInteger(tip.height)
    && tip.height >= 0
    && tip.at <= now
    && now - tip.at <= maxAgeSeconds;
}

/**
 * The height `tip` holds a node to for a report signed at `signedAt`: the
 * height the reader knew then, so that blocks it first saw after the node
 * signed are not held against it. That is the last of the tip's runs (its
 * `earlier` heights, then its own) first seen by `signedAt`, a height found
 * on the first look counting as seen from the start, and never more than
 * the tip. Nothing is excused when the reader lost track of the explorer
 * for longer than `maxAgeSeconds` right after that run, or when the report
 * is older than every height it remembers: nobody knows when those blocks
 * appeared.
 */
function heightFor(tip, signedAt, maxAgeSeconds) {
  const since = tip.since ?? null;
  if (since === null || signedAt >= since) return tip.height;
  const runs = [...tip.earlier, { height: tip.height, since, until: tip.at }];
  const known = runs.findLastIndex((run) => run.since === null || run.since <= signedAt);
  if (known === -1) return tip.height;
  if (runs[known + 1].since - runs[known].until > maxAgeSeconds) return tip.height;
  return Math.min(tip.height, runs[known].height);
}

/**
 * The highest fresh tip among `urls`, as `{ height, source }`, or null. The
 * highest, so a lagging explorer can never hide a lagging node. `tips` maps
 * an explorer URL to `{ height, at, since, earlier }` (explorers.js); each
 * counts only the blocks seen by `signedAt`, when the report was signed.
 */
export function explorerReference(urls, tips, now, maxAgeSeconds, signedAt = now) {
  let best = null;
  for (const url of urls) {
    const tip = tips.get(url);
    if (!isFreshTip(tip, now, maxAgeSeconds)) continue;
    const height = heightFor(tip, signedAt, maxAgeSeconds);
    if (!best || height > best.height) best = { height, source: url };
  }
  return best;
}

/**
 * The median of `heights`, rounded down between the two middle values, or
 * null with fewer than MIN_PEERS heights.
 */
export function peerMedian(heights) {
  if (heights.length < MIN_PEERS) return null;
  const sorted = [...heights].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return Math.floor((sorted[middle - 1] + sorted[middle]) / 2);
}

/**
 * The heights the median fallback may use for `pubkey`: those of the other
 * monitored instances listed on `network` whose fresh health event is from a
 * Lightning node reporting that same network. Only trusted instances: anyone
 * can publish made-up heights, so a median of strangers could be steered.
 * `rows` are `{ entry, report }`, an entry of the trusted list and its
 * newest valid report, if any.
 */
export function peerHeights(pubkey, network, rows, now) {
  return rows
    .filter(({ entry, report }) => entry.pubkey !== pubkey
      && entry.monitored
      && entry.network === network
      && isFresh(report, now)
      && report.escrowMode === 'lightning'
      && report.network === network
      && report.blockHeight !== null)
    .map(({ report }) => report.blockHeight);
}

/**
 * The cross-check of one instance. `kind` is:
 * - `none`: a Cashu instance, which has no LND;
 * - `no_height`: a Lightning report with no block height (LND unreachable),
 *   which can't be compared and so is never verified;
 * - `exempt`: its trusted network has no explorer, such as regtest;
 * - `explorer` or `peers`: the reference `height` and the `lag` behind it;
 * - `unavailable`: no reference although the network has explorers.
 * `networkMismatch` says the reported `lnd_network` is not the trusted one; a
 * height with no network is a mismatch too, as it can't be placed on a chain.
 * The reference always comes from the trusted network, so a mismatch never
 * earns another network's exemption.
 */
export function crossCheck({ report, entry, explorers, tips, peers, now, tipMaxAgeSeconds }) {
  if (report.escrowMode !== 'lightning') return { kind: 'none', networkMismatch: false };
  if (report.blockHeight === null) {
    // Nothing to compare, but a network it does report must still match.
    return { kind: 'no_height', networkMismatch: report.network !== null && report.network !== entry.network };
  }
  const networkMismatch = report.network !== entry.network;
  const urls = explorers.get(entry.network) ?? [];
  if (urls.length === 0) return { kind: 'exempt', networkMismatch };
  const explorer = explorerReference(urls, tips, now, tipMaxAgeSeconds, report.createdAt);
  if (explorer) {
    return { kind: 'explorer', ...explorer, lag: explorer.height - report.blockHeight, networkMismatch };
  }
  const median = peerMedian(peers);
  if (median !== null) {
    return { kind: 'peers', height: median, count: peers.length, lag: median - report.blockHeight, networkMismatch };
  }
  return { kind: 'unavailable', networkMismatch };
}
