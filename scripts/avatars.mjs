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
//    trusted.json.
//
// The result goes to a pull request, where the pictures are looked at
// before they are served.
//
// Usage: node scripts/avatars.mjs [hex pubkey ...]   (default: every instance)
// Needs `npm ci` and `npx playwright-core install chromium` (or CHROMIUM_PATH).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_URL_LENGTH = 2048;
const MAX_BYTES = 2 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15000;
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

/** The body of `url`, refused past MAX_BYTES, off https or too slow. */
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), credentials: 'omit' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (new URL(response.url).protocol !== 'https:') throw new Error('redirected off https');
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

async function fetchProfiles(relays, pubkeys) {
  const { SimplePool } = await import('nostr-tools');
  const pool = new SimplePool();
  try {
    return await pool.querySync(relays, { kinds: [0], authors: pubkeys }, { maxWait: RELAY_WAIT_MS });
  } finally {
    pool.close(relays);
  }
}

async function main(root, only) {
  const { verifyEvent } = await import('nostr-tools');
  const { chromium } = await import('playwright-core');
  const trustedPath = join(root, 'trusted.json');
  const trusted = JSON.parse(await readFile(trustedPath, 'utf8'));
  const config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'));
  const instances = trusted.instances.filter((entry) => !only.length || only.includes(entry.pubkey));
  const events = await fetchProfiles(config.relays, instances.map((entry) => entry.pubkey));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage();
  await mkdir(join(root, 'assets', 'avatars'), { recursive: true });
  try {
    for (const entry of instances) {
      const label = `${entry.name} (${entry.pubkey.slice(0, 8)})`;
      const profile = newestProfile(events.filter((e) => e.pubkey === entry.pubkey));
      const url = pictureFromProfile(profile, entry.pubkey, verifyEvent);
      if (!url) {
        console.log(`- ${label}: no usable picture in its profile`);
        continue;
      }
      try {
        const bytes = await download(url);
        const type = imageType(bytes);
        if (!type) throw new Error('not a PNG, JPEG, WebP or GIF');
        const webp = await reencode(page, bytes, type);
        await writeFile(join(root, 'assets', 'avatars', `${entry.pubkey}.webp`), webp);
        entry.avatar = true;
        console.log(`✓ ${label}: ${url} → ${webp.length} bytes`);
      } catch (error) {
        console.log(`✗ ${label}: ${url}: ${error.message}`);
      }
    }
  } finally {
    await browser.close();
  }
  await writeFile(trustedPath, `${JSON.stringify(trusted, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(fileURLToPath(new URL('..', import.meta.url)), process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
