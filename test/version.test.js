import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionHtml, versionCss, versionJs, buildVersion } from '../scripts/version.mjs';

const V = 'abc123def456';

test('the page\'s own files get the version, external URLs, anchors and the home link do not', () => {
  // Arrange
  const html = [
    '<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">',
    '<link rel="preload" href="assets/fonts/inter.woff2" as="font">',
    '<link rel="stylesheet" href="styles/base.css">',
    '<script src="https://cdn.jsdelivr.net/npm/nostr-tools@2.25.2/lib/nostr.bundle.js" integrity="x"></script>',
    '<script type="module" src="app.js"></script>',
    '<a class="brand" href="./">',
    '<img src="assets/mostro-96.webp" alt="">',
    '<a href="#how">',
    '<a href="https://mostro.network">',
  ].join('\n');

  // Act
  const result = versionHtml(html, V);

  // Assert
  assert.equal(result, [
    `<link rel="icon" href="assets/favicon.svg?v=${V}" type="image/svg+xml">`,
    `<link rel="preload" href="assets/fonts/inter.woff2?v=${V}" as="font">`,
    `<link rel="stylesheet" href="styles/base.css?v=${V}">`,
    '<script src="https://cdn.jsdelivr.net/npm/nostr-tools@2.25.2/lib/nostr.bundle.js" integrity="x"></script>',
    `<script type="module" src="app.js?v=${V}"></script>`,
    '<a class="brand" href="./">',
    `<img src="assets/mostro-96.webp?v=${V}" alt="">`,
    '<a href="#how">',
    '<a href="https://mostro.network">',
  ].join('\n'));
});

test('a stylesheet\'s relative url() gets the version', () => {
  const css = 'src: url("../assets/fonts/inter.woff2") format("woff2"); background: url(https://x.example/a.png);';

  assert.equal(versionCss(css, V), `src: url("../assets/fonts/inter.woff2?v=${V}") format("woff2"); background: url(https://x.example/a.png);`);
});

test('static and dynamic relative imports get the version, packages do not', () => {
  const js = [
    "import { a } from './src/config.js';",
    "import en from './i18n/en.js';",
    "import { b } from '../scripts/csp.mjs';",
    "import { c } from 'node:fs';",
    "const d = await import('./src/view.js');",
  ].join('\n');

  assert.equal(versionJs(js, V), [
    `import { a } from './src/config.js?v=${V}';`,
    `import en from './i18n/en.js?v=${V}';`,
    `import { b } from '../scripts/csp.mjs?v=${V}';`,
    "import { c } from 'node:fs';",
    `const d = await import('./src/view.js?v=${V}');`,
  ].join('\n'));
});

test('the version is a short hash of the published files, so any change gives a new one', () => {
  const one = buildVersion([Buffer.from('a'), Buffer.from('b')]);

  assert.match(one, /^[0-9a-f]{12}$/);
  assert.equal(buildVersion([Buffer.from('a'), Buffer.from('b')]), one);
  assert.notEqual(buildVersion([Buffer.from('a'), Buffer.from('c')]), one);
});
