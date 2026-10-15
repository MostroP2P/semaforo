// What the page shows, as a pure function of the trusted list, the
// configuration, the store, the relay state, the explorer tips and the
// clock. Every word comes from the catalogue `t`; dom.js only draws this.

import { CHECK_NAMES, isFresh } from './reader.js';
import { snapshot } from './snapshot.js';
import { watcherState } from './light.js';
import { banner } from './banner.js';
import { duration, utcTime, percent } from './format.js';
import { neventEncode } from './bech32.js';
import { relayUrls } from './config.js';

const ICONS = { green: '✓', yellow: '!', red: '✕', grey: '?', checking: '…', unverifiable: '?' };
// Colour is never the only signal: watchers get an icon too.
const WATCHER_ICONS = { alive: '✓', not_reporting: '✕', checking: '…', unverifiable: '?' };
const NJUMP = 'https://njump.me/';

/** The host of an explorer URL, the name a visitor recognises. */
function host(url) {
  return new URL(url).host;
}

function ago(t, seconds) {
  return t.ago(duration(seconds));
}

/**
 * The state shown for an instance. A monitored instance with no fresh event
 * is red only once a relay has answered: before that the page is still
 * checking, and with no relay at all it cannot verify anything.
 */
function shownState(light, relays) {
  if (!light.reasons.includes('not_reporting') || relays === 'reachable') return light.state;
  return relays === 'connecting' ? 'checking' : 'unverifiable';
}

function wordFor(t, state, light) {
  // "Not reporting" replaces "Down": it tells a silent node from one that
  // reports itself down.
  if (state === 'red' && light.reasons.includes('not_reporting')) return t.label.not_reporting;
  return t.state[state];
}

function heightText(t, report, check) {
  if (report.blockHeight === null) return t.details.lndUnreachable;
  const lag = (n) => (n <= 0 ? t.details.inSync : t.details.behind(n));
  switch (check.kind) {
    case 'explorer':
      return `${t.details.heightExplorer(report.blockHeight, check.height, host(check.source))} · ${lag(check.lag)}`;
    case 'peers':
      return `${t.details.heightPeers(report.blockHeight, check.height, check.count)} · ${lag(check.lag)}`;
    case 'exempt':
      return t.details.heightExempt(report.blockHeight, report.network);
    default:
      return t.details.heightUnavailable(report.blockHeight);
  }
}

function checkViews(t, report, now) {
  const byName = new Map(report.checks.map((c) => [c.name, c]));
  return CHECK_NAMES.filter((name) => byName.has(name)).map((name) => {
    const { state, since } = byName.get(name);
    const when = since === null
      ? t.details.notPublished
      : t.details.since(utcTime(since), duration(now - since));
    return { name: t.check[name], state, text: `${t.checkState[state]} · ${when}` };
  });
}

function reportDetails({ t, entry, report, stored, check, info, now, relayTotal }) {
  const details = [{
    term: t.details.lastSeen,
    value: `${t.details.lastSeenValue(ago(t, now - report.createdAt), utcTime(report.createdAt))} · ${t.details.relays(stored.relays.length, relayTotal)}`,
  }];
  if (report.escrowMode === 'lightning') {
    details.push({ term: t.details.blockHeight, value: heightText(t, report, check) });
  }
  if (check.networkMismatch) {
    const reported = report.network ?? t.details.noNetwork;
    details.push({ term: t.details.network, value: t.details.networkMismatch(reported, entry.network) });
  }
  details.push({ term: t.details.escrow, value: t.escrow[report.escrowMode] });
  if (report.maintenance) details.push({ term: t.details.maintenance, value: t.details.maintenanceOn });
  return details;
}

function infoDetails(t, report, info) {
  const details = [];
  const version = info?.version ?? report?.version;
  if (version) details.push({ term: t.details.version, value: version });
  if (info && info.fee !== null) details.push({ term: t.details.fee, value: percent(info.fee) });
  return details;
}

function eventLink(t, stored) {
  const { report, relays } = stored;
  const nevent = neventEncode({ id: report.id, relays: relays.slice(0, 2), author: report.pubkey });
  return { href: `${NJUMP}${nevent}`, label: t.details.verify };
}

function rowView({ t, entry, stored, info, light, check, relays, now, relayTotal }) {
  const report = stored?.report;
  const state = shownState(light, relays);
  const details = report
    ? reportDetails({ t, entry, report, stored, check, info, now, relayTotal })
    : [{ term: t.details.lastSeen, value: t.details.noEvent }];
  return {
    pubkey: entry.pubkey,
    name: entry.name,
    initial: [...entry.name][0].toUpperCase(),
    // A vetted copy served with the site; the profile's own URL is never used.
    avatar: entry.avatar ? `assets/avatars/${entry.pubkey}.webp` : null,
    region: entry.region,
    website: entry.website,
    escrow: report ? t.escrow[report.escrowMode] : null,
    state,
    icon: ICONS[state],
    word: wordFor(t, state, light),
    labels: light.labels.filter((l) => l !== 'not_reporting').map((l) => t.label[l]),
    checks: report ? checkViews(t, report, now) : [],
    details: [...details, ...infoDetails(t, report, info)],
    event: report ? eventLink(t, stored) : null,
    note: report && !isFresh(report, now) ? t.details.stale : null,
  };
}

function instanceRows({ t, trusted, config, store, relays, tips, now }) {
  const relayTotal = relayUrls(config, trusted).length;
  return snapshot({ trusted, config, store, tips, now }).map(({ entry, stored, check, light }) => {
    const info = store.info.get(entry.pubkey);
    return { light, row: rowView({ t, entry, stored, info, light, check, relays, now, relayTotal }) };
  });
}

function bannerView(t, relays, lights) {
  const result = banner({ relays, lights });
  const text = result.message === 'down' ? t.banner.down(result.count) : t.banner[result.message];
  return {
    state: result.state,
    message: result.message,
    text,
    counts: ['green', 'yellow', 'red'].map((state) => ({ state, text: t.counts[state](result.counts[state]) })),
  };
}

/**
 * A watcher without a fresh heartbeat is not reporting only once a relay
 * has answered; before that the page is checking, and with no relay it
 * cannot verify anything.
 */
function watcherShown(report, relays, now) {
  const state = watcherState(report, now);
  if (state === 'alive' || relays === 'reachable') return state;
  return relays === 'connecting' ? 'checking' : 'unverifiable';
}

function watchersView(t, trusted, store, relays, now) {
  if (trusted.watchers.length === 0) return { state: 'none', summary: t.watchers.none, items: [] };
  const items = trusted.watchers.map((watcher) => {
    const report = store.heartbeats.get(watcher.pubkey)?.report;
    const state = watcherShown(report, relays, now);
    const seen = report ? t.watchers.lastSeen(ago(t, now - report.createdAt)) : t.watchers.never;
    const word = t.watchers[state] ?? t.state[state];
    return { name: watcher.name, state, icon: WATCHER_ICONS[state], text: `${word} · ${seen}` };
  });
  const alive = items.filter((item) => item.state === 'alive').length;
  let state = 'yellow';
  if (relays === 'connecting') state = 'checking';
  else if (relays !== 'reachable') state = 'unverifiable';
  else if (alive === items.length) state = 'green';
  else if (alive === 0) state = 'red';
  // Without an answer from a relay, the watchers not counted alive are
  // unknown, not dead: say so instead of "0 of N alive".
  let summary = t.watchers.summary(alive, items.length);
  if (['checking', 'unverifiable'].includes(state)) {
    summary = alive === 0 ? t.state[state] : `${summary} · ${t.state[state]}`;
  }
  return { state, summary, items };
}

/**
 * Everything the page shows at `now`: the banner, one row per trusted
 * instance in the order of the list, the watchers and the history note.
 * `relays` is `connecting`, `reachable` or `unreachable`; `tips` maps an
 * explorer URL to `{ height, at }`.
 */
export function pageView({ t, trusted, config, store, relays, tips, now }) {
  const results = instanceRows({ t, trusted, config, store, relays, tips, now });
  return {
    // Counted as shown: a row still checking is not counted as down.
    banner: bannerView(t, relays, results.map((r) => ({ state: r.row.state }))),
    rows: results.map((r) => r.row),
    watchers: watchersView(t, trusted, store, relays, now),
    history: { title: t.history.title(config.historyDaysShown), note: t.history.soon },
  };
}
