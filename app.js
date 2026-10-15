// The page: loads config.json and trusted.json, reads the relays and the
// explorers, and redraws. Every decision is in src/ as a pure function; this
// file only wires them to the browser. nostr-tools (window.NostrTools) is
// loaded before it from a CDN pinned with an SRI hash, and is used only to
// open relays and verify signatures.

import { parseConfig, parseTrusted, consistencyErrors, relayUrls } from './src/config.js';
import { pickLanguage, catalogue, LANGUAGES } from './src/i18n.js';
import { emptyStore, addEvent } from './src/store.js';
import { createRelayPool, relayState, CONNECT_TIMEOUT_SECONDS } from './src/relays.js';
import { refreshTips, explorerUrls } from './src/explorers.js';
import { pageView } from './src/view.js';
import { renderStatic, renderView, renderError } from './src/dom.js';
import { HEALTH_KIND, INFO_KIND } from './src/reader.js';

const REDRAW_EVERY_MS = 5000;
const REDRAW_AFTER_EVENT_MS = 200;
const RELAY_CONNECT_TIMEOUT_MS = 8000;
const EXPLORER_TIMEOUT_MS = 10000;
const THEME_KEY = 'semaforo:theme';

const nowSeconds = () => Math.floor(Date.now() / 1000);

async function loadJson(path) {
  const response = await fetch(path, { cache: 'no-cache', credentials: 'same-origin' });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);
  return response.json();
}

/** Both files, validated alone and together, or the errors found. */
async function loadSettings() {
  const [rawConfig, rawTrusted] = await Promise.all([loadJson('config.json'), loadJson('trusted.json')]);
  const config = parseConfig(rawConfig);
  const trusted = parseTrusted(rawTrusted);
  if (!config.valid || !trusted.valid) return { errors: [...(config.errors ?? []), ...(trusted.errors ?? [])] };
  const errors = consistencyErrors(config.config, trusted.trusted);
  return errors.length ? { errors } : { config: config.config, trusted: trusted.trusted };
}

// The theme follows the system unless the visitor picked one. The choice is
// a convenience kept in this browser only; without storage it still works.
function readTheme() {
  try {
    const theme = localStorage.getItem(THEME_KEY);
    return theme === 'light' || theme === 'dark' ? theme : null;
  } catch {
    return null;
  }
}

function setupTheme() {
  const root = document.documentElement;
  const saved = readTheme();
  if (saved) root.dataset.theme = saved;
  document.getElementById('theme').addEventListener('click', () => {
    const dark = root.dataset.theme
      ? root.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try {
      localStorage.setItem(THEME_KEY, root.dataset.theme);
    } catch {
      // No storage: the choice lasts until the page is closed.
    }
  });
}

function setupLanguage(page) {
  for (const button of document.querySelectorAll('#lang button')) {
    button.addEventListener('click', () => {
      const lang = button.dataset.lang;
      if (!LANGUAGES.includes(lang)) return;
      const url = new URL(location.href);
      url.searchParams.set('lang', lang);
      history.replaceState(null, '', url);
      page.setLanguage(lang);
    });
  }
}

function relayFilters(trusted) {
  const instances = trusted.instances.map((entry) => entry.pubkey);
  const watchers = trusted.watchers.map((entry) => entry.pubkey);
  return [
    { kinds: [HEALTH_KIND], authors: [...instances, ...watchers] },
    { kinds: [INFO_KIND], authors: instances },
  ];
}

/** The live page over valid settings. */
function startPage({ config, trusted, lang, nostr }) {
  let t = catalogue(lang);
  let store = emptyStore();
  let tips = new Map();
  let statuses = [];
  let redrawTimer = null;
  const startedAt = nowSeconds();

  // A throw here must not leave the last colours on screen as if current.
  const draw = () => {
    redrawTimer = null;
    try {
      const now = nowSeconds();
      const relays = relayState(statuses, startedAt, now, CONNECT_TIMEOUT_SECONDS);
      renderView(document, pageView({ t, trusted, config, store, relays, tips, now }), t);
    } catch (error) {
      console.error('Semáforo could not draw the page:', error);
      renderError(document, t.error.render);
      document.getElementById('instances').replaceChildren();
    }
  };
  const drawSoon = () => {
    redrawTimer ??= setTimeout(draw, REDRAW_AFTER_EVENT_MS);
  };

  const urls = relayUrls(config, trusted);
  const pool = createRelayPool({
    urls,
    filters: relayFilters(trusted),
    // The ping closes a half-open socket, so a relay that went silent is
    // not counted as reachable.
    connect: (url) => nostr.Relay.connect(url, { timeout: RELAY_CONNECT_TIMEOUT_MS, enablePing: true }),
    onEvent: (event, relay) => {
      const result = addEvent(store, { event, relay, now: nowSeconds(), verify: nostr.verifyEvent, trusted });
      if (!result.changed) return;
      store = result.store;
      drawSoon();
    },
    onStatus: (status) => {
      statuses = [...status.values()];
      drawSoon();
    },
  });

  const explorers = explorerUrls(config.explorers, trusted);
  const refresh = async () => {
    tips = await refreshTips({ urls: explorers, tips, fetchImpl: fetch, now: nowSeconds(), timeoutMs: EXPLORER_TIMEOUT_MS });
    drawSoon();
  };

  pool.start();
  if (explorers.length) {
    refresh();
    setInterval(refresh, config.explorerRefreshSeconds * 1000);
  }
  setInterval(draw, REDRAW_EVERY_MS);
  draw();
  return {
    setLanguage(next) {
      t = catalogue(next);
      renderStatic(document, t, next);
      draw();
    },
  };
}

async function main() {
  let lang = pickLanguage(location.search, navigator.languages);
  let t = catalogue(lang);
  renderStatic(document, t, lang);
  setupTheme();
  const nostr = window.NostrTools;
  if (!nostr?.Relay || !nostr?.verifyEvent) {
    renderError(document, t.error.library);
    return;
  }
  let settings;
  try {
    settings = await loadSettings();
  } catch (error) {
    settings = { errors: [String(error)] };
  }
  if (settings.errors) {
    console.error('Semáforo configuration errors:', settings.errors);
    renderError(document, t.error.config);
    return;
  }
  const page = startPage({ ...settings, lang, nostr });
  setupLanguage({
    setLanguage(next) {
      lang = next;
      t = catalogue(next);
      page.setLanguage(next);
    },
  });
}

main();
