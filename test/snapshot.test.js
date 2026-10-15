import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshot } from '../src/snapshot.js';
import { emptyStore, addEvent } from '../src/store.js';
import { NOW, PK, OTHER, yes, healthEvent } from './helpers/events.js';

const MEMPOOL = 'https://mempool.space/api/blocks/tip/height';
const config = { explorers: new Map([['mainnet', [MEMPOOL]]]), blockLagRed: 3, explorerTipMaxAgeMinutes: 30 };
const trusted = {
  instances: [
    { pubkey: PK, name: 'Mostro', network: 'mainnet', monitored: true, relays: [] },
    { pubkey: OTHER, name: 'Silent', network: 'mainnet', monitored: true, relays: [] },
  ],
  watchers: [],
};

test('the snapshot gives every instance its light and cross-check, in the order of the list', () => {
  // Arrange
  const { store } = addEvent(emptyStore(), { event: healthEvent(), relay: 'wss://one', now: NOW, verify: yes, trusted });
  const tips = new Map([[MEMPOOL, { height: 971486, at: NOW }]]);

  // Act
  const result = snapshot({ trusted, config, store, tips, now: NOW });

  // Assert
  assert.deepEqual(result.map((r) => r.entry.pubkey), [PK, OTHER]);
  assert.equal(result[0].light.state, 'green');
  assert.equal(result[0].check.kind, 'explorer');
  assert.equal(result[0].check.lag, 1);
  assert.deepEqual(result[0].stored.relays, ['wss://one']);
  assert.equal(result[1].report, null);
  assert.equal(result[1].stored, null);
  assert.deepEqual(result[1].check, { kind: 'none', networkMismatch: false });
  assert.deepEqual(result[1].light.reasons, ['not_reporting']);
});
