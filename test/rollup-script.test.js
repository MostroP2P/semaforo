import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRollup } from '../scripts/rollup.mjs';
import { dayStart } from '../src/rollup.js';
import { PK, OTHER } from './helpers/events.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DAY = dayStart('2026-10-14');
const MIN = 60;

async function repoWith(t) {
  const root = await mkdtemp(join(tmpdir(), 'semaforo-rollup-root-'));
  const dataDir = join(root, 'data');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'config.json'), await readFile(join(ROOT, 'config.json')));
  await writeFile(join(root, 'trusted.json'), JSON.stringify({
    instances: [
      { pubkey: PK, name: 'Mostro', network: 'mainnet', monitored: true },
      { pubkey: OTHER, name: 'Quiet', network: 'mainnet', monitored: false },
    ],
    watchers: [],
  }));
  return { root, dataDir };
}

const line = (t, state, reasons = []) => `${JSON.stringify({ t, state, status: null, lag: null, reasons, event: null, seq: null })}\n`;

async function withSamples(dataDir, pubkey, name, lines) {
  await mkdir(join(dataDir, 'samples', pubkey), { recursive: true });
  await writeFile(join(dataDir, 'samples', pubkey, name), lines.join(''));
}

test('the rollup writes one daily file per instance that has samples, one record per line', async (t) => {
  // Arrange: a full green day, then a red hour today.
  const { root, dataDir } = await repoWith(t);
  const lines = Array.from({ length: 144 }, (_, i) => line(DAY + i * 10 * MIN, 'green'));
  await withSamples(dataDir, PK, '2026-10.ndjson', [...lines, ...Array.from({ length: 6 }, (_, i) => line(DAY + 86400 + i * 10 * MIN, 'red', ['payouts']))]);

  // Act
  const result = await runRollup({ root, dataDir, now: DAY + 86400 + 3600 });

  // Assert
  assert.deepEqual(result, { written: [{ pubkey: PK, days: 2 }] });
  const text = await readFile(join(dataDir, 'daily', `${PK}.json`), 'utf8');
  const days = JSON.parse(text);
  assert.deepEqual(days.map((d) => [d.day, d.worst]), [['2026-10-14', 'green'], ['2026-10-15', 'red']]);
  assert.deepEqual(days[1].incidents, [{ from: DAY + 86400, to: DAY + 86400 + 3600, state: 'red', reason: 'payouts' }]);
  assert.equal(text.split('\n').length, 5);
  assert.deepEqual(await readdir(join(dataDir, 'daily')), [`${PK}.json`]);
});

test('records older than the samples are kept from the previous file', async (t) => {
  const { root, dataDir } = await repoWith(t);
  await withSamples(dataDir, PK, '2026-10.ndjson', [line(DAY, 'green')]);
  await mkdir(join(dataDir, 'daily'), { recursive: true });
  const old = { day: '2026-10-01', green: 1, yellow: 0, red: 0, none: 0, worst: 'green', incidents: [] };
  await writeFile(join(dataDir, 'daily', `${PK}.json`), JSON.stringify([old]));

  await runRollup({ root, dataDir, now: DAY + 3600 });

  const days = JSON.parse(await readFile(join(dataDir, 'daily', `${PK}.json`), 'utf8'));
  assert.deepEqual(days.map((d) => d.day), ['2026-10-01', '2026-10-14']);
});

test('a sample line nobody can read stops the rollup, naming the file and line', async (t) => {
  const { root, dataDir } = await repoWith(t);
  await withSamples(dataDir, PK, '2026-10.ndjson', [line(DAY, 'green'), '{broken\n']);

  await assert.rejects(runRollup({ root, dataDir, now: DAY + 3600 }), new RegExp(`${PK}/2026-10.ndjson:2 is not a JSON record`));
});

test('a daily file that is not a list stops the rollup', async (t) => {
  const { root, dataDir } = await repoWith(t);
  await withSamples(dataDir, PK, '2026-10.ndjson', [line(DAY, 'green')]);
  await mkdir(join(dataDir, 'daily'), { recursive: true });
  await writeFile(join(dataDir, 'daily', `${PK}.json`), '{}');

  await assert.rejects(runRollup({ root, dataDir, now: DAY + 3600 }), /is not a list of records/);
});

test('with no data at all the rollup writes nothing', async (t) => {
  const { root, dataDir } = await repoWith(t);

  assert.deepEqual(await runRollup({ root, dataDir, now: DAY }), { written: [] });
});
