// The settings of the repository at `root`, config.json and trusted.json,
// validated alone and together, for the scripts that run outside the page:
// the build and the sampler. An invalid file stops them with every error
// named, instead of quietly changing what is published or stored.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseConfig, parseTrusted, consistencyErrors } from '../src/config.js';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

/**
 * Both files, parsed and checked; throws naming every error. `moreErrors`
 * may add checks of its own once both files are valid, such as the build's
 * check that each claimed avatar is there.
 */
export async function readSettings(root, moreErrors = async () => []) {
  const config = parseConfig(await readJson(join(root, 'config.json')));
  const trusted = parseTrusted(await readJson(join(root, 'trusted.json')));
  const errors = [...(config.errors ?? []), ...(trusted.errors ?? [])];
  if (!errors.length) errors.push(...consistencyErrors(config.config, trusted.trusted));
  if (!errors.length) errors.push(...await moreErrors(config.config, trusted.trusted));
  if (errors.length) throw new Error(`invalid settings:\n- ${errors.join('\n- ')}`);
  return { config: config.config, trusted: trusted.trusted };
}
