import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickLanguage, catalogue, LANGUAGES } from '../src/i18n.js';
import en from '../src/i18n/en.js';
import es from '../src/i18n/es.js';

/** Every leaf of a catalogue, as [path, value]. */
function leaves(object, prefix = '') {
  return Object.entries(object).flatMap(([key, value]) => (
    typeof value === 'object' ? leaves(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]]
  ));
}

test('the language in the URL wins over the browser', () => {
  assert.equal(pickLanguage('?lang=en', ['es-AR']), 'en');
  assert.equal(pickLanguage('?lang=es', ['en-US']), 'es');
});

test('without a valid language in the URL, the first browser language the page has wins', () => {
  assert.equal(pickLanguage('', ['pt-BR', 'es-AR', 'en']), 'es');
  assert.equal(pickLanguage('?lang=fr', ['en-GB']), 'en');
  assert.equal(pickLanguage('?other=1', ['ES']), 'es');
});

test('a browser with no language the page has gets English', () => {
  assert.equal(pickLanguage('', ['de-DE']), 'en');
  assert.equal(pickLanguage('', []), 'en');
  assert.equal(pickLanguage('', undefined), 'en');
});

test('the Spanish catalogue has exactly the keys of the English one, and the same kinds', () => {
  const enKeys = leaves(en).map(([path, value]) => [path, typeof value]);
  const esKeys = leaves(es).map(([path, value]) => [path, typeof value]);

  assert.deepEqual(esKeys, enKeys);
});

test('no string in either catalogue is blank', () => {
  for (const [lang, strings] of [['en', en], ['es', es]]) {
    for (const [path, value] of leaves(strings)) {
      const text = typeof value === 'function' ? value(1, 2, 3, 4) : value;
      assert.equal(typeof text, 'string', `${lang}.${path}`);
      assert.notEqual(text.trim(), '', `${lang}.${path}`);
    }
  }
});

test('every interpolation places its arguments', () => {
  for (const [lang, strings] of [['en', en], ['es', es]]) {
    for (const [path, value] of leaves(strings).filter(([, v]) => typeof v === 'function')) {
      const text = value('«A»', '«B»', '«C»', '«D»');
      for (const marker of ['«A»', '«B»', '«C»', '«D»'].slice(0, value.length)) {
        assert.ok(text.includes(marker), `${lang}.${path} does not place ${marker}: ${text}`);
      }
    }
  }
});

test("the spec's words for each state are used as written", () => {
  assert.equal(es.state.green, 'Operativo');
  assert.equal(es.state.yellow, 'Con problemas');
  assert.equal(es.state.red, 'Caído');
  assert.equal(es.state.grey, 'Sin monitoreo');
  assert.equal(es.label.not_reporting, 'Sin señal');
  assert.equal(es.label.unverified, 'Sin verificación independiente');
  assert.equal(es.label.network_mismatch, 'Red inesperada');
  assert.equal(en.state.red, 'Down');
  assert.equal(en.label.unverified, 'Not independently verified');
  assert.equal(en.banner.down(2), '2 Mostros down');
  assert.equal(es.banner.down(2), '2 Mostros caídos');
  assert.equal(es.banner.operational, 'Todos los Mostros operativos');
});

test('one Mostro down is singular', () => {
  assert.equal(en.banner.down(1), '1 Mostro down');
  assert.equal(es.banner.down(1), '1 Mostro caído');
});

test('a catalogue is found for each language, and English for anything else', () => {
  assert.deepEqual(LANGUAGES, ['es', 'en']);
  assert.equal(catalogue('es'), es);
  assert.equal(catalogue('xx'), en);
});

test('a Spanish string that is still English is a missing translation', () => {
  // Words Spanish-speaking Mostro users use as they are.
  const allowed = new Set(['escrow.lightning', 'escrow.cashu', 'checkState.ok', 'footer.github', 'check.relays']);
  const english = new Map(leaves(en));

  for (const [path, value] of leaves(es)) {
    if (allowed.has(path) || typeof value === 'function') continue;
    assert.notEqual(value, english.get(path), `es.${path} is still English`);
  }
});
