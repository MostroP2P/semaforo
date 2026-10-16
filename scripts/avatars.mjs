// Fetches the avatar of each trusted Mostro and commits a vetted copy.
//
// The protocol puts an instance's avatar in the `picture` of its kind 0
// profile (other_events.md, "Mostro instance metadata"); the info event
// (kind 38385) has none. The page never loads that URL: every visitor's
// browser would contact a host the operator chose (SPEC § 4). Instead a
// maintainer runs this script, which, for each trusted instance:
//
// 1. reads its newest kind 0 profile from the configured relays and checks
//    the signature;
// 2. downloads `picture` (https only, at most 2 MB, 15 s);
// 3. checks the first bytes are PNG, JPEG, WebP or GIF, and re-encodes the
//    image in a headless Chromium to a 128 × 128 WebP, which drops metadata
//    and anything else the file carried;
// 4. writes assets/avatars/<hex pubkey>.webp and sets `avatar: true` in
//    trusted.json, and records the SHA-256 of the downloaded picture in
//    avatar-sources/<hex pubkey>.sha256.
//
// A picture whose bytes match the recorded SHA-256, with its copy still in
// place, is left alone. The fingerprint is taken from the source, not the
// copy, because the re-encoding is not guaranteed to give the same bytes
// on another machine or another Chromium: comparing copies would propose
// a "changed" avatar on every run of the avatars workflow.
//
// The result goes to a pull request, where the pictures are looked at
// before they are served. `.github/workflows/avatars.yml` runs this script
// after every merge and once a week, one instance at a time, and opens
// that pull request itself, one per avatar. Each fingerprint has a file of
// its own so that two of those pull requests never touch the same file.
//
// Usage: node scripts/avatars.mjs [hex pubkey ...] [--summary <file>]
//   (default: every instance; --summary writes a pull request body naming
//   the avatars it copied, when it copied any)
// Needs `npm ci` and `npx playwright-core install chromium` (or CHROMIUM_PATH).

import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseConfig, parseTrusted, relayUrls } from '../src/config.js';

/** Where the SHA-256 of each copied picture is kept, one file per instance; not part of the site. */
const SOURCES_DIR = 'avatar-sources';
const SHA256_HEX = /^[0-9a-f]{64}$/;

const MAX_URL_LENGTH = 2048;
const MAX_BYTES = 2 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;
const RELAY_WAIT_MS = 8000;
export const AVATAR_SIZE = 128;

function verifies(event, verify) {
  try {
    return verify(event) === true;
  } catch {
    return false;
  }
}

/** The https URL in the `picture` of a signed kind 0 profile of `pubkey`, or null. */
export function pictureFromProfile(event, pubkey, verify) {
  if (!event || event.kind !== 0 || event.pubkey !== pubkey || !verifies(event, verify)) return null;
  let content;
  try {
    content = JSON.parse(event.content);
  } catch {
    return null;
  }
  const picture = content && typeof content === 'object' ? content.picture : undefined;
  if (typeof picture !== 'string' || picture.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(picture);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** The newest of `events` by created_at, the lower id on a tie, or null. */
export function newestProfile(events) {
  return events.reduce((best, e) => (
    !best || e.created_at > best.created_at || (e.created_at === best.created_at && e.id < best.id) ? e : best
  ), null);
}

const startsWith = (bytes, values, offset = 0) => values.every((v, i) => bytes[offset + i] === v);
const ascii = (text) => [...text].map((c) => c.charCodeAt(0));

/** The format of an image from its first bytes: png, jpeg, webp, gif, or null. */
export function imageType(bytes) {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'webp';
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'gif';
  return null;
}

/**
 * The response for `url`, following at most MAX_REDIRECTS redirects by hand:
 * each destination is checked to be https before anything is asked of it,
 * so a picture can never be fetched over plain http, even through a redirect.
 */
async function fetchHttps(url, fetchImpl) {
  let current = url;
  for (let hops = 0; hops <= MAX_REDIRECTS; hops += 1) {
    if (new URL(current).protocol !== 'https:') throw new Error(`${current} is not https`);
    const response = await fetchImpl(current, {
      redirect: 'manual',
      credentials: 'omit',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) throw new Error(`redirect with no location from ${current}`);
    current = new URL(location, current).href;
  }
  throw new Error('too many redirects');
}

/**
 * The body of the picture at `url`: https at every hop, refused past
 * MAX_BYTES or past DOWNLOAD_TIMEOUT_MS per request.
 */
export async function download(url, fetchImpl = fetch) {
  const response = await fetchHttps(url, fetchImpl);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('larger than 2 MB');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error('larger than 2 MB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** `bytes` decoded in the browser and redrawn as a square WebP, centre-cropped. */
async function reencode(page, bytes, type) {
  const base64 = await page.evaluate(async ({ data, mime, size }) => {
    const blob = await (await fetch(`data:${mime};base64,${data}`)).blob();
    const image = await createImageBitmap(blob);
    const side = Math.min(image.width, image.height);
    const canvas = new OffscreenCanvas(size, size);
    canvas.getContext('2d').drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, size, size);
    const out = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
    const view = new Uint8Array(await out.arrayBuffer());
    let binary = '';
    for (const byte of view) binary += String.fromCharCode(byte);
    return btoa(binary);
  }, { data: bytes.toString('base64'), mime: `image/${type}`, size: AVATAR_SIZE });
  const webp = Buffer.from(base64, 'base64');
  if (imageType(webp) !== 'webp') throw new Error('the browser did not produce a WebP');
  return webp;
}

/**
 * The relays the profiles are read from: the configured ones and the
 * selected instances' own, the same set the page reads.
 */
export function profileRelays(config, instances) {
  return relayUrls(config, { instances });
}

async function fetchProfiles(relays, pubkeys) {
  const { SimplePool } = await import('nostr-tools');
  const pool = new SimplePool();
  try {
    return await pool.querySync(relays, { kinds: [0], authors: pubkeys }, { maxWait: RELAY_WAIT_MS });
  } finally {
    pool.close(relays);
  }
}

/** The SHA-256 of a picture's bytes, in hex: what says whether it changed since it was copied. */
export function pictureDigest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * What one instance's avatar needs, from its newest profile: `no-picture`
 * (any copy is left alone), `unchanged` (the picture's bytes match the
 * fingerprint of a copy still in place), or `copied`, with the new WebP and
 * the fingerprint to record. A refused download or image throws, naming the URL.
 */
export async function refreshAvatar({ pubkey, profile, recorded, copyExists, verify, fetchPicture = download, encode }) {
  const url = pictureFromProfile(profile, pubkey, verify);
  if (!url) return { status: 'no-picture' };
  try {
    const bytes = await fetchPicture(url);
    const digest = pictureDigest(bytes);
    if (copyExists && recorded === digest) return { status: 'unchanged', url };
    const type = imageType(bytes);
    if (!type) throw new Error('not a PNG, JPEG, WebP or GIF');
    return { status: 'copied', url, digest, webp: await encode(bytes, type) };
  } catch (error) {
    throw new Error(`${url}: ${error.message}`, { cause: error });
  }
}

/** The file, relative to the repository, holding the fingerprint of `pubkey`'s copy. */
export function sourceFile(pubkey) {
  return `${SOURCES_DIR}/${pubkey}.sha256`;
}

/** The SHA-256 a fingerprint file holds; anything else is refused rather than read as "no fingerprint". */
export function parseSource(text) {
  const digest = text.trim();
  if (!SHA256_HEX.test(digest)) throw new Error('not a SHA-256 in lowercase hex');
  return digest;
}

/** The instances to refresh (none given: every one) and where to write the summary, if anywhere. */
export function parseArguments(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: { summary: { type: 'string' } }, allowPositionals: true });
  return { only: positionals, summary: values.summary ?? null };
}

const shortKey = (pubkey) => `${pubkey.slice(0, 8)}…${pubkey.slice(-8)}`;

/**
 * The pull request body for the avatars a run copied. Names and keys come
 * from trusted.json, never from a profile, which anyone could have written.
 */
export function summary(copies) {
  const lines = copies.map(({ name, pubkey, first }) =>
    `- **${name}** (\`${shortKey(pubkey)}\`): ${first ? 'no fingerprint of its picture yet' : 'its profile picture changed'}`);
  return [
    '`scripts/avatars.mjs` copied these avatars again from the picture in each instance\'s kind 0 profile:',
    '',
    ...lines,
    '',
    'Look at every picture before merging (SPEC § 4): once merged, it is served with the site.',
    '',
  ].join('\n');
}

/** The recorded fingerprint of `pubkey`'s copy; null when it has none yet. */
async function readSource(root, pubkey) {
  try {
    return parseSource(await readFile(join(root, sourceFile(pubkey)), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`${sourceFile(pubkey)}: ${error.message}`, { cause: error });
  }
}

const exists = (path) => access(path).then(() => true, () => false);

/** Each instance's copy refreshed in turn; a failure is reported and leaves that copy as it was. */
async function copyAvatars({ root, instances, events, verify, encode }) {
  const copies = [];
  for (const entry of instances) {
    const label = `${entry.name} (${entry.pubkey.slice(0, 8)})`;
    const file = join(root, 'assets', 'avatars', `${entry.pubkey}.webp`);
    try {
      const recorded = await readSource(root, entry.pubkey);
      const result = await refreshAvatar({
        pubkey: entry.pubkey,
        profile: newestProfile(events.filter((e) => e.pubkey === entry.pubkey)),
        recorded,
        copyExists: entry.avatar === true && await exists(file),
        verify,
        encode,
      });
      if (result.status === 'no-picture') console.log(`- ${label}: no usable picture in its profile`);
      if (result.status === 'unchanged') console.log(`= ${label}: ${result.url} unchanged`);
      if (result.status !== 'copied') continue;
      await writeFile(file, result.webp);
      await writeFile(join(root, sourceFile(entry.pubkey)), `${result.digest}\n`);
      entry.avatar = true;
      copies.push({ name: entry.name, pubkey: entry.pubkey, first: recorded === null });
      console.log(`✓ ${label}: ${result.url} → ${result.webp.length} bytes`);
    } catch (error) {
      console.log(`✗ ${label}: ${error.message}`);
    }
  }
  return copies;
}

async function main(root, argv) {
  const { only, summary: summaryPath } = parseArguments(argv);
  const { verifyEvent } = await import('nostr-tools');
  const { chromium } = await import('playwright-core');
  const trustedPath = join(root, 'trusted.json');
  const trusted = JSON.parse(await readFile(trustedPath, 'utf8'));
  // Both files are validated first; the raw list is the one written back,
  // so its order and fields stay as the maintainers wrote them.
  const config = parseConfig(JSON.parse(await readFile(join(root, 'config.json'), 'utf8')));
  const parsed = parseTrusted(trusted);
  if (!config.valid || !parsed.valid) throw new Error([...(config.errors ?? []), ...(parsed.errors ?? [])].join('\n'));
  const instances = trusted.instances.filter((entry) => !only.length || only.includes(entry.pubkey));
  const selected = parsed.trusted.instances.filter((entry) => instances.some((e) => e.pubkey === entry.pubkey));
  const events = await fetchProfiles(profileRelays(config.config, selected), instances.map((entry) => entry.pubkey));
  await mkdir(join(root, 'assets', 'avatars'), { recursive: true });
  await mkdir(join(root, SOURCES_DIR), { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  let copies;
  try {
    const page = await browser.newPage();
    copies = await copyAvatars({ root, instances, events, verify: verifyEvent, encode: (bytes, type) => reencode(page, bytes, type) });
  } finally {
    await browser.close();
  }
  await writeFile(trustedPath, `${JSON.stringify(trusted, null, 2)}\n`);
  if (summaryPath && copies.length) await writeFile(summaryPath, summary(copies));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(fileURLToPath(new URL('..', import.meta.url)), process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
