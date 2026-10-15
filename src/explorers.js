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
 * A new map of tips: each explorer that answered with its height and `now`,
 * each one that failed with the tip it had, which then ages out on its own.
 */
export async function refreshTips({ urls, tips, fetchImpl, now, timeoutMs }) {
  const results = await Promise.allSettled(urls.map((url) => fetchTip(url, fetchImpl, timeoutMs)));
  const next = new Map(tips);
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') next.set(urls[i], { height: result.value, at: now });
  });
  return next;
}

/** The explorer URLs of the networks some trusted instance is listed on. */
export function explorerUrls(explorers, trusted) {
  const networks = new Set(trusted.instances.map((entry) => entry.network));
  return [...networks].flatMap((network) => explorers.get(network) ?? []);
}
