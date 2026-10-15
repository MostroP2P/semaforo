import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, cp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from '../scripts/build-site.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function listFiles(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => (
    entry.isDirectory() ? listFiles(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]
  )));
  return nested.flat().sort();
}

test('the site holds the page, its modules, its settings and the domain, and nothing else', async (t) => {
  // Arrange
  const out = await mkdtemp(join(tmpdir(), 'semaforo-site-'));
  t.after(() => rm(out, { recursive: true, force: true }));

  // Act
  await buildSite({ root: ROOT, out });

  // Assert
  const files = await listFiles(out);
  for (const expected of ['.nojekyll', 'CNAME', 'app.js', 'assets/favicon.svg', 'config.json', 'index.html', 'src/reader.js', 'src/i18n/es.js', 'styles/base.css', 'styles/hero.css', 'styles/instances.css', 'trusted.json']) {
    assert.ok(files.includes(expected), `${expected} is published`);
  }
  assert.equal(files.some((f) => f.startsWith('test/') || f.startsWith('docs/') || f.startsWith('scripts/') || f === 'package.json'), false);
});

test('the published page carries the policy built from the committed settings', async (t) => {
  const out = await mkdtemp(join(tmpdir(), 'semaforo-site-'));
  t.after(() => rm(out, { recursive: true, force: true }));

  await buildSite({ root: ROOT, out });

  const html = await readFile(join(out, 'index.html'), 'utf8');
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' https:\/\/cdn\.jsdelivr\.net\/npm\/nostr-tools@2\.25\.2\/lib\/nostr\.bundle\.js;/);
  assert.match(html, /connect-src 'self' wss:\/\/relay\.mostro\.network /);
});

test('invalid settings stop the build with every error named', async (t) => {
  // Arrange: a copy of the repository with a broken config.json.
  const root = await mkdtemp(join(tmpdir(), 'semaforo-root-'));
  const out = await mkdtemp(join(tmpdir(), 'semaforo-site-'));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(out, { recursive: true, force: true })]));
  for (const name of ['index.html', 'app.js', 'styles', 'trusted.json', 'CNAME', 'src', 'assets']) {
    await cp(join(ROOT, name), join(root, name), { recursive: true });
  }
  const config = JSON.parse(await readFile(join(ROOT, 'config.json'), 'utf8'));
  await writeFile(join(root, 'config.json'), JSON.stringify({ ...config, block_lag_red: 0, relays: [] }));

  // Act and assert
  await assert.rejects(buildSite({ root, out }), (error) => {
    assert.match(error.message, /relays must be a non-empty list/);
    assert.match(error.message, /block_lag_red must be a positive integer/);
    return true;
  });
});

test('every URL of the site\'s own files carries one version, and the CDN script keeps its SRI', async (t) => {
  // Arrange
  const out = await mkdtemp(join(tmpdir(), 'semaforo-site-'));
  t.after(() => rm(out, { recursive: true, force: true }));

  // Act
  const { version } = await buildSite({ root: ROOT, out });

  // Assert
  assert.match(version, /^[0-9a-f]{12}$/);
  const html = await readFile(join(out, 'index.html'), 'utf8');
  assert.match(html, new RegExp(`<script type="module" src="app\\.js\\?v=${version}"></script>`));
  assert.match(html, new RegExp(`href="styles/base\\.css\\?v=${version}"`));
  assert.match(html, /src="https:\/\/cdn\.jsdelivr\.net\/npm\/nostr-tools@2\.25\.2\/lib\/nostr\.bundle\.js"\s+integrity="sha384-/);
  const app = await readFile(join(out, 'app.js'), 'utf8');
  assert.match(app, new RegExp(`from './src/dom\\.js\\?v=${version}'`));
  const view = await readFile(join(out, 'src/view.js'), 'utf8');
  assert.match(view, new RegExp(`from './reader\\.js\\?v=${version}'`));
  const css = await readFile(join(out, 'styles/base.css'), 'utf8');
  assert.match(css, new RegExp(`inter-latin-wght-normal\\.woff2\\?v=${version}`));
});

test('an instance that claims an avatar without its file in assets/avatars stops the build', async (t) => {
  // Arrange: a copy of the repository whose first instance claims an avatar.
  const root = await mkdtemp(join(tmpdir(), 'semaforo-root-'));
  const out = await mkdtemp(join(tmpdir(), 'semaforo-site-'));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(out, { recursive: true, force: true })]));
  for (const name of ['index.html', 'app.js', 'styles', 'config.json', 'CNAME', 'src', 'assets']) {
    await cp(join(ROOT, name), join(root, name), { recursive: true });
  }
  const trusted = JSON.parse(await readFile(join(ROOT, 'trusted.json'), 'utf8'));
  trusted.instances[0].avatar = true;
  await rm(join(root, 'assets', 'avatars'), { recursive: true, force: true });
  await writeFile(join(root, 'trusted.json'), JSON.stringify(trusted));

  // Act and assert
  await assert.rejects(buildSite({ root, out }), new RegExp(`assets/avatars/${trusted.instances[0].pubkey}\\.webp is missing`));
});
