import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseConfig, parseTrusted, isRelayUrl } from '../src/config.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

function config(overrides = {}) {
  return {
    relays: ['wss://relay.example'],
    explorers: { mainnet: ['https://explorer.example/api/blocks/tip/height'] },
    sample_interval_minutes: 10,
    raw_sample_retention_days: 90,
    daily_rollup_retention_days: 400,
    history_days_shown: 90,
    day_state_threshold_minutes: 15,
    min_day_coverage: 0.5,
    block_lag_red: 3,
    explorer_tip_max_age_minutes: 30,
    explorer_refresh_seconds: 60,
    ...overrides,
  };
}

function instance(overrides = {}) {
  return { pubkey: A, name: 'Mostro', region: 'Global', network: 'mainnet', monitored: true, ...overrides };
}

const errorsOf = (result) => (result.valid ? [] : result.errors);

test('the committed config.json is valid', () => {
  // Arrange
  const raw = readJson('../config.json');

  // Act
  const result = parseConfig(raw);

  // Assert
  assert.deepEqual(errorsOf(result), []);
  assert.deepEqual(result.config.relays, ['wss://relay.mostro.network', 'wss://mostro-p2p.tech', 'wss://relay.shadowbip.com']);
  assert.equal(result.config.blockLagRed, 3);
});

test('the committed trusted.json is valid and starts with the global Mostro', () => {
  const result = parseTrusted(readJson('../trusted.json'));

  assert.deepEqual(errorsOf(result), []);
  assert.equal(result.trusted.instances[0].pubkey, '82fa8cb978b43c79b2156585bac2c011176a21d2aead6d9f7c575c005be88390');
  assert.equal(result.trusted.instances[0].name, 'Mostro');
});

test('a valid config is returned with camelCase names and explorers in a Map', () => {
  const { valid, config: parsed } = parseConfig(config());

  assert.equal(valid, true);
  assert.deepEqual(parsed, {
    relays: ['wss://relay.example'],
    explorers: new Map([['mainnet', ['https://explorer.example/api/blocks/tip/height']]]),
    sampleIntervalMinutes: 10,
    rawSampleRetentionDays: 90,
    dailyRollupRetentionDays: 400,
    historyDaysShown: 90,
    dayStateThresholdMinutes: 15,
    minDayCoverage: 0.5,
    blockLagRed: 3,
    explorerTipMaxAgeMinutes: 30,
    explorerRefreshSeconds: 60,
  });
});

test('a config that is not an object is rejected', () => {
  assert.deepEqual(errorsOf(parseConfig(null)), ['config must be an object']);
  assert.deepEqual(errorsOf(parseConfig([])), ['config must be an object']);
});

test('a missing or unknown config key is named', () => {
  const missing = config();
  delete missing.block_lag_red;

  assert.deepEqual(errorsOf(parseConfig(missing)), ['block_lag_red is missing']);
  assert.deepEqual(errorsOf(parseConfig(config({ block_lag: 3 }))), ['block_lag is not a known key']);
});

test('relays must be a non-empty list of distinct relay URLs', () => {
  assert.deepEqual(errorsOf(parseConfig(config({ relays: [] }))), ['relays must be a non-empty list']);
  assert.deepEqual(errorsOf(parseConfig(config({ relays: 'wss://x' }))), ['relays must be a non-empty list']);
  assert.deepEqual(errorsOf(parseConfig(config({ relays: ['https://relay.example'] }))), ['relays has a bad URL: https://relay.example']);
  assert.deepEqual(errorsOf(parseConfig(config({ relays: ['wss://a.example', 'wss://a.example'] }))), ['relays repeats wss://a.example']);
});

test('a relay URL is wss with a host, or ws on this machine only', () => {
  assert.equal(isRelayUrl('wss://relay.mostro.network'), true);
  assert.equal(isRelayUrl('ws://localhost:10547'), true);
  assert.equal(isRelayUrl('ws://127.0.0.1:7777'), true);
  assert.equal(isRelayUrl('ws://relay.example'), false);
  assert.equal(isRelayUrl('wss://user:pass@relay.example'), false);
  assert.equal(isRelayUrl('not a url'), false);
  assert.equal(isRelayUrl(7), false);
});

test('explorers are https URLs listed under a known network', () => {
  assert.deepEqual(errorsOf(parseConfig(config({ explorers: [] }))), ['explorers must be an object']);
  assert.deepEqual(errorsOf(parseConfig(config({ explorers: { litecoin: [] } }))), ['explorers has an unknown network: litecoin']);
  assert.deepEqual(errorsOf(parseConfig(config({ explorers: { mainnet: 'x' } }))), ['explorers.mainnet must be a list']);
  assert.deepEqual(
    errorsOf(parseConfig(config({ explorers: { mainnet: ['http://explorer.example'] } }))),
    ['explorers.mainnet has a bad URL: http://explorer.example'],
  );
  assert.deepEqual(
    errorsOf(parseConfig(config({ explorers: { mainnet: ['https://user@explorer.example'] } }))),
    ['explorers.mainnet has a bad URL: https://user@explorer.example'],
  );
});

test('a network named after an object property is still an unknown network', () => {
  const explorers = JSON.parse('{"__proto__": ["https://x.example"], "toString": []}');

  assert.deepEqual(
    errorsOf(parseConfig(config({ explorers }))),
    ['explorers has an unknown network: __proto__', 'explorers has an unknown network: toString'],
  );
});

test('the counts and intervals are positive integers', () => {
  for (const key of ['raw_sample_retention_days', 'daily_rollup_retention_days', 'history_days_shown',
    'day_state_threshold_minutes', 'block_lag_red', 'explorer_tip_max_age_minutes', 'explorer_refresh_seconds']) {
    assert.deepEqual(errorsOf(parseConfig(config({ [key]: 0 }))), [`${key} must be a positive integer`], key);
    assert.deepEqual(errorsOf(parseConfig(config({ [key]: 1.5 }))), [`${key} must be a positive integer`], key);
  }
});

test('the sample interval is a multiple of 5 minutes, the cron of the sampler', () => {
  assert.deepEqual(errorsOf(parseConfig(config({ sample_interval_minutes: 7 }))), ['sample_interval_minutes must be a positive multiple of 5']);
  assert.deepEqual(errorsOf(parseConfig(config({ sample_interval_minutes: 0 }))), ['sample_interval_minutes must be a positive multiple of 5']);
  assert.equal(parseConfig(config({ sample_interval_minutes: 15 })).valid, true);
});

test('min_day_coverage is a fraction above 0 and at most 1', () => {
  assert.deepEqual(errorsOf(parseConfig(config({ min_day_coverage: 0 }))), ['min_day_coverage must be above 0 and at most 1']);
  assert.deepEqual(errorsOf(parseConfig(config({ min_day_coverage: 1.1 }))), ['min_day_coverage must be above 0 and at most 1']);
  assert.deepEqual(errorsOf(parseConfig(config({ min_day_coverage: '0.5' }))), ['min_day_coverage must be above 0 and at most 1']);
  assert.equal(parseConfig(config({ min_day_coverage: 1 })).valid, true);
});

test('the history shown cannot be longer than the history kept', () => {
  assert.deepEqual(
    errorsOf(parseConfig(config({ history_days_shown: 500 }))),
    ['history_days_shown must not exceed daily_rollup_retention_days'],
  );
});

test('a valid trusted list is returned with optional fields as null', () => {
  const { valid, trusted } = parseTrusted({ instances: [instance()], watchers: [{ pubkey: B, name: 'Watchdog' }] });

  assert.equal(valid, true);
  assert.deepEqual(trusted, {
    instances: [{ pubkey: A, name: 'Mostro', region: 'Global', network: 'mainnet', monitored: true, website: null, relays: [] }],
    watchers: [{ pubkey: B, name: 'Watchdog' }],
  });
});

test('a trusted list that is not an object with two lists is rejected', () => {
  assert.deepEqual(errorsOf(parseTrusted(null)), ['trusted list must be an object']);
  assert.deepEqual(errorsOf(parseTrusted({ instances: [] })), ['watchers must be a list']);
  assert.deepEqual(errorsOf(parseTrusted({ watchers: [] })), ['instances must be a list']);
  assert.deepEqual(errorsOf(parseTrusted({ instances: [], watchers: [], extra: 1 })), ['extra is not a known key']);
});

test('an instance needs a hex pubkey, a name, a known network and a monitored flag', () => {
  const errors = (overrides) => errorsOf(parseTrusted({ instances: [instance(overrides)], watchers: [] }));

  assert.deepEqual(errors({ pubkey: 'npub1x' }), ['instances[0].pubkey must be a lowercase hex key']);
  assert.deepEqual(errors({ name: ' ' }), ['instances[0].name must be a non-empty string']);
  assert.deepEqual(errors({ network: 'litecoin' }), ['instances[0].network must be a known network']);
  assert.deepEqual(errors({ monitored: 'yes' }), ['instances[0].monitored must be true or false']);
  assert.deepEqual(errors({ region: 5 }), ['instances[0].region must be a string']);
  assert.deepEqual(errors({ website: 'http://x.example' }), ['instances[0].website must be an https URL']);
  assert.deepEqual(errors({ relays: ['https://x.example'] }), ['instances[0].relays has a bad URL: https://x.example']);
  assert.deepEqual(errors({ relays: 'wss://x.example' }), ['instances[0].relays must be a list']);
  assert.deepEqual(errors({ avatar: 'x.png' }), ['instances[0].avatar is not a known key']);
});

test('an instance entry that is not an object is rejected', () => {
  assert.deepEqual(errorsOf(parseTrusted({ instances: [null], watchers: [] })), ['instances[0] must be an object']);
});

test('an instance may name extra relays and a website', () => {
  const { trusted } = parseTrusted({
    instances: [instance({ website: 'https://mostro.network', relays: ['wss://extra.example'] })],
    watchers: [],
  });

  assert.equal(trusted.instances[0].website, 'https://mostro.network');
  assert.deepEqual(trusted.instances[0].relays, ['wss://extra.example']);
});

test('a key listed twice, as instances or as an instance and a watcher, is rejected', () => {
  assert.deepEqual(
    errorsOf(parseTrusted({ instances: [instance(), instance({ name: 'Again' })], watchers: [] })),
    [`${A} is listed more than once`],
  );
  assert.deepEqual(
    errorsOf(parseTrusted({ instances: [instance()], watchers: [{ pubkey: A, name: 'Watcher' }] })),
    [`${A} is listed more than once`],
  );
});

test('a watcher needs a hex pubkey and a name', () => {
  assert.deepEqual(errorsOf(parseTrusted({ instances: [], watchers: [{ pubkey: 'x', name: 'W' }] })), ['watchers[0].pubkey must be a lowercase hex key']);
  assert.deepEqual(errorsOf(parseTrusted({ instances: [], watchers: [{ pubkey: B }] })), ['watchers[0].name must be a non-empty string']);
  assert.deepEqual(errorsOf(parseTrusted({ instances: [], watchers: ['x'] })), ['watchers[0] must be an object']);
  assert.deepEqual(errorsOf(parseTrusted({ instances: [], watchers: [{ pubkey: B, name: 'W', url: 'x' }] })), ['watchers[0].url is not a known key']);
});
