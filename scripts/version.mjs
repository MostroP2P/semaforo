// Versioned URLs for the published site. GitHub Pages serves every file with
// a ten-minute cache, so right after a deploy a browser could pair the new
// index.html with an old module and show half a page. The deploy therefore
// adds ?v=<version> to every URL of the site's own files: in the page, in
// the stylesheets and in the imports between modules. A new deploy is a new
// set of URLs; the files themselves keep their names.

import { createHash } from 'node:crypto';

// A path of one of the site's own files: no scheme, no anchor, no query,
// and a file extension. "./" (the home link) and "#how" are left alone.
const OWN_FILE = /^(?![a-z][a-z0-9+.-]*:|\/\/|#)[^"'?#\s]+\.(?:css|js|mjs|svg|webp|png|woff2)$/i;

const withVersion = (path, version) => `${path}?v=${version}`;

/** A 12-hex-digit hash of `contents` (Buffers): changes when any file does. */
export function buildVersion(contents) {
  const hash = createHash('sha256');
  for (const content of contents) hash.update(content);
  return hash.digest('hex').slice(0, 12);
}

/** `html` with the version on the href and src of the site's own files. */
export function versionHtml(html, version) {
  return html.replace(/\b(href|src)="([^"]+)"/g, (match, attribute, path) => (
    OWN_FILE.test(path) ? `${attribute}="${withVersion(path, version)}"` : match
  ));
}

/** `css` with the version on each relative url(). */
export function versionCss(css, version) {
  return css.replace(/url\((["']?)([^"')]+)\1\)/g, (match, quote, path) => (
    OWN_FILE.test(path) ? `url(${quote}${withVersion(path, version)}${quote})` : match
  ));
}

/** `js` with the version on each relative static or dynamic import. */
export function versionJs(js, version) {
  return js.replace(/(\bfrom\s+|\bimport\s*\(\s*)(["'])(\.{1,2}\/[^"']+)\2/g, (match, lead, quote, path) => (
    OWN_FILE.test(path) ? `${lead}${quote}${withVersion(path, version)}${quote}` : match
  ));
}
