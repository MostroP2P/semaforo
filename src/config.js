// Validation of config.json and trusted.json, the two files maintainers edit
// by pull request. The page and the sampler both read them through here, so a
// typo fails loudly in CI and at load instead of quietly changing behaviour.
// Every function is pure and returns `{ valid, ... }` with all the errors
// found, not just the first.

import { NETWORKS } from './reader.js';

const HEX_KEY = /^[0-9a-f]{64}$/;
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
/** Longest instance name in the trusted list, in characters. */
const MAX_NAME_LENGTH = 64;
/**
 * Public networks: an instance listed on one of them must have explorers,
 * or it would silently lose its cross-check. Regtest and simnet have none.
 */
const NETWORKS_WITH_EXPLORERS = ['mainnet', 'testnet', 'testnet4', 'signet'];

const CONFIG_KEYS = {
  relays: 'relays',
  explorers: 'explorers',
  sample_interval_minutes: 'sampleIntervalMinutes',
  raw_sample_retention_days: 'rawSampleRetentionDays',
  daily_rollup_retention_days: 'dailyRollupRetentionDays',
  history_days_shown: 'historyDaysShown',
  day_state_threshold_minutes: 'dayStateThresholdMinutes',
  min_day_coverage: 'minDayCoverage',
  block_lag_red: 'blockLagRed',
  explorer_tip_max_age_minutes: 'explorerTipMaxAgeMinutes',
  explorer_refresh_seconds: 'explorerRefreshSeconds',
  history_url: 'historyUrl',
};
const POSITIVE_INTEGERS = [
  'raw_sample_retention_days',
  'daily_rollup_retention_days',
  'history_days_shown',
  'day_state_threshold_minutes',
  'block_lag_red',
  'explorer_tip_max_age_minutes',
  'explorer_refresh_seconds',
];
const INSTANCE_KEYS = ['pubkey', 'name', 'region', 'network', 'monitored', 'website', 'relays', 'avatar'];
const WATCHER_KEYS = ['pubkey', 'name'];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function parseUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * A relay the page may connect to: wss with a host, no credentials and no
 * fragment (which WebSocket refuses), or ws on this machine only (a local
 * test relay).
 */
export function isRelayUrl(value) {
  const url = parseUrl(value);
  if (!url || !url.hostname || url.username || url.password || url.hash || value.includes('#')) return false;
  return url.protocol === 'wss:' || (url.protocol === 'ws:' && LOCAL_HOSTS.includes(url.hostname));
}

function isHttpsUrl(value) {
  const url = parseUrl(value);
  return Boolean(url && url.protocol === 'https:' && url.hostname && !url.username && !url.password);
}

/**
 * Where the page reads the daily records from, `<history_url><hex pubkey>.json`:
 * an https directory (ending in `/`, so the policy can admit it as a prefix),
 * with no credentials, query or fragment, or http on this machine only (the
 * smoke test's site).
 */
export function isHistoryUrl(value) {
  const url = parseUrl(value);
  if (!url || !url.hostname || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/')) return false;
  if (value.includes('?') || value.includes('#')) return false;
  return url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.includes(url.hostname));
}

/** Errors for the keys of `object` that are not in `known`. */
function unknownKeys(object, known, prefix = '') {
  return Object.keys(object)
    .filter((key) => !known.includes(key))
    .map((key) => `${prefix}${key} is not a known key`);
}

/**
 * Errors for each entry of `list` that `isValid` refuses, and for each that
 * repeats an earlier one once normalised (`wss://a` and `wss://a/` are the
 * same relay).
 */
function urlListErrors(list, name, isValid) {
  const errors = [];
  const seen = new Set();
  for (const value of list) {
    if (!isValid(value)) {
      errors.push(`${name} has a bad URL: ${value}`);
      continue;
    }
    const normalised = new URL(value).href;
    if (seen.has(normalised)) errors.push(`${name} repeats ${value}`);
    seen.add(normalised);
  }
  return errors;
}

/** Errors for a list of relay URLs called `name`. */
function relayListErrors(list, name, { required }) {
  if (!Array.isArray(list) || (required && list.length === 0)) {
    return [required ? `${name} must be a non-empty list` : `${name} must be a list`];
  }
  return urlListErrors(list, name, isRelayUrl);
}

function explorerErrors(explorers) {
  if (!isObject(explorers)) return ['explorers must be an object'];
  const errors = [];
  for (const [network, urls] of Object.entries(explorers)) {
    if (!NETWORKS.includes(network)) {
      errors.push(`explorers has an unknown network: ${network}`);
    } else if (!Array.isArray(urls)) {
      errors.push(`explorers.${network} must be a list`);
    } else if (urls.length === 0) {
      // Leave the network out instead: an empty list reads like a mistake.
      errors.push(`explorers.${network} must be a non-empty list`);
    } else {
      errors.push(...urlListErrors(urls, `explorers.${network}`, isHttpsUrl));
    }
  }
  return errors;
}

function numberErrors(raw) {
  const errors = POSITIVE_INTEGERS
    .filter((key) => !isPositiveInteger(raw[key]))
    .map((key) => `${key} must be a positive integer`);
  const interval = raw.sample_interval_minutes;
  if (!isPositiveInteger(interval) || interval % 5 !== 0) {
    errors.push('sample_interval_minutes must be a positive multiple of 5');
  }
  const coverage = raw.min_day_coverage;
  if (typeof coverage !== 'number' || !(coverage > 0 && coverage <= 1)) {
    errors.push('min_day_coverage must be above 0 and at most 1');
  }
  if (errors.length === 0 && raw.history_days_shown > raw.daily_rollup_retention_days) {
    errors.push('history_days_shown must not exceed daily_rollup_retention_days');
  }
  return errors;
}

/**
 * Validates config.json. Returns `{ valid: true, config }`, with camelCase
 * names and the explorers in a Map (a network name never reaches an object
 * prototype), or `{ valid: false, errors }`.
 */
export function parseConfig(raw) {
  if (!isObject(raw)) return { valid: false, errors: ['config must be an object'] };
  const known = Object.keys(CONFIG_KEYS);
  const missing = known.filter((key) => !(key in raw)).map((key) => `${key} is missing`);
  if (missing.length) return { valid: false, errors: missing };
  const errors = [
    ...unknownKeys(raw, known),
    ...relayListErrors(raw.relays, 'relays', { required: true }),
    ...explorerErrors(raw.explorers),
    ...numberErrors(raw),
    ...(isHistoryUrl(raw.history_url) ? [] : [`history_url must be an https URL ending in /, got ${raw.history_url}`]),
  ];
  if (errors.length) return { valid: false, errors };
  const config = {};
  for (const [key, name] of Object.entries(CONFIG_KEYS)) config[name] = raw[key];
  config.relays = [...raw.relays];
  config.explorers = new Map(Object.entries(raw.explorers).map(([network, urls]) => [network, [...urls]]));
  return { valid: true, config };
}

function instanceErrors(entry, at) {
  if (!isObject(entry)) return [`${at} must be an object`];
  const errors = unknownKeys(entry, INSTANCE_KEYS, `${at}.`);
  if (typeof entry.pubkey !== 'string' || !HEX_KEY.test(entry.pubkey)) errors.push(`${at}.pubkey must be a lowercase hex key`);
  if (!isNonEmptyString(entry.name)) errors.push(`${at}.name must be a non-empty string`);
  else if ([...entry.name.trim()].length > MAX_NAME_LENGTH) errors.push(`${at}.name must be at most ${MAX_NAME_LENGTH} characters`);
  if (entry.region !== undefined && !isNonEmptyString(entry.region)) errors.push(`${at}.region must be a non-empty string`);
  if (!NETWORKS.includes(entry.network)) errors.push(`${at}.network must be a known network`);
  if (typeof entry.monitored !== 'boolean') errors.push(`${at}.monitored must be true or false`);
  if (entry.website !== undefined && !isHttpsUrl(entry.website)) errors.push(`${at}.website must be an https URL`);
  if (entry.relays !== undefined) errors.push(...relayListErrors(entry.relays, `${at}.relays`, { required: false }));
  // Never a URL: the avatar is a vetted copy in assets/avatars/ (SPEC § 4).
  if (entry.avatar !== undefined && typeof entry.avatar !== 'boolean') errors.push(`${at}.avatar must be true or false`);
  return errors;
}

function watcherErrors(entry, at) {
  if (!isObject(entry)) return [`${at} must be an object`];
  const errors = unknownKeys(entry, WATCHER_KEYS, `${at}.`);
  if (typeof entry.pubkey !== 'string' || !HEX_KEY.test(entry.pubkey)) errors.push(`${at}.pubkey must be a lowercase hex key`);
  if (!isNonEmptyString(entry.name)) errors.push(`${at}.name must be a non-empty string`);
  return errors;
}

/** Errors for a key that appears more than once across both lists. */
function duplicateKeyErrors(instances, watchers) {
  const keys = [...instances, ...watchers].map((entry) => entry.pubkey);
  const repeated = keys.filter((key, index) => keys.indexOf(key) !== index);
  return [...new Set(repeated)].map((key) => `${key} is listed more than once`);
}

/**
 * Validates trusted.json. Returns `{ valid: true, trusted }`, in the order of
 * the file (the order of the rows on the page), or `{ valid: false, errors }`.
 */
export function parseTrusted(raw) {
  if (!isObject(raw)) return { valid: false, errors: ['trusted list must be an object'] };
  const errors = unknownKeys(raw, ['instances', 'watchers']);
  if (!Array.isArray(raw.instances)) errors.push('instances must be a list');
  if (!Array.isArray(raw.watchers)) errors.push('watchers must be a list');
  if (errors.length) return { valid: false, errors };
  errors.push(
    ...raw.instances.flatMap((entry, i) => instanceErrors(entry, `instances[${i}]`)),
    ...raw.watchers.flatMap((entry, i) => watcherErrors(entry, `watchers[${i}]`)),
  );
  if (errors.length) return { valid: false, errors };
  const duplicates = duplicateKeyErrors(raw.instances, raw.watchers);
  if (duplicates.length) return { valid: false, errors: duplicates };
  return {
    valid: true,
    trusted: {
      instances: raw.instances.map((entry) => ({
        pubkey: entry.pubkey,
        name: entry.name.trim(),
        region: entry.region?.trim() ?? null,
        network: entry.network,
        monitored: entry.monitored,
        website: entry.website ?? null,
        relays: [...(entry.relays ?? [])],
        avatar: entry.avatar ?? false,
      })),
      watchers: raw.watchers.map((entry) => ({ pubkey: entry.pubkey, name: entry.name.trim() })),
    },
  };
}

/**
 * Errors between two valid files: an instance on a public network that has
 * no explorer in the configuration would lose its cross-check without anyone
 * noticing, so it is refused.
 */
export function consistencyErrors(config, trusted) {
  return trusted.instances
    .filter((entry) => NETWORKS_WITH_EXPLORERS.includes(entry.network) && !config.explorers.has(entry.network))
    .map((entry) => `${entry.pubkey} is on ${entry.network}, which has no explorer in config.json`);
}

/**
 * Every relay the page reads, the configured ones first, then those of the
 * trusted instances, each once: normalised, so `wss://a` and `wss://a/` are
 * one connection and one relay in the counts.
 */
export function relayUrls(config, trusted) {
  const all = [...config.relays, ...trusted.instances.flatMap((entry) => entry.relays)];
  return [...new Set(all.map((url) => new URL(url).href))];
}
