// Draws the page view (view.js) into the document. Every value from the
// network is set with textContent, never as HTML. Rows are created once per
// instance and updated in place, so an open details panel and the keyboard
// focus survive each refresh.

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

function setText(doc, id, text) {
  byId(doc, id).textContent = text;
}

/** The words of the page that don't depend on the data. */
export function renderStatic(doc, t, lang) {
  doc.documentElement.lang = lang;
  doc.title = t.title;
  doc.querySelector('meta[name="description"]')?.setAttribute('content', t.description);
  setText(doc, 'heading', t.heading);
  setText(doc, 'watchers-title', t.watchers.title);
  setText(doc, 'footer-how', t.footer.how);
  setText(doc, 'footer-github', t.footer.github);
  setText(doc, 'footer-tracking', t.footer.noTracking);
  byId(doc, 'lang').setAttribute('aria-label', t.controls.language);
  byId(doc, 'theme').setAttribute('aria-label', t.controls.theme);
  byId(doc, 'theme').setAttribute('title', t.controls.theme);
  for (const button of doc.querySelectorAll('#lang button')) {
    button.setAttribute('aria-pressed', String(button.dataset.lang === lang));
  }
}

function renderBanner(doc, banner) {
  byId(doc, 'banner').className = `banner state-${banner.state}`;
  setText(doc, 'banner-text', banner.text);
  byId(doc, 'counts').replaceChildren(...banner.counts.map((count) => (
    el(doc, 'li', { class: `count state-${count.state}` }, el(doc, 'span', { class: 'dot', 'aria-hidden': 'true' }), count.text)
  )));
}

function summaryChildren(doc, row) {
  const meta = [row.region, row.escrow].filter(Boolean).join(' · ');
  return [
    el(doc, 'span', { class: 'dot', 'aria-hidden': 'true' }),
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

function renderRow(doc, li, row, t) {
  li.className = `instance state-${row.state}`;
  const [summary, body] = li.firstChild.children;
  // The ages change on every redraw, so the panel is rebuilt each time; a
  // link that had the keyboard focus gets it back in its new copy.
  const focused = body.contains(doc.activeElement) ? doc.activeElement.dataset.focus : null;
  // replaceChildren would write a null as the text "null".
  summary.replaceChildren(...summaryChildren(doc, row).filter(Boolean));
  body.replaceChildren(...bodyChildren(doc, row, t).filter(Boolean));
  if (focused) body.querySelector(`[data-focus="${focused}"]`)?.focus();
}

function renderRows(doc, rows, t) {
  const list = byId(doc, 'instances');
  const existing = new Map([...list.children].map((li) => [li.dataset.pubkey, li]));
  const ordered = rows.map((row) => {
    const li = existing.get(row.pubkey) ?? el(doc, 'li', { 'data-pubkey': row.pubkey },
      el(doc, 'details', {}, el(doc, 'summary'), el(doc, 'div', { class: 'body' })));
    renderRow(doc, li, row, t);
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

function renderWatchers(doc, watchers) {
  byId(doc, 'watchers').className = `watchers state-${watchers.state}`;
  setText(doc, 'watchers-summary', watchers.summary);
  byId(doc, 'watchers-list').replaceChildren(...watchers.items.map((item) => (
    el(doc, 'li', { class: `watcher state-${WATCHER_COLOURS[item.state] ?? 'grey'}` },
      el(doc, 'span', { class: 'dot', 'aria-hidden': 'true' }),
      el(doc, 'span', { class: 'icon', 'aria-hidden': 'true' }, item.icon),
      el(doc, 'span', { class: 'name' }, item.name),
      el(doc, 'span', { class: 'meta' }, item.text))
  )));
}

/** Draws `view` (the result of pageView) with the catalogue `t`. */
export function renderView(doc, view, t) {
  renderBanner(doc, view.banner);
  setText(doc, 'history-title', view.history.title);
  setText(doc, 'history-note', view.history.note);
  renderRows(doc, view.rows, t);
  renderWatchers(doc, view.watchers);
}

/** Replaces the banner with an error the visitor can read. */
export function renderError(doc, message) {
  byId(doc, 'banner').className = 'banner state-grey';
  setText(doc, 'banner-text', message);
  byId(doc, 'counts').replaceChildren();
}
