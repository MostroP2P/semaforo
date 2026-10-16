import { test } from 'node:test';
import assert from 'node:assert/strict';
import { npubEncode, naddrEncode, shortNpub } from '../src/bech32.js';

// Vectors from MostroP2P/community, where each key is listed as an npub.
const ESPANA_HEX = '0000cc02101ec29eea9ce623258752b9d7da66c27845ed26846dd0b0fc736b40';
const ESPANA_NPUB = 'npub1qqqvcqssrmpfa65uuc3jtp6jh8ta5ekz0pz76f5ydhgtplrnddqqrqe7xr';
const EUROPA_HEX = 'da23a31d75572138ab8149911a04224812a34bda679caba7cb1824fdf7c592ec';
const EUROPA_NPUB = 'npub1mg36x8t42usn32upfxg35ppzfqf2xj76v7w2hf7trqj0ma79jtkqrj3q9m';

test('a hex key encodes to the npub its owner publishes', () => {
  assert.equal(npubEncode(ESPANA_HEX), ESPANA_NPUB);
  assert.equal(npubEncode(EUROPA_HEX), EUROPA_NPUB);
});

test('a short npub keeps the start and the end', () => {
  assert.equal(shortNpub(EUROPA_HEX), 'npub1mg36x8t…rj3q9m');
});

test('an naddr carries the identifier, a relay, the author and the kind', () => {
  // Arrange: the NIP-19 TLV layout, decoded by hand from the bech32 words.
  const relay = 'wss://relay.mostro.network';

  // Act
  const naddr = naddrEncode({ kind: 38389, author: EUROPA_HEX, identifier: EUROPA_HEX, relays: [relay] });

  // Assert
  assert.match(naddr, /^naddr1[02-9ac-hj-np-z]+$/);
  const bytes = decodeWords(naddr);
  // The d tag is text: a hex key goes in as its 64 characters, not as 32 bytes.
  assert.deepEqual([...bytes.slice(0, 2)], [0, 64]);
  assert.equal(Buffer.from(bytes.slice(2, 66)).toString(), EUROPA_HEX);
  assert.deepEqual([...bytes.slice(66, 68)], [1, relay.length]);
  assert.equal(Buffer.from(bytes.slice(68, 68 + relay.length)).toString(), relay);
  const after = 68 + relay.length;
  assert.deepEqual([...bytes.slice(after, after + 2)], [2, 32]);
  assert.equal(Buffer.from(bytes.slice(after + 2, after + 34)).toString('hex'), EUROPA_HEX);
  assert.deepEqual([...bytes.slice(after + 34)], [3, 4, 0x00, 0x00, 0x95, 0xf5]);
});

test('a key that is not 64 lowercase hex characters is refused', () => {
  assert.throws(() => npubEncode('xyz'), /hex/);
  assert.throws(() => naddrEncode({ kind: 38389, author: 'E'.repeat(64), identifier: '', relays: [] }), /hex/);
});

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/** The data bytes of a bech32 string, checksum dropped, for the test above. */
function decodeWords(text) {
  const words = [...text.slice(text.lastIndexOf('1') + 1, -6)].map((c) => CHARSET.indexOf(c));
  const bytes = [];
  let acc = 0;
  let bits = 0;
  for (const word of words) {
    acc = (acc << 5) | word;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 255);
    }
  }
  return bytes;
}

test('a relay hint longer than 255 bytes is left out instead of corrupting the naddr', () => {
  const long = `wss://${'a'.repeat(300)}.example`;
  const address = { kind: 38389, author: EUROPA_HEX, identifier: EUROPA_HEX };

  assert.equal(naddrEncode({ ...address, relays: [long] }), naddrEncode({ ...address, relays: [] }));
});

test('an identifier longer than 255 bytes is refused instead of corrupting the naddr', () => {
  // Arrange: the limit is in bytes, so 128 two-byte characters are already too many.
  const address = { kind: 38389, author: EUROPA_HEX, relays: [] };

  // Act
  const longest = decodeWords(naddrEncode({ ...address, identifier: 'a'.repeat(255) }));

  // Assert
  assert.deepEqual([...longest.slice(0, 2)], [0, 255]);
  assert.throws(() => naddrEncode({ ...address, identifier: 'a'.repeat(256) }), /255 bytes/);
  assert.throws(() => naddrEncode({ ...address, identifier: 'é'.repeat(128) }), /255 bytes/);
});
