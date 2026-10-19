// The block explorers the cross-check asks for the tip height (SPEC § 3.3).
// `fetchImpl` is the browser's fetch, passed in so the tests need no network.
// No cookies or credentials are sent: an explorer learns nothing but that a
// page asked for its tip.

const INTEGER = /^(0|[1-9][0-9]*)$/;
/** Longest answer read as a height; a tip has a handful of digits. */
const MAX_BODY_LENGTH = 32;

/**
 * The tip height `url` answers with, as plain text. Rejects on an HTTP
 * error, an answer that is not a plain integer, or no answer within
 * `timeoutMs`.
 */
export async function fetchTip(url, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs} ms`)), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      // A redirect would send the page to a host nobody configured.
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
    const body = (await response.text()).trim();
    const height = Number(body);
    if (body.length > MAX_BODY_LENGTH || !INTEGER.test(body) || !Number.isSafeInteger(height)) {
      throw new Error(`not a block height from ${url}`);
    }
    return height;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * How many earlier heights a tip remembers. A report is fresh for three
 * intervals, three minutes at the default one, and an explorer moves about
 * once a block, so a handful covers it; a report signed before the oldest
 * height kept is held to the tip in full, never excused.
 */
export const MAX_EARLIER_RUNS = 8;

/**
 * A new map of tips: each explorer that answered with its height and `now`,
 * each one that failed with the tip it had, which then ages out on its own.
 * A tip also keeps `since`, when the explorer started answering its height,
 * and `earlier`, the heights it answered before, oldest first, each as
 * `{ height, since, until }` (when the reader first and last saw it), so a
 * node is held only to the blocks the reader had seen when it signed (SPEC
 * § 3.3). `since` is null for a height found on the first look: nobody knows
 * how long it had been there.
 */
export async function refreshTips({ urls, tips, fetchImpl, now, timeoutMs }) {
  const results = await Promise.allSettled(urls.map((url) => fetchTip(url, fetchImpl, timeoutMs)));
  const next = new Map(tips);
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') next.set(urls[i], nextTip(tips.get(urls[i]), result.value, now));
  });
  return next;
}

function nextTip(last, height, now) {
  if (!last) return { height, at: now, since: null, earlier: [] };
  const since = last.since ?? null;
  const earlier = last.earlier ?? [];
  if (last.height === height) return { height, at: now, since, earlier };
  const ended = { height: last.height, since, until: last.at };
  return { height, at: now, since: now, earlier: [...earlier, ended].slice(-MAX_EARLIER_RUNS) };
}

const isHeight = (value) => Number.isSafeInteger(value) && value >= 0;
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isSince = (value) => value === null || Number.isSafeInteger(value);

function isRun(run) {
  return isRecord(run) && isHeight(run.height) && isSince(run.since) && Number.isSafeInteger(run.until);
}

function isTip(tip) {
  if (!isRecord(tip) || !isHeight(tip.height) || !Number.isSafeInteger(tip.at) || !isSince(tip.since)) return false;
  if (!Array.isArray(tip.earlier) || tip.earlier.length > MAX_EARLIER_RUNS || !tip.earlier.every(isRun)) return false;
  // A height found on the first look has nothing before it.
  return tip.since !== null || tip.earlier.length === 0;
}

/**
 * The tips kept by an earlier pass (`[url, tip]` pairs), for `urls` only.
 * Anything malformed is left out, so the next look at that explorer is a
 * first look, which excuses nothing.
 */
export function parseTips(raw, urls) {
  if (!Array.isArray(raw)) return new Map();
  const kept = raw
    .filter((entry) => Array.isArray(entry) && entry.length === 2 && urls.includes(entry[0]) && isTip(entry[1]))
    .map(([url, tip]) => [url, {
      height: tip.height,
      at: tip.at,
      since: tip.since,
      earlier: tip.earlier.map((run) => ({ height: run.height, since: run.since, until: run.until })),
    }]);
  return new Map(kept);
}

/** The explorer URLs of the networks some trusted instance is listed on. */
export function explorerUrls(explorers, trusted) {
  const networks = new Set(trusted.instances.map((entry) => entry.network));
  return [...networks].flatMap((network) => explorers.get(network) ?? []);
}
