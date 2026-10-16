// Draws the page view (view.js) into the document. Every value from the
// network is set with textContent, never as HTML. Rows are created once per
// instance and updated in place, so an open details panel and the keyboard
// focus survive each refresh.

import { PHONE_DAYS } from './view.js';

/** An element with attributes and children (strings become text nodes). */
export function el(doc, tag, attrs = {}, ...children) {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' || typeof child === 'number' ? doc.createTextNode(String(child)) : child);
  }
  return node;
}

function byId(doc, id) {
  return doc.getElementById(id);
}

/**
 * Writes `text` only when it changed: the page redraws every few seconds,
 * and rewriting the same text would make a live region announce it again.
 * A missing element is skipped: a cached page from an older deploy may lack
 * it, and the rest of the page must still be drawn.
 */
export function setText(doc, id, text) {
  const node = byId(doc, id);
  if (node && node.textContent !== text) node.textContent = text;
}

/** Sets an attribute on the element `id`, if the page has it. */
function setAttr(doc, id, name, value) {
  byId(doc, id)?.setAttribute(name, value);
}

/** The words of the page that don't depend on the data. */
export function renderStatic(doc, t, lang) {
  doc.documentElement.lang = lang;
  doc.title = t.title;
  doc.querySelector('meta[name="description"]')?.setAttribute('content', t.description);
  setText(doc, 'heading', t.heading);
  setText(doc, 'hero-badge-text', t.badge);
  setText(doc, 'hero-sub', t.description);
  setText(doc, 'nav-instances', t.nav.instances);
  setText(doc, 'nav-watchers', t.nav.watchers);
  setText(doc, 'nav-how', t.nav.how);
  setText(doc, 'how-title', t.how.title);
  setText(doc, 'how-lead', t.how.lead);
  for (const step of ['one', 'two', 'three']) {
    setText(doc, `how-${step}-title`, t.how[`${step}Title`]);
    setText(doc, `how-${step}-text`, t.how[`${step}Text`]);
  }
  setText(doc, 'footer-part', t.footer.partOf);
  setAttr(doc, 'nav', 'aria-label', t.nav.label);
  setAttr(doc, 'foot-links', 'aria-label', t.footer.links);
  setText(doc, 'watchers-title', t.watchers.title);
  setText(doc, 'footer-how', t.footer.how);
  setText(doc, 'footer-github', t.footer.github);
  setText(doc, 'footer-tracking', t.footer.noTracking);
  setAttr(doc, 'lang', 'aria-label', t.controls.language);
  setAttr(doc, 'theme', 'aria-label', t.controls.theme);
  setAttr(doc, 'theme', 'title', t.controls.theme);
  for (const button of doc.querySelectorAll('#lang button')) {
    button.setAttribute('aria-pressed', String(button.dataset.lang === lang));
  }
}

function renderBanner(doc, banner) {
  byId(doc, 'banner').className = `banner state-${banner.state}`;
  byId(doc, 'banner').dataset.message = banner.message;
  // The page takes the tone of the banner: the mesh, the glow and the halo.
  doc.documentElement.dataset.state = banner.state;
  setText(doc, 'banner-text', banner.text);
  const counts = byId(doc, 'counts');
  const unchanged = counts.children.length === banner.counts.length
    && banner.counts.every((count, i) => counts.children[i].textContent === count.text);
  if (unchanged) return;
  counts.replaceChildren(...banner.counts.map((count) => (
    el(doc, 'li', { class: `count state-${count.state}` }, el(doc, 'span', { class: 'dot', 'aria-hidden': 'true' }), count.text)
  )));
}

/**
 * The monogram, or the instance's vetted avatar over it. The avatar element
 * of the previous draw is reused when it shows the same picture, so the
 * image is not rebuilt every few seconds; if the image fails, the initial
 * stays.
 */
function avatarElement(doc, row, previous, assetQuery) {
  const src = row.avatar ? `${row.avatar}${assetQuery}` : null;
  if (previous && previous.dataset.src === (src ?? '') && previous.dataset.initial === row.initial) return previous;
  const span = el(doc, 'span', { class: 'avatar', 'aria-hidden': 'true', 'data-src': src ?? '', 'data-initial': row.initial }, row.initial);
  if (src) {
    const img = el(doc, 'img', { src, alt: '', width: '42', height: '42', decoding: 'async' });
    img.addEventListener('error', () => img.remove());
    span.append(img);
  }
  return span;
}

function summaryChildren(doc, row, previousAvatar, assetQuery) {
  const meta = [row.region, row.escrow].filter(Boolean).join(' · ');
  return [
    avatarElement(doc, row, previousAvatar, assetQuery),
    el(doc, 'span', { class: 'who' },
      el(doc, 'span', { class: 'name' }, row.name),
      meta ? el(doc, 'span', { class: 'meta' }, meta) : null),
    el(doc, 'span', { class: 'status' }, el(doc, 'span', { class: 'icon', 'aria-hidden': 'true' }, row.icon), row.word),
    row.labels.length
      ? el(doc, 'span', { class: 'labels' }, row.labels.map((label) => el(doc, 'span', { class: 'label' }, label)))
      : null,
  ];
}

function bodyChildren(doc, row, t) {
  const checks = row.checks.length
    ? el(doc, 'ul', { class: 'checks', 'aria-label': t.details.checks }, row.checks.map((check) => (
      el(doc, 'li', { class: `check check-${check.state}` },
        el(doc, 'span', { class: 'check-name' }, check.name), el(doc, 'span', { class: 'check-text' }, check.text))
    )))
    : null;
  const details = el(doc, 'dl', {}, row.details.map((item) => [el(doc, 'dt', {}, item.term), el(doc, 'dd', {}, item.value)]));
  // data-focus names each link, so focus can return to it after a redraw.
  const links = [
    row.event
      ? el(doc, 'a', { href: row.event.href, target: '_blank', rel: 'noopener noreferrer', 'data-focus': 'event' }, row.event.label)
      : null,
    row.website
      ? el(doc, 'a', { href: row.website, target: '_blank', rel: 'noopener noreferrer', 'data-focus': 'website' }, new URL(row.website).host)
      : null,
  ].filter(Boolean);
  return [
    row.note ? el(doc, 'p', { class: 'note' }, row.note) : null,
    checks,
    details,
    links.length ? el(doc, 'p', { class: 'links' }, links) : null,
  ];
}

/**
 * The bars of one instance. The container is a group named by the uptime;
 * each bar is a button named by its day's text, so a screen reader hears
 * the word for its colour, and the group is one tab stop: today has the
 * focus, the arrow keys move it. The buttons are made once and updated in
 * place: today's text changes on every redraw, and remaking the buttons
 * would drop the focus and the tab stop a keyboard user had moved.
 */
function renderBars(doc, container, history) {
  const hidden = history.bars.length - PHONE_DAYS;
  const last = history.bars.length - 1;
  if (container.children.length !== history.bars.length) {
    container.replaceChildren(...history.bars.map((_, i) => (
      el(doc, 'button', { type: 'button', class: 'bar', tabindex: i === last ? '0' : '-1' })
    )));
  }
  history.bars.forEach((bar, i) => {
    const button = container.children[i];
    const className = `bar state-${bar.state}${i < hidden ? ' wide-only' : ''}`;
    if (button.className !== className) button.className = className;
    if (button.dataset.day !== bar.day) button.dataset.day = bar.day;
    if (button.title !== bar.label) {
      button.title = bar.label;
      button.setAttribute('aria-label', bar.label);
    }
  });
}

/**
 * The text under the bars, kept to the day it was opened for: when that
 * day's label changes it follows, and when the day leaves the bars it goes.
 */
function renderBarDetail(container, detail) {
  const day = detail.dataset.day;
  if (!day) return;
  const bar = [...container.children].find((button) => button.dataset.day === day);
  if (!bar) delete detail.dataset.day;
  const text = bar ? bar.title : '';
  if (detail.textContent !== text) detail.textContent = text;
}

/**
 * Moves the tab stop to today when the bar holding it is no longer shown,
 * as when a window narrows to the phone layout: a hidden bar cannot take
 * the focus, and the group would drop out of the tab order.
 */
function keepTabStopShown(container) {
  const stop = [...container.children].find((bar) => bar.tabIndex === 0);
  if (!stop || stop.getClientRects().length > 0) return;
  const today = container.lastElementChild;
  stop.tabIndex = -1;
  today.tabIndex = 0;
}

/** The bars a keyboard can reach: those the viewport shows. */
function visibleBars(container) {
  return [...container.querySelectorAll('.bar')].filter((bar) => bar.getClientRects().length > 0);
}

const BAR_KEYS = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };

/** Moves the focus, and the tab stop, along the bars with the arrow keys. */
function moveAlongBars(container, event) {
  const step = BAR_KEYS[event.key];
  if (step === undefined || !event.target.classList?.contains('bar')) return;
  const bars = visibleBars(container);
  const at = bars.indexOf(event.target);
  if (at < 0) return;
  const next = bars[Math.min(bars.length - 1, Math.max(0, at + step))];
  event.preventDefault();
  for (const bar of bars) bar.tabIndex = bar === next ? 0 : -1;
  next.focus();
}

function renderHistory(doc, node, history) {
  const bars = node.querySelector('.bars');
  bars.setAttribute('aria-label', history.summary);
  renderBars(doc, bars, history);
  renderBarDetail(bars, node.querySelector('.bar-detail'));
  const [ago, agoNarrow, uptime, today] = node.querySelector('.legend').children;
  for (const [span, text] of [[ago, history.legend.ago], [agoNarrow, history.legend.agoNarrow], [uptime, history.uptime ?? ''], [today, history.legend.today]]) {
    if (span.textContent !== text) span.textContent = text;
  }
}

function renderRow(doc, li, row, t, assetQuery) {
  li.className = `instance state-${row.state}`;
  const [head, history, details] = li.children;
  const [summary, body] = details.children;
  const previousAvatar = head.querySelector('.avatar');
  // The ages change on every redraw, so the panel is rebuilt each time; a
  // link that had the keyboard focus gets it back in its new copy.
  const focused = body.contains(doc.activeElement) ? doc.activeElement.dataset.focus : null;
  // replaceChildren would write a null as the text "null".
  head.replaceChildren(...summaryChildren(doc, row, previousAvatar, assetQuery).filter(Boolean));
  renderHistory(doc, history, row.history);
  if (summary.textContent !== t.details.toggle) summary.textContent = t.details.toggle;
  body.replaceChildren(...bodyChildren(doc, row, t).filter(Boolean));
  if (focused) body.querySelector(`[data-focus="${focused}"]`)?.focus();
}

/** A row's skeleton: the head, the bars with their legend, and the panel. */
function newRow(doc, pubkey) {
  const detail = el(doc, 'p', { class: 'bar-detail' });
  const history = el(doc, 'div', { class: 'history' },
    el(doc, 'div', { class: 'bars', role: 'group' }),
    el(doc, 'div', { class: 'legend' },
      el(doc, 'span', { class: 'wide-only' }), el(doc, 'span', { class: 'narrow-only' }), el(doc, 'span', { class: 'uptime' }), el(doc, 'span')),
    detail);
  // A tap, or the focus, shows what hovering would: the text is already plain.
  const show = (event) => {
    const bar = event.target.closest?.('.bar');
    if (!bar) return;
    detail.dataset.day = bar.dataset.day;
    detail.textContent = bar.title;
  };
  history.addEventListener('click', show);
  history.addEventListener('focusin', show);
  history.addEventListener('keydown', (event) => moveAlongBars(history, event));
  const bars = history.querySelector('.bars');
  new doc.defaultView.ResizeObserver(() => keepTabStopShown(bars)).observe(bars);
  return el(doc, 'li', { 'data-pubkey': pubkey },
    el(doc, 'div', { class: 'head' }),
    history,
    el(doc, 'details', {}, el(doc, 'summary'), el(doc, 'div', { class: 'body' })));
}

function renderRows(doc, rows, t, assetQuery) {
  const list = byId(doc, 'instances');
  const existing = new Map([...list.children].map((li) => [li.dataset.pubkey, li]));
  const ordered = rows.map((row) => {
    const li = existing.get(row.pubkey) ?? newRow(doc, row.pubkey);
    renderRow(doc, li, row, t, assetQuery);
    return li;
  });
  // Move only what is out of place: taking a row out of the document, even
  // to put it back where it was, drops the keyboard focus inside it.
  ordered.forEach((li, index) => {
    if (list.children[index] !== li) list.insertBefore(li, list.children[index] ?? null);
  });
  while (list.children.length > ordered.length) list.lastElementChild.remove();
}

const WATCHER_COLOURS = { alive: 'green', not_reporting: 'red' };

/** Swaps the state-* class of `node`, keeping its other classes. */
function setStateClass(node, state) {
  for (const name of [...node.classList].filter((c) => c.startsWith('state-'))) node.classList.remove(name);
  node.classList.add(`state-${state}`);
}

function renderWatchers(doc, watchers) {
  setStateClass(byId(doc, 'watchers'), watchers.state);
  setText(doc, 'watchers-summary', watchers.summary);
  byId(doc, 'watchers-list').replaceChildren(...watchers.items.map((item) => (
    el(doc, 'li', { class: `watcher state-${WATCHER_COLOURS[item.state] ?? 'grey'}` },
      el(doc, 'span', { class: 'dot', 'aria-hidden': 'true' }),
      el(doc, 'span', { class: 'icon', 'aria-hidden': 'true' }, item.icon),
      el(doc, 'span', { class: 'name' }, item.name),
      el(doc, 'span', { class: 'meta' }, item.text))
  )));
}

function renderIncidents(doc, incidents) {
  setText(doc, 'incidents-title', incidents.title);
  setText(doc, 'incidents-empty', incidents.empty ?? '');
  const list = byId(doc, 'incidents-list');
  if (!list) return;
  const key = JSON.stringify(incidents.items);
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  // Colour is never the only signal: each incident names its state, with an icon.
  list.replaceChildren(...incidents.items.map((item) => (
    el(doc, 'li', { class: `incident state-${item.state}` },
      el(doc, 'span', { class: 'state' }, el(doc, 'span', { class: 'icon', 'aria-hidden': 'true' }, item.icon), item.word),
      el(doc, 'span', { class: 'name' }, item.name),
      item.reason ? el(doc, 'span', { class: 'reason' }, item.reason) : null,
      el(doc, 'span', { class: 'meta' }, `${item.from} · ${item.length}`))
  )));
}

/**
 * Draws `view` (the result of pageView) with the catalogue `t`. `assetQuery`
 * is the deploy version (`?v=…`) for the URLs the script builds itself.
 */
export function renderView(doc, view, t, assetQuery = '') {
  renderBanner(doc, view.banner);
  setText(doc, 'history-title', view.history.title);
  renderRows(doc, view.rows, t, assetQuery);
  renderIncidents(doc, view.incidents);
  renderWatchers(doc, view.watchers);
}

/** Replaces the banner with an error the visitor can read. */
export function renderError(doc, message) {
  byId(doc, 'banner').className = 'banner state-grey';
  byId(doc, 'banner').dataset.message = 'error';
  doc.documentElement.dataset.state = 'grey';
  setText(doc, 'banner-text', message);
  byId(doc, 'counts').replaceChildren();
}
