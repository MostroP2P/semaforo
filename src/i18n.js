// The language of the page: Spanish or English, from `?lang=` first, then
// the browser's preferences, then English. The catalogues hold every string
// a visitor reads; nothing user-facing is written anywhere else.

import en from './i18n/en.js';
import es from './i18n/es.js';

export const LANGUAGES = Object.freeze(['es', 'en']);
const CATALOGUES = new Map([['es', es], ['en', en]]);

/**
 * The language for a page whose URL query is `search` in a browser that
 * prefers `languages` (`navigator.languages`).
 */
export function pickLanguage(search, languages) {
  const asked = new URLSearchParams(search).get('lang');
  if (LANGUAGES.includes(asked)) return asked;
  for (const language of languages ?? []) {
    const base = String(language).toLowerCase().split('-')[0];
    if (LANGUAGES.includes(base)) return base;
  }
  return 'en';
}

/** The strings of `language`, English for anything else. */
export function catalogue(language) {
  return CATALOGUES.get(language) ?? en;
}
