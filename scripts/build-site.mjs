// Builds the published site into a directory: the page with its
// Content-Security-Policy, its modules, its settings and the CNAME. The
// settings are validated first, so an invalid config.json or trusted.json
// fails the deploy instead of reaching visitors.
//
// Usage: node scripts/build-site.mjs <out-dir>

import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig, parseTrusted, consistencyErrors } from '../src/config.js';
import { buildCsp, externalScripts, injectCsp } from './csp.mjs';

/** What the page needs at runtime, and nothing else. */
const COPIED = ['app.js', 'styles', 'config.json', 'trusted.json', 'CNAME', 'assets', 'src'];

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

/** Both settings files, validated alone and together; throws naming every error. */
async function loadSettings(root) {
  const config = parseConfig(await readJson(join(root, 'config.json')));
  const trusted = parseTrusted(await readJson(join(root, 'trusted.json')));
  const errors = [...(config.errors ?? []), ...(trusted.errors ?? [])];
  if (!errors.length) errors.push(...consistencyErrors(config.config, trusted.trusted));
  if (errors.length) throw new Error(`invalid settings:\n- ${errors.join('\n- ')}`);
  return { config: config.config, trusted: trusted.trusted };
}

/** Builds the site of the repository at `root` into `out`. */
export async function buildSite({ root, out }) {
  const { config, trusted } = await loadSettings(root);
  const html = await readFile(join(root, 'index.html'), 'utf8');
  const policy = buildCsp({ config, trusted, scripts: externalScripts(html) });
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'index.html'), injectCsp(html, policy));
  for (const name of COPIED) await cp(join(root, name), join(out, name), { recursive: true });
  // Pages would otherwise run Jekyll over the files.
  await writeFile(join(out, '.nojekyll'), '');
  return { policy };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) {
    console.error('usage: node scripts/build-site.mjs <out-dir>');
    process.exit(2);
  }
  const root = fileURLToPath(new URL('..', import.meta.url));
  buildSite({ root, out: resolve(out) }).then(
    ({ policy }) => console.log(`site built in ${out}\nContent-Security-Policy: ${policy}`),
    (error) => {
      console.error(error.message);
      process.exit(1);
    },
  );
}
