import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pictureFromProfile, newestProfile, imageType } from '../scripts/avatars.mjs';

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
