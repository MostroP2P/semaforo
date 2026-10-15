import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCsp, externalScripts, injectCsp, CSP_MARKER } from '../scripts/csp.mjs';

const CDN = 'https://cdn.jsdelivr.net/npm/nostr-tools@2.25.2/lib/nostr.bundle.js';
const HTML = `<head>\n  ${CSP_MARKER}\n  <script src="${CDN}" integrity="sha384-x" crossorigin="anonymous" defer></script>\n  <script type="module" src="app.js"></script>\n</head>`;
const config = {
  relays: ['wss://relay.mostro.network', 'wss://mostro-p2p.tech'],
  explorers: new Map([['mainnet', ['https://mempool.space/api/blocks/tip/height', 'https://blockstream.info/api/blocks/tip/height']]]),
};
const trusted = { instances: [{ relays: ['wss://extra.example'] }, { relays: ['wss://mostro-p2p.tech'] }], watchers: [] };

test('the external scripts of the page are the https sources of its script tags', () => {
  assert.deepEqual(externalScripts(HTML), [CDN]);
});

test('the policy allows only the page, the pinned script, the relays and the explorers', () => {
  // Act
  const policy = buildCsp({ config, trusted, scripts: [CDN] });

  // Assert
  assert.deepEqual(policy.split('; '), [
    "default-src 'none'",
    `script-src 'self' ${CDN}`,
    "style-src 'self'",
    "img-src 'self'",
    "connect-src 'self' wss://relay.mostro.network wss://mostro-p2p.tech wss://extra.example "
      + 'https://mempool.space/api/blocks/tip/height https://blockstream.info/api/blocks/tip/height',
    "base-uri 'none'",
    "form-action 'none'",
  ]);
});

test('a relay that is not wss can never be published', () => {
  const local = { ...config, relays: ['ws://localhost:10547'] };

  assert.throws(() => buildCsp({ config: local, trusted, scripts: [CDN] }), /ws:\/\/localhost:10547 is not a wss relay/);
});

test('a script that is not pinned to an exact https URL is refused', () => {
  assert.throws(() => buildCsp({ config, trusted, scripts: ['http://cdn.example/x.js'] }), /not an https script/);
});

test('the policy replaces the marker as a meta tag', () => {
  const html = injectCsp(HTML, "default-src 'none'");

  assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'">`));
  assert.equal(html.includes(CSP_MARKER), false);
});

test('a page without the marker, or with it twice, is refused rather than published without a policy', () => {
  assert.throws(() => injectCsp('<head></head>', 'x'), /exactly one/);
  assert.throws(() => injectCsp(`${CSP_MARKER}${CSP_MARKER}`, 'x'), /exactly one/);
});

test('a policy with a double quote cannot break out of the attribute', () => {
  assert.throws(() => injectCsp(HTML, 'default-src "x'), /quote/);
});
