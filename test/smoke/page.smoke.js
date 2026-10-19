// The smoke test: the page in a real browser, under its Content-Security-
// Policy, against a local relay serving signed events, with the CDN and the
// explorer answered locally so the test needs no network. It covers what
// the unit tests can't: app.js, dom.js and the page wiring.
//
// Run: npm run test:smoke (CHROMIUM_PATH may point at a Chromium binary).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { startRelay } from './relay.js';
import { startSite } from './server.js';
import { scenario, trustedList, dailyFor, key, TIP } from './fixtures.js';
import { buildCsp, externalScripts, injectCsp } from '../../scripts/csp.mjs';
import { parseConfig } from '../../src/config.js';

const CDN = 'https://cdn.jsdelivr.net/npm/nostr-tools@2.25.2/lib/nostr.bundle.js';
const EXPLORER = 'https://explorer.test/api/blocks/tip/height';
const BUNDLE = new URL('../../node_modules/nostr-tools/lib/nostr.bundle.js', import.meta.url);
const INDEX = new URL('../../index.html', import.meta.url);
const AVATAR = new URL('../../assets/mostro-96.webp', import.meta.url);

let browser;
let bundle;

before(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  bundle = await readFile(BUNDLE);
});

after(() => browser?.close());

/** Where the site at `siteUrl` serves the daily records, as the data branch would. */
const historyUrlOf = (siteUrl) => `${siteUrl}/history/`;

/** config.json for `relays`, with the routed explorer and the history on the site itself. */
async function configFor(relays, siteUrl) {
  const committed = JSON.parse(await readFile(new URL('../../config.json', import.meta.url), 'utf8'));
  return { ...committed, relays, explorers: { mainnet: [EXPLORER] }, history_url: historyUrlOf(siteUrl) };
}

/** The published index.html, its policy admitting the local relays and history. */
async function indexFor(rawConfig, trusted) {
  const html = await readFile(INDEX, 'utf8');
  const placeholders = { relays: ['wss://relay.placeholder'], history_url: 'https://history.placeholder/' };
  const { config } = parseConfig({ ...rawConfig, ...placeholders });
  const policy = buildCsp({ config, trusted, scripts: externalScripts(html) })
    .replace('wss://relay.placeholder', rawConfig.relays.join(' '))
    .replace('https://history.placeholder/', rawConfig.history_url);
  return injectCsp(html, policy);
}

/** A page on a site serving `relays`, with the CDN and explorer routed. */
async function openPage(relays, path = '/?lang=en') {
  const trusted = trustedList();
  const now = Math.floor(Date.now() / 1000);
  // Every instance has a history file under history_url, as on the data
  // branch: the green one a week with an outage, the others an empty one,
  // so no request is a 404 in the console.
  const histories = Object.fromEntries(trusted.instances.map((e) => [`/history/${e.pubkey}.json`, '[]']));
  histories[`/history/${key('green')}.json`] = JSON.stringify(dailyFor(now));
  const avatar = await readFile(AVATAR);
  const site = await startSite(async (siteUrl) => {
    const rawConfig = await configFor(relays, siteUrl);
    return {
      ...histories,
      [`/assets/avatars/${key('green')}.webp`]: avatar,
      '/config.json': JSON.stringify(rawConfig),
      '/trusted.json': JSON.stringify(trusted),
      '/index.html': await indexFor(rawConfig, { ...trusted, instances: trusted.instances.map((e) => ({ ...e, relays: [] })) }),
    };
  });
  const context = await browser.newContext();
  await context.route(CDN, (route) => route.fulfill({
    body: bundle, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' },
  }));
  await context.route(EXPLORER, (route) => route.fulfill({
    body: String(TIP), contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' },
  }));
  const page = await context.newPage();
  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.goto(`${site.url}${path}`);
  return { page, problems, close: () => Promise.all([context.close(), site.close()]) };
}

const rowWords = (page) => page.locator('#instances .status').allTextContents();

test('every state of the spec shows on one page, from signed events through the real page', async () => {
  // Arrange
  const relay = await startRelay(scenario(Math.floor(Date.now() / 1000)));
  const { page, problems, close } = await openPage([relay.url]);

  try {
    // Act
    await page.locator('#banner.state-red').waitFor({ timeout: 15000 });
    await page.locator('#watchers-summary', { hasText: '1 of 2' }).waitFor();
    // Drawing the state must keep the section's own classes.
    assert.match(await page.locator('#watchers').getAttribute('class'), /\bsection\b.*\bstate-yellow\b/);

    // Assert
    assert.equal(await page.locator('#banner-text').textContent(), '2 Mostros down');
    assert.deepEqual(await page.locator('#counts li').allTextContents(), ['1 operational', '1 degraded', '2 down']);
    assert.deepEqual(await page.locator('#instances .name').allTextContents(),
      ['Green Mostro', 'Maintenance Mostro', 'Down Mostro', 'Silent Mostro', 'New Mostro']);
    assert.deepEqual(await rowWords(page), ['✓Operational', '!Degraded', '✕Down', '✕Not reporting', '?Not monitored']);
    assert.deepEqual(await page.locator('#instances > li').nth(1).locator('.label').allTextContents(), ['Maintenance']);
    // The vetted avatar is served by the site itself; the others keep their initial.
    const avatar = page.locator('#instances > li').first().locator('.avatar img');
    assert.equal(await avatar.evaluate((img) => img.complete && img.naturalWidth > 0), true);
    assert.equal(await page.locator('#instances .avatar img').count(), 1);
    // Only the state is a live region; the counters would repeat it.
    assert.deepEqual(await page.locator('[aria-live]').evaluateAll((nodes) => nodes.map((n) => n.id)), ['banner-text']);
    assert.deepEqual(problems, []);
  } finally {
    await close();
    await relay.close();
  }
});

test('the details of a lagging instance name the failing checks and the lag', async () => {
  const relay = await startRelay(scenario(Math.floor(Date.now() / 1000)));
  const { page, problems, close } = await openPage([relay.url]);

  try {
    await page.locator('#banner.state-red').waitFor({ timeout: 15000 });
    const row = page.locator('#instances > li').nth(2);
    await row.locator('summary').click();

    const body = await row.locator('.body').innerText();
    assert.match(body, /LND sync\s+failing · since .* \(21 h 12 min\)/);
    assert.match(body, /899870 · tip 900000 at explorer\.test · 130 blocks behind/);
    assert.match(body, /Returned by 1 of 1 relays/);
    assert.match(await row.locator('a', { hasText: 'Verify it yourself' }).getAttribute('href'), /^https:\/\/nostrinspect\.com\/a\/naddr1/);
    assert.deepEqual(problems, []);
  } finally {
    await close();
    await relay.close();
  }
});

test('an open panel stays open across a redraw', async () => {
  const relay = await startRelay(scenario(Math.floor(Date.now() / 1000)));
  const { page, problems, close } = await openPage([relay.url]);

  try {
    await page.locator('#banner.state-red').waitFor({ timeout: 15000 });
    await page.locator('#instances summary').first().click();
    await page.locator('#instances summary').first().focus();
    const counter = await page.locator('#counts li').first().elementHandle();
    await page.waitForTimeout(5500);

    // Unchanged counters are left alone, not rebuilt on every redraw.
    assert.equal(await counter.evaluate((node) => node.isConnected), true);

    assert.equal(await page.locator('#instances details').first().getAttribute('open'), '');
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'SUMMARY');
    assert.deepEqual(problems, []);
  } finally {
    await close();
    await relay.close();
  }
});

test('a focused link in an open panel keeps the focus across a redraw', async () => {
  const relay = await startRelay(scenario(Math.floor(Date.now() / 1000)));
  const { page, problems, close } = await openPage([relay.url]);

  try {
    await page.locator('#banner.state-red').waitFor({ timeout: 15000 });
    const row = page.locator('#instances > li').nth(2);
    await row.locator('summary').click();
    await row.locator('a[data-focus="event"]').focus();
    await page.waitForTimeout(5500);

    const focused = await page.evaluate(() => document.activeElement?.dataset.focus ?? null);
    assert.equal(focused, 'event');
    assert.deepEqual(await page.locator('.watcher .icon').allTextContents(), ['✓', '✕']);
    assert.deepEqual(problems, []);
  } finally {
    await close();
    await relay.close();
  }
});

test('the language toggle switches to Spanish and keeps it in the URL', async () => {
  const relay = await startRelay(scenario(Math.floor(Date.now() / 1000)));
  const { page, problems, close } = await openPage([relay.url]);

  try {
    await page.locator('#banner.state-red').waitFor({ timeout: 15000 });
    await page.locator('#lang button[data-lang="es"]').click();

    await page.locator('#banner-text', { hasText: '2 Mostros caídos' }).waitFor();
    assert.match(page.url(), /lang=es/);
    assert.equal(await page.locator('html').getAttribute('lang'), 'es');
    assert.deepEqual(await rowWords(page), ['✓Operativo', '!Con problemas', '✕Caído', '✕Sin señal', '?Sin monitoreo']);
    assert.equal(await page.locator('#nav').getAttribute('aria-label'), 'Secciones');
    assert.equal(await page.locator('#foot-links').getAttribute('aria-label'), 'Enlaces');
    assert.deepEqual(problems, []);
  } finally {
    await close();
    await relay.close();
  }
});

test('with no relay reachable the page says it cannot verify, and never shows a colour', async () => {
  // A relay that is started and stopped leaves a port nothing listens on.
  const gone = await startRelay();
  await gone.close();
  const { page, problems, close } = await openPage([gone.url]);

  try {
    await page.locator('#banner-text', { hasText: 'Unable to verify status' }).waitFor({ timeout: 20000 });

    assert.equal(await page.locator('#banner').getAttribute('class'), 'banner state-grey');
    const words = await rowWords(page);
    assert.deepEqual(words.slice(0, 4), Array(4).fill('?Unable to verify'));
    assert.deepEqual(await page.locator('#counts li').allTextContents(), ['0 operational', '0 degraded', '0 down']);
    // The page's own failed connections are logged by the browser; nothing else.
    assert.deepEqual(problems.filter((p) => !p.includes('WebSocket')), []);
  } finally {
    await close();
  }
});

test('the bars, the uptime and the incident list come from the daily records', async () => {
  const relay = await startRelay(scenario(Math.floor(Date.now() / 1000)));
  const { page, problems, close } = await openPage([relay.url]);

  try {
    await page.locator('#banner.state-red').waitFor({ timeout: 15000 });
    const row = page.locator('#instances > li').first();
    await row.locator('.legend .uptime', { hasText: 'uptime' }).waitFor();

    // 90 bars, the last seven with data: four green, one red, two green.
    assert.equal(await row.locator('.bar').count(), 90);
    const states = await row.locator('.bar').evaluateAll((bars) => bars.slice(-7).map((b) => b.className.replace(/\s*wide-only/, '')));
    assert.deepEqual(states, ['bar state-green', 'bar state-green', 'bar state-green', 'bar state-green', 'bar state-red', 'bar state-green', 'bar state-green']);
    assert.equal(await row.locator('.bar.wide-only').count(), 60);
    // Five full days up, the 2 h 48 min before the outage, and today up to
    // now: from 85.28 % just after midnight UTC to 87.38 % just before. A
    // whole figure drops its decimals, as at about 07:25 and 19:04 UTC.
    assert.match(await row.locator('.legend .uptime').textContent(), /^8[0-9](\.[0-9]+)? % uptime$/);
    assert.match(await row.locator('.bars').getAttribute('aria-label'), /^Last 90 days: 8[0-9](\.[0-9]+)? % uptime$/);
    // A tap on the red bar writes its day under the bars.
    await row.locator('.bar.state-red').click();
    assert.match(await row.locator('.bar-detail').textContent(), /· Down · Operational 2 h 48 min · Down 21 h 11 min · LND not synced 21 h 12 min$/);
    // Each bar is a button named by its day's text, so a screen reader hears
    // the word for its colour; the group is one tab stop, and the arrow keys
    // walk the days from today.
    assert.equal(await row.locator('button.bar').count(), 90);
    assert.match(await row.locator('.bar.state-red').getAttribute('aria-label'), /^\d{4}-\d{2}-\d{2} · Down · /);
    assert.equal(await row.locator('.bar[tabindex="0"]').count(), 1);
    await row.locator('.bar').last().focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    assert.match(await row.locator('.bar-detail').textContent(), /· Down · Operational 2 h 48 min/);
    assert.equal(await row.locator('.bar.state-red').getAttribute('tabindex'), '0');
    await page.keyboard.press('End');
    assert.match(await row.locator('.bar-detail').textContent(), /· Operational · Operational /);
    // A row with no history has grey bars and no uptime.
    const quiet = page.locator('#instances > li').nth(3);
    assert.equal(await quiet.locator('.bar.state-grey').count(), 90);
    assert.equal(await quiet.locator('.legend .uptime').textContent(), '');
    // The incident list names the outage.
    assert.deepEqual(await page.locator('#incidents-list .name').allTextContents(), ['Green Mostro']);
    assert.deepEqual(await page.locator('#incidents-list .reason').allTextContents(), ['LND not synced']);
    assert.match(await page.locator('#incidents-list .meta').textContent(), / UTC · 21 h 12 min$/);
    // Colour is never the only signal: the incident says its state, with an icon.
    assert.equal(await page.locator('#incidents-list .state').textContent(), '✕Down');
    // The tab stop survives a redraw that changes every label: the bars are
    // updated in place, not remade. Switching the language is such a redraw.
    await row.locator('.bar').last().focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await row.locator('.bar.state-red').evaluate((bar) => { bar.dataset.mark = 'kept'; });
    await page.locator('#lang button[data-lang="es"]').click();
    await row.locator('.legend .uptime', { hasText: 'disponibilidad' }).waitFor();
    assert.equal(await row.locator('.bar.state-red').getAttribute('data-mark'), 'kept');
    assert.equal(await row.locator('.bar.state-red').getAttribute('tabindex'), '0');
    assert.match(await row.locator('.bar.state-red').getAttribute('aria-label'), /· Caído · /);
    // The text under the bars follows its day's new label, not the old one.
    assert.match(await row.locator('.bar-detail').textContent(), /· Caído · /);
    // A tab stop on a bar the phone layout hides moves to a bar still shown.
    await row.locator('.bar.state-red').focus();
    await page.keyboard.press('Home');
    assert.equal(await row.locator('.bar').first().getAttribute('tabindex'), '0');
    await page.setViewportSize({ width: 400, height: 900 });
    await row.locator('.bar[tabindex="0"]').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await row.locator('.bar[tabindex="0"]').count(), 1);
    assert.deepEqual(problems, []);
  } finally {
    await close();
    await relay.close();
  }
});
