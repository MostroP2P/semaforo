import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pictureFromProfile, newestProfile, imageType, download, profileRelays } from '../scripts/avatars.mjs';

const PK = 'a'.repeat(64);
const yes = () => true;
const profile = (content, overrides = {}) => ({
  id: 'e'.repeat(64), pubkey: PK, kind: 0, created_at: 1792000000, tags: [], content: JSON.stringify(content), sig: 'f'.repeat(128), ...overrides,
});

test('the picture of a signed kind 0 profile is its https URL', () => {
  assert.equal(pictureFromProfile(profile({ picture: 'https://example.com/m.png' }), PK, yes), 'https://example.com/m.png');
});

test('a profile from another key, another kind or with a bad signature gives no picture', () => {
  const event = profile({ picture: 'https://example.com/m.png' });

  assert.equal(pictureFromProfile(event, 'b'.repeat(64), yes), null);
  assert.equal(pictureFromProfile({ ...event, kind: 38385 }, PK, yes), null);
  assert.equal(pictureFromProfile(event, PK, () => false), null);
  assert.equal(pictureFromProfile(event, PK, () => { throw new Error('bad hex'); }), null);
});

test('a picture that is not a plain https URL is refused', () => {
  for (const picture of ['http://example.com/m.png', 'data:image/png;base64,AAAA', 'javascript:alert(1)',
    'https://user:pass@example.com/m.png', 'not a url', 7, `https://example.com/${'a'.repeat(3000)}`]) {
    assert.equal(pictureFromProfile(profile({ picture }), PK, yes), null, String(picture).slice(0, 40));
  }
});

test('a profile whose content is not JSON, or has no picture, gives none', () => {
  assert.equal(pictureFromProfile({ ...profile({}), content: '{not json' }, PK, yes), null);
  assert.equal(pictureFromProfile(profile({ name: 'Mostro' }), PK, yes), null);
  assert.equal(pictureFromProfile({ ...profile({}), content: '"just a string"' }, PK, yes), null);
});

test('the newest profile wins, and on the same second the lower id', () => {
  const at = (createdAt, id) => ({ created_at: createdAt, id });

  assert.deepEqual(newestProfile([at(1, 'b'), at(3, 'c'), at(2, 'a')]), at(3, 'c'));
  assert.deepEqual(newestProfile([at(3, 'b'), at(3, 'a')]), at(3, 'a'));
  assert.equal(newestProfile([]), null);
});

test('an image is recognised by its first bytes, and anything else, SVG included, is refused', () => {
  const bytes = (...values) => Uint8Array.from(values);
  const ascii = (text) => [...text].map((c) => c.charCodeAt(0));

  assert.equal(imageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), 'png');
  assert.equal(imageType(bytes(0xff, 0xd8, 0xff, 0xe0)), 'jpeg');
  assert.equal(imageType(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'))), 'webp');
  assert.equal(imageType(bytes(...ascii('GIF89a'))), 'gif');
  assert.equal(imageType(bytes(...ascii('<svg xmlns="http://www.w3.org/2000/svg">'))), null);
  assert.equal(imageType(bytes(1, 2)), null);
});

/** A fetch that answers from `routes` and records every URL it is asked for. */
function fakeFetch(routes) {
  const asked = [];
  const fetchImpl = async (url, options) => {
    asked.push(url);
    assert.equal(options.redirect, 'manual', 'redirects are never followed blindly');
    const route = routes[url];
    if (!route) throw new Error(`unexpected request to ${url}`);
    const headers = new Map(Object.entries(route.headers ?? {}));
    return {
      status: route.status ?? 200,
      ok: (route.status ?? 200) < 300,
      url,
      headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
      body: (async function* body() {
        for (const chunk of route.chunks ?? []) yield chunk;
      }()),
    };
  };
  return { fetchImpl, asked };
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('a picture is downloaded over https, following an https redirect', async () => {
  const { fetchImpl, asked } = fakeFetch({
    'https://a.example/m.png': { status: 302, headers: { location: '/real.png' } },
    'https://a.example/real.png': { chunks: [PNG] },
  });

  const bytes = await download('https://a.example/m.png', fetchImpl);

  assert.deepEqual(bytes, PNG);
  assert.deepEqual(asked, ['https://a.example/m.png', 'https://a.example/real.png']);
});

test('a redirect to plain http is refused before anything is asked of it', async () => {
  const { fetchImpl, asked } = fakeFetch({
    'https://a.example/m.png': { status: 301, headers: { location: 'http://a.example/m.png' } },
  });

  await assert.rejects(download('https://a.example/m.png', fetchImpl), /not https/);
  assert.deepEqual(asked, ['https://a.example/m.png']);
});

test('a chain of more than five redirects is refused', async () => {
  const routes = {};
  for (let i = 0; i < 7; i += 1) routes[`https://a.example/${i}`] = { status: 302, headers: { location: `/${i + 1}` } };
  const { fetchImpl } = fakeFetch(routes);

  await assert.rejects(download('https://a.example/0', fetchImpl), /too many redirects/);
});

test('a redirect without a location, an HTTP error or a body past 2 MB is refused', async () => {
  const big = Buffer.alloc(1024 * 1024);
  const { fetchImpl } = fakeFetch({
    'https://a.example/no-location': { status: 302 },
    'https://a.example/error': { status: 404 },
    'https://a.example/big': { chunks: [big, big, big] },
    'https://a.example/declared': { headers: { 'content-length': String(3 * 1024 * 1024) }, chunks: [PNG] },
  });

  await assert.rejects(download('https://a.example/no-location', fetchImpl), /no location/);
  await assert.rejects(download('https://a.example/error', fetchImpl), /HTTP 404/);
  await assert.rejects(download('https://a.example/big', fetchImpl), /larger than 2 MB/);
  await assert.rejects(download('https://a.example/declared', fetchImpl), /larger than 2 MB/);
});

test('the profiles are read from the configured relays and the selected instances\' own relays', () => {
  const config = { relays: ['wss://global.example'] };
  const instances = [{ relays: ['wss://own.example/'] }, { relays: [] }];

  assert.deepEqual(profileRelays(config, instances), ['wss://global.example/', 'wss://own.example/']);
});
