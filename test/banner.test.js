import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banner } from '../src/banner.js';

const lights = (...states) => states.map((state) => ({ state }));

test('every monitored instance green is a green banner', () => {
  // Act
  const result = banner({ relays: 'reachable', lights: lights('green', 'green', 'grey') });

  // Assert
  assert.deepEqual(result, { state: 'green', message: 'operational', count: 2, counts: { green: 2, yellow: 0, red: 0 } });
});

test('one red instance is a red banner counting the instances down', () => {
  const result = banner({ relays: 'reachable', lights: lights('green', 'red', 'yellow', 'red') });

  assert.deepEqual(result, { state: 'red', message: 'down', count: 2, counts: { green: 1, yellow: 1, red: 2 } });
});

test('a yellow instance and no red one is a yellow banner', () => {
  const result = banner({ relays: 'reachable', lights: lights('green', 'yellow') });

  assert.deepEqual(result, { state: 'yellow', message: 'degraded', count: 1, counts: { green: 1, yellow: 1, red: 0 } });
});

test('no monitored instance is never green', () => {
  assert.equal(banner({ relays: 'reachable', lights: lights('grey', 'grey') }).message, 'none_monitored');
  assert.equal(banner({ relays: 'reachable', lights: [] }).state, 'grey');
});

test('a page that reaches no relay cannot verify anything, whatever it saw', () => {
  const result = banner({ relays: 'unreachable', lights: lights('green', 'red') });

  assert.deepEqual(result, { state: 'grey', message: 'unreachable', count: 0, counts: { green: 1, yellow: 0, red: 1 } });
});

test('before any relay has answered, the banner says it is checking', () => {
  assert.equal(banner({ relays: 'connecting', lights: lights('red') }).message, 'checking');
  assert.equal(banner({ relays: 'connecting', lights: lights('red') }).state, 'grey');
});
