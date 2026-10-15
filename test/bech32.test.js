import { test } from 'node:test';
import assert from 'node:assert/strict';
import { npubEncode, neventEncode, shortNpub } from '../src/bech32.js';

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

test('an nevent carries the event id, a relay and the author', () => {
  // Arrange: the NIP-19 TLV layout, decoded by hand from the bech32 words.
  const id = 'e'.repeat(64);

  // Act
  const nevent = neventEncode({ id, relays: ['wss://relay.mostro.network'], author: EUROPA_HEX });

  // Assert
  assert.match(nevent, /^nevent1[02-9ac-hj-np-z]+$/);
  const bytes = decodeWords(nevent);
  assert.deepEqual([...bytes.slice(0, 2)], [0, 32]);
  assert.equal(Buffer.from(bytes.slice(2, 34)).toString('hex'), id);
  const relayLength = bytes[35];
  assert.deepEqual([bytes[34], relayLength], [1, 26]);
  assert.equal(Buffer.from(bytes.slice(36, 36 + relayLength)).toString(), 'wss://relay.mostro.network');
  const after = 36 + relayLength;
  assert.deepEqual([...bytes.slice(after, after + 2)], [2, 32]);
  assert.equal(Buffer.from(bytes.slice(after + 2, after + 34)).toString('hex'), EUROPA_HEX);
});

test('a key that is not 64 lowercase hex characters is refused', () => {
  assert.throws(() => npubEncode('xyz'), /hex/);
  assert.throws(() => neventEncode({ id: 'E'.repeat(64), relays: [], author: EUROPA_HEX }), /hex/);
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
