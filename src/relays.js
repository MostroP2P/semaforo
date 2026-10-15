// The connections to the relays. Each relay gets the same subscription and
// is retried, more slowly each time, when it can't connect or drops. The
// page is reachable while any relay has answered the subscription (EOSE)
// and is still connected. `connect` opens a relay (nostr-tools'
// `Relay.connect` in the page); `timers` is injectable for the tests.

/** Seconds the page waits for a first answer before it says it can't verify. */
export const CONNECT_TIMEOUT_SECONDS = 10;
const FIRST_RETRY_MS = 5000;
const MAX_RETRY_MS = 60000;

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
 * each time one changes. Returns `{ start, stop, status }`.
 */
export function createRelayPool({ urls, filters, connect, onEvent, onStatus, timers = globalThis }) {
  const status = new Map(urls.map((url) => [url, 'connecting']));
  const open = new Map();
  const attempts = new Map(urls.map((url) => [url, 0]));
  const retries = new Map();
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

  const dropped = (url) => {
    open.delete(url);
    if (stopped) return;
    set(url, 'down');
    retry(url);
  };

  const subscribe = (url, relay) => {
    open.set(url, relay);
    relay.onclose = () => dropped(url);
    relay.subscribe(filters, {
      onevent: (event) => onEvent(event, url),
      oneose: () => {
        attempts.set(url, 0);
        set(url, 'live');
      },
      // The relay ended the subscription (auth, rate limit...): start over.
      onclose: () => relay.close(),
    });
  };

  function open_(url) {
    set(url, 'connecting');
    connect(url).then(
      (relay) => {
        if (stopped) relay.close();
        else subscribe(url, relay);
      },
      () => dropped(url),
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
      for (const relay of open.values()) relay.close();
      open.clear();
    },
    status: () => new Map(status),
  };
}
