// The history sampler (SPEC § 3.5): one run reads the health events from
// the relays with the same reader as the page, cross-checks them against
// the explorers, and appends one sample per monitored instance to the data
// directory. It stores nothing unless at least one relay answered, so an
// outage on our side is a gap in the history, never a red day.
//
// Usage: node scripts/sample.mjs <data-dir>   (the data branch's data/)

import { appendFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSettings } from './settings.mjs';
import { relayUrls } from '../src/config.js';
import { HEALTH_KIND } from '../src/reader.js';
import { emptyStore, addEvent } from '../src/store.js';
import { createRelayPool } from '../src/relays.js';
import { refreshTips, explorerUrls, parseTips } from '../src/explorers.js';
import { shouldSample, takeSamples, sampleFile, expiredSampleFiles } from '../src/sampler.js';

/** How long a run waits for the relays to answer before it gives up on them. */
export const RELAY_TIMEOUT_MS = 30000;
const EXPLORER_TIMEOUT_MS = 10000;
const CONNECT_TIMEOUT_MS = 8000;
/** The file that remembers when the last sample was stored. */
const LAST_FILE = 'last.json';

/**
 * Reads the relays once: every event each one returns until it answers
 * with EOSE or fails, or `timeoutMs` passes. Resolves with the store built
 * from those events and the number of relays that answered.
 */
export function readRelays({ urls, trusted, connect, verify, now, timeoutMs, timers = globalThis }) {
  return new Promise((resolve) => {
    let store = emptyStore();
    const settled = new Set();
    // The relays that reached EOSE at any point: one that answered and then
    // dropped still answered, and its events are in the store.
    const answered = new Set();
    let done = false;
    let pool = null;
    const finish = () => {
      if (done) return;
      done = true;
      timers.clearTimeout(timer);
      pool.stop();
      resolve({ store, answered: answered.size });
    };
    const timer = timers.setTimeout(finish, timeoutMs);
    const authors = [...trusted.instances, ...trusted.watchers].map((entry) => entry.pubkey);
    pool = createRelayPool({
      urls,
      filters: [{ kinds: [HEALTH_KIND], authors }],
      connect,
      onEvent: (event, relay) => {
        const result = addEvent(store, { event, relay, now: now(), verify, trusted });
        if (result.changed) store = result.store;
      },
      onStatus: (status) => {
        for (const [url, state] of status) {
          if (state !== 'connecting') settled.add(url);
          if (state === 'live') answered.add(url);
        }
        if (settled.size === urls.length) finish();
      },
      timers,
    });
    pool.start();
  });
}

async function readLastSampleAt(dataDir) {
  try {
    const { t } = JSON.parse(await readFile(join(dataDir, LAST_FILE), 'utf8'));
    return Number.isSafeInteger(t) ? t : null;
  } catch {
    // No file yet, or one nobody can read: sample now rather than never.
    return null;
  }
}

/**
 * The explorer tips an earlier pass of the same job kept in `tipsFile`. With
 * no file, or one nobody can read, the next look is a first look, which
 * excuses no block.
 */
async function readTips(tipsFile, urls) {
  if (!tipsFile) return new Map();
  try {
    return parseTips(JSON.parse(await readFile(tipsFile, 'utf8')), urls);
  } catch {
    return new Map();
  }
}

async function writeTips(tipsFile, tips) {
  if (!tipsFile) return;
  await mkdir(dirname(tipsFile), { recursive: true });
  await writeFile(tipsFile, `${JSON.stringify([...tips])}\n`);
}

async function appendSamples(dataDir, samples) {
  for (const { pubkey, record } of samples) {
    const path = join(dataDir, sampleFile(pubkey, record.t));
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(record)}\n`);
  }
}

/** Deletes the month files that fell out of the raw retention. */
async function pruneSamples(dataDir, now, retentionDays) {
  const root = join(dataDir, 'samples');
  const instances = await readdir(root).catch(() => []);
  const removed = [];
  for (const pubkey of instances) {
    const names = await readdir(join(root, pubkey));
    for (const name of expiredSampleFiles(names, now, retentionDays)) {
      await rm(join(root, pubkey, name));
      removed.push(`${pubkey}/${name}`);
    }
  }
  return removed;
}

/**
 * One sampler run over the repository at `root`, writing into `dataDir`.
 * `tipsFile`, if given, keeps the explorer tips between the runs of one job;
 * it lives outside `dataDir`, so nothing carries them from one job to the
 * next and each job begins with a first look. `connect` opens a relay (nostr-tools' `Relay.connect`), `verify` checks
 * a signature and `fetchImpl` asks the explorers; `now` is the clock, in
 * Unix seconds. Resolves with what the run did:
 * - `{ stored: false, reason }` when it was too soon or no relay answered;
 * - `{ stored: true, samples, answered, removed }` otherwise.
 */
export async function runSample({
  root, dataDir, tipsFile, connect, verify, fetchImpl, now = () => Math.floor(Date.now() / 1000),
  relayTimeoutMs = RELAY_TIMEOUT_MS, explorerTimeoutMs = EXPLORER_TIMEOUT_MS, timers = globalThis,
}) {
  const { config, trusted } = await readSettings(root);
  // Every run looks at the explorers, sampling or not, as the page does
  // every minute: a block is then dated from the first run of the job that
  // saw it, and a node is not held to blocks seen only after it signed
  // (SPEC § 3.3).
  const tipUrls = explorerUrls(config.explorers, trusted);
  const tips = await refreshTips({ urls: tipUrls, tips: await readTips(tipsFile, tipUrls), fetchImpl, now, timeoutMs: explorerTimeoutMs });
  await writeTips(tipsFile, tips);
  const lastSampleAt = await readLastSampleAt(dataDir);
  if (!shouldSample(lastSampleAt, now(), config.sampleIntervalMinutes)) return { stored: false, reason: 'too soon' };
  const urls = relayUrls(config, trusted);
  const { store, answered } = await readRelays({ urls, trusted, connect, verify, now, timeoutMs: relayTimeoutMs, timers });
  if (answered === 0) return { stored: false, reason: 'no relay answered' };
  const t = now();
  const samples = takeSamples({ trusted, config, store, tips, now: t });
  await mkdir(dataDir, { recursive: true });
  await appendSamples(dataDir, samples);
  await writeFile(join(dataDir, LAST_FILE), `${JSON.stringify({ t })}\n`);
  const removed = await pruneSamples(dataDir, t, config.rawSampleRetentionDays);
  return { stored: true, samples: samples.map(({ pubkey, record }) => ({ pubkey, ...record })), answered, removed };
}

async function main() {
  const [dataDir, tipsFile] = process.argv.slice(2);
  if (!dataDir) {
    console.error('usage: node scripts/sample.mjs <data-dir> [tips-file]');
    process.exit(2);
  }
  // The relay library is a development dependency: only the script that
  // runs in Actions loads it, after npm ci.
  const [{ Relay }, { verifyEvent }] = await Promise.all([import('nostr-tools/relay'), import('nostr-tools/pure')]);
  const root = fileURLToPath(new URL('..', import.meta.url));
  const result = await runSample({
    root,
    dataDir: resolve(dataDir),
    tipsFile: tipsFile ? resolve(tipsFile) : undefined,
    // Signatures are checked by addEvent after the key and size checks,
    // so the library's own check is off, as in the page.
    connect: (url) => Relay.connect(url, { timeout: CONNECT_TIMEOUT_MS, verifyEvent: () => true }),
    verify: verifyEvent,
    fetchImpl: fetch,
  });
  if (!result.stored) {
    console.log(`nothing stored: ${result.reason}`);
    return;
  }
  console.log(`${result.answered} relay(s) answered; stored ${result.samples.length} sample(s)`);
  for (const sample of result.samples) console.log(`  ${sample.pubkey.slice(0, 8)} ${sample.state} ${sample.reasons.join(',') || '-'}`);
  for (const file of result.removed) console.log(`  removed ${file}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(error.message);
      process.exit(1);
    },
  );
}
