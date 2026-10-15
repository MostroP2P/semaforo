// Signed events for the smoke test, from fixed test keys. Each instance is
// in a different state, so one page load shows every row the spec defines.

import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { createHash } from 'node:crypto';

/** A fixed secret key for `name`. Test keys only; they hold nothing. */
export function secretKey(name) {
  return createHash('sha256').update(`semaforo-smoke-${name}`).digest();
}

export const key = (name) => getPublicKey(secretKey(name));

export const TIP = 900000;

function health(name, now, { status = 'ok', maintenance = false, height = TIP, checks }) {
  return finalizeEvent({
    kind: 38389,
    created_at: now,
    content: '',
    tags: [
      ['d', key(name)], ['y', 'mostro', name], ['z', 'health'], ['status', status],
      ['escrow_mode', 'lightning'], ['maintenance_mode', String(maintenance)], ['mostro_version', '0.19.3'],
      ['lnd_block_height', String(height)], ['lnd_synced_to_chain', String(status !== 'down')], ['lnd_network', 'mainnet'],
      ['interval', '60'], ['seq', String(now)], ['expiration', String(now + 180)],
      ...checks.map(([check, state, ago]) => ['check', check, state, String(now - ago)]),
    ],
  }, secretKey(name));
}

const allOk = [['lnd_sync', 'ok', 900000], ['payouts', 'ok', 900000], ['relays', 'ok', 86400], ['database', 'ok', 900000]];

/** The events of the scenario, dated `now`. */
export function scenario(now) {
  const silentForged = { ...health('silent', now, { checks: allOk }), sig: 'f'.repeat(128) };
  return [
    health('green', now, { checks: allOk }),
    health('maintenance', now, { status: 'degraded', maintenance: true, checks: allOk }),
    // The failure of 2026-10-14: LND off the chain for 21 h 12 min.
    health('down', now, {
      status: 'down',
      height: TIP - 130,
      checks: [['lnd_sync', 'fail', 76320], ['payouts', 'fail', 70000], ['relays', 'ok', 86400], ['database', 'ok', 900000]],
    }),
    // A forged event for a trusted key: it must change nothing.
    silentForged,
    // A valid event from a key nobody trusts: it must not appear.
    health('stranger', now, { checks: allOk }),
    finalizeEvent({
      kind: 38385,
      created_at: now,
      content: '',
      tags: [['d', key('green')], ['y', 'mostro', 'green'], ['z', 'info'], ['fee', '0.006'], ['mostro_version', '0.19.3']],
    }, secretKey('green')),
    finalizeEvent({
      kind: 38389,
      created_at: now,
      content: '',
      tags: [['d', key('watcher')], ['y', 'mostro-watchdog'], ['z', 'watcher'], ['interval', '60'], ['seq', String(now)], ['expiration', String(now + 180)]],
    }, secretKey('watcher')),
  ];
}

/** The trusted list of the scenario. */
export function trustedList() {
  const entry = (name, label, monitored = true) => ({ pubkey: key(name), name: label, region: 'Test', network: 'mainnet', monitored });
  return {
    instances: [
      { ...entry('green', 'Green Mostro'), avatar: true },
      entry('maintenance', 'Maintenance Mostro'),
      entry('down', 'Down Mostro'),
      entry('silent', 'Silent Mostro'),
      entry('grey', 'New Mostro', false),
    ],
    watchers: [
      { pubkey: key('watcher'), name: 'Alive watcher' },
      { pubkey: key('dead-watcher'), name: 'Dead watcher' },
    ],
  };
}
