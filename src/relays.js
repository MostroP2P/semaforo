// The connections to the relays. Each relay gets the same subscription and
// is retried, more slowly each time, when it can't connect or drops. The
// page is reachable while any relay has answered the subscription (EOSE)
// and is still connected. `connect` opens a relay (nostr-tools'
// `Relay.connect` in the page); `timers` is injectable for the tests.

/** Seconds the page waits for a first answer before it says it can't verify. */
export const CONNECT_TIMEOUT_SECONDS = 10;
const FIRST_RETRY_MS = 5000;
const MAX_RETRY_MS = 60000;
/** A connection up this long earns a fresh backoff when it drops. */
const STABLE_MS = 60000;
const MINUTE_MS = 60000;
// nostr-tools calls oneose by itself after ~4.4 s without an EOSE. A relay
// that connects and never answers must not count as reachable, so that
// timer is set to the longest delay a browser timer takes.
const NO_EOSE_TIMEOUT_MS = 2 ** 31 - 1;
/**
 * How long a connected relay has to answer the subscription. One that
 * doesn't is dropped and retried, so no subscription without an EOSE lives
 * long enough to reach the library's timer above.
 */
export const EOSE_WAIT_MS = 30000;
/**
 * Events a relay may send in a minute before it is dropped. The trusted
 * keys publish a few dozen a minute; a flood would freeze the page.
 */
export const MAX_EVENTS_PER_MINUTE = 600;

/** The wait before retry number `attempt` (from 0): 5 s, doubling, up to 60 s. */
export function retryDelay(attempt) {
  return Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** attempt);
}

/**
 * `reachable` while any relay is live; before `timeoutSeconds` have passed
 * since `startedAt` with none live yet, `connecting`; then `unreachable`.
 */
export function relayState(statuses, startedAt, now, timeoutSeconds) {
  if (statuses.includes('live')) return 'reachable';
  return now - startedAt < timeoutSeconds ? 'connecting' : 'unreachable';
}

/**
 * A pool over `urls`. `onEvent(event, url)` gets every event as it arrives;
 * `onStatus(statuses)` gets the map of url to `connecting`, `live` or `down`
 * each time one changes. A relay that sends more than `maxEventsPerMinute`
 * is dropped and retried later. Returns `{ start, stop, status }`.
 */
export function createRelayPool({
  urls, filters, connect, onEvent, onStatus, timers = globalThis, clock = Date.now, maxEventsPerMinute = MAX_EVENTS_PER_MINUTE,
}) {
  const status = new Map(urls.map((url) => [url, 'connecting']));
  const open = new Map();
  const attempts = new Map(urls.map((url) => [url, 0]));
  const retries = new Map();
  const liveSince = new Map();
  const counts = new Map();
  const eoseWaits = new Map();
  let stopped = false;

  const set = (url, value) => {
    status.set(url, value);
    onStatus(new Map(status));
  };

  const retry = (url) => {
    if (stopped || retries.has(url)) return;
    const attempt = attempts.get(url);
    attempts.set(url, attempt + 1);
    retries.set(url, timers.setTimeout(() => {
      retries.delete(url);
      open_(url);
    }, retryDelay(attempt)));
  };

  // `relay` is the connection that closed, or null when none opened. A late
  // close from an older connection must not touch the current one.
  const stopWaiting = (url) => {
    if (eoseWaits.has(url)) timers.clearTimeout(eoseWaits.get(url));
    eoseWaits.delete(url);
  };

  const dropped = (url, relay) => {
    if (relay && open.get(url) !== relay) return;
    open.delete(url);
    stopWaiting(url);
    // Only a connection that held earns a fresh backoff; one that answers
    // and drops at once keeps slowing down.
    const since = liveSince.get(url);
    if (since !== undefined && clock() - since >= STABLE_MS) attempts.set(url, 0);
    liveSince.delete(url);
    if (stopped) return;
    set(url, 'down');
    retry(url);
  };

  /** Whether `url` is still within its allowance of events this minute. */
  const withinLimit = (url) => {
    const now = clock();
    const window = counts.get(url);
    if (!window || now - window.start >= MINUTE_MS) {
      counts.set(url, { start: now, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= maxEventsPerMinute;
  };

  const subscribe = (url, relay) => {
    open.set(url, relay);
    relay.onclose = () => dropped(url, relay);
    relay.subscribe(filters, {
      onevent: (event) => {
        if (open.get(url) !== relay) return;
        if (withinLimit(url)) onEvent(event, url);
        else relay.close();
      },
      oneose: () => {
        stopWaiting(url);
        liveSince.set(url, clock());
        set(url, 'live');
      },
      // The relay ended the subscription (auth, rate limit...): start over.
      onclose: () => relay.close(),
      eoseTimeout: NO_EOSE_TIMEOUT_MS,
    });
    eoseWaits.set(url, timers.setTimeout(() => {
      if (open.get(url) === relay) relay.close();
    }, EOSE_WAIT_MS));
  };

  function open_(url) {
    set(url, 'connecting');
    connect(url).then(
      (relay) => {
        if (stopped) relay.close();
        else subscribe(url, relay);
      },
      () => dropped(url, null),
    );
  }

  return {
    start() {
      for (const url of urls) open_(url);
    },
    stop() {
      stopped = true;
      for (const timer of retries.values()) timers.clearTimeout(timer);
      retries.clear();
      for (const url of [...eoseWaits.keys()]) stopWaiting(url);
      for (const relay of open.values()) relay.close();
      open.clear();
    },
    status: () => new Map(status),
  };
}
