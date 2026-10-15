// The NIP-19 encodings the page shows: an npub for a key, and an nevent for
// the "verify it yourself" link. bech32 per BIP-173, with no length limit
// as NIP-19 requires. Pure, so the page needs nothing else to name a key.

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const HEX_KEY = /^[0-9a-f]{64}$/;

function polymod(values) {
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    GENERATOR.forEach((g, i) => {
      if ((top >> i) & 1) chk ^= g;
    });
  }
  return chk;
}

function hrpExpand(hrp) {
  const codes = [...hrp].map((c) => c.charCodeAt(0));
  return [...codes.map((c) => c >> 5), 0, ...codes.map((c) => c & 31)];
}

/** 8-bit bytes to 5-bit words, padding the last one. */
function toWords(bytes) {
  const words = [];
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((acc >> bits) & 31);
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) words.push((acc << (5 - bits)) & 31);
  return words;
}

function encode(hrp, bytes) {
  const words = toWords(bytes);
  const mod = polymod([...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = [0, 1, 2, 3, 4, 5].map((i) => (mod >> (5 * (5 - i))) & 31);
  return `${hrp}1${[...words, ...checksum].map((w) => CHARSET[w]).join('')}`;
}

function hexBytes(hex) {
  if (typeof hex !== 'string' || !HEX_KEY.test(hex)) throw new TypeError('expected 64 lowercase hex characters');
  return Array.from({ length: 32 }, (_, i) => Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16));
}

/** The npub of a hex public key. */
export function npubEncode(hex) {
  return encode('npub', hexBytes(hex));
}

/** "npub1mg36x8t…rj3q9m": enough to recognise a key, short enough for a row. */
export function shortNpub(hex) {
  const npub = npubEncode(hex);
  return `${npub.slice(0, 12)}…${npub.slice(-6)}`;
}

/** The nevent of an event id with relay hints and its author (NIP-19 TLV). */
export function neventEncode({ id, relays, author }) {
  const bytes = [0, 32, ...hexBytes(id)];
  const encoder = new TextEncoder();
  for (const relay of relays) {
    const encoded = [...encoder.encode(relay)];
    bytes.push(1, encoded.length, ...encoded);
  }
  bytes.push(2, 32, ...hexBytes(author));
  return encode('nevent', bytes);
}
