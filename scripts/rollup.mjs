// The daily rollup (SPEC § 3.5): recomputes, from the raw samples on the
// data branch, the record of every day they cover, keeps the older records
// whose samples are gone, and writes one file per trusted instance,
// `daily/<pubkey>.json`. The sampling workflow runs it after each run that
// stored samples, so today's bar follows each new sample.
//
// Usage: node scripts/rollup.mjs <data-dir>   (the data branch's data/)

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSettings } from './settings.mjs';
import { rollup } from '../src/rollup.js';

/** The raw samples of `pubkey`, every month file; a line nobody can read stops the run. */
async function readSamples(dataDir, pubkey) {
  const dir = join(dataDir, 'samples', pubkey);
  const names = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.ndjson')).sort();
  const samples = [];
  for (const name of names) {
    const lines = (await readFile(join(dir, name), 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (line.trim() === '') return;
      try {
        samples.push(JSON.parse(line));
      } catch {
        throw new Error(`${pubkey}/${name}:${i + 1} is not a JSON record`);
      }
    });
  }
  return samples;
}

/** The records already written for `pubkey`, or none. */
async function readExisting(dataDir, pubkey) {
  const path = join(dataDir, 'daily', `${pubkey}.json`);
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  const records = JSON.parse(text);
  if (!Array.isArray(records)) throw new Error(`daily/${pubkey}.json is not a list of records`);
  return records;
}

/** One record per line, so a day's change is a one-line diff on the data branch. */
function format(records) {
  if (records.length === 0) return '[]\n';
  return `[\n${records.map((record) => JSON.stringify(record)).join(',\n')}\n]\n`;
}

/**
 * Rolls up the samples in `dataDir` for every trusted instance of the
 * repository at `root`, as of `now` (Unix seconds). Resolves with the
 * instances written and how many days each one has.
 */
export async function runRollup({ root, dataDir, now = Math.floor(Date.now() / 1000) }) {
  const { config, trusted } = await readSettings(root);
  const written = [];
  for (const { pubkey } of trusted.instances) {
    const samples = await readSamples(dataDir, pubkey);
    const existing = await readExisting(dataDir, pubkey);
    if (samples.length === 0 && existing.length === 0) continue;
    const days = rollup({ samples, existing, now, config });
    await mkdir(join(dataDir, 'daily'), { recursive: true });
    await writeFile(join(dataDir, 'daily', `${pubkey}.json`), format(days));
    written.push({ pubkey, days: days.length });
  }
  return { written };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('usage: node scripts/rollup.mjs <data-dir>');
    process.exit(2);
  }
  const root = fileURLToPath(new URL('..', import.meta.url));
  runRollup({ root, dataDir: resolve(dataDir) }).then(
    ({ written }) => {
      for (const { pubkey, days } of written) console.log(`${pubkey.slice(0, 8)} ${days} day(s)`);
      console.log(`rolled up ${written.length} instance(s)`);
    },
    (error) => {
      console.error(error.message);
      process.exit(1);
    },
  );
}
