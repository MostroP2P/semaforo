import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setText } from '../src/dom.js';

/** The least of a document setText needs: elements by id. */
function fakeDocument(ids) {
  const nodes = new Map(ids.map((id) => [id, { textContent: '', writes: 0 }]));
  return {
    nodes,
    getElementById: (id) => {
      const node = nodes.get(id);
      if (!node) return null;
      return new Proxy(node, {
        set(target, key, value) {
          if (key === 'textContent') target.writes += 1;
          target[key] = value;
          return true;
        },
      });
    },
  };
}

test('an element missing from an older cached page is skipped, not a crash', () => {
  const doc = fakeDocument(['present']);

  assert.doesNotThrow(() => setText(doc, 'missing', 'text'));
  setText(doc, 'present', 'text');
  assert.equal(doc.nodes.get('present').textContent, 'text');
});

test('the same text is not written twice, so a live region does not repeat it', () => {
  const doc = fakeDocument(['banner-text']);

  setText(doc, 'banner-text', 'All Mostros operational');
  setText(doc, 'banner-text', 'All Mostros operational');

  assert.equal(doc.nodes.get('banner-text').writes, 1);
});
