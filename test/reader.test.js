import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHealthEvent,
  parseInfoEvent,
  isFresh,
  better,
  newerInfo,
  deriveStatus,
  worseStatus,
} from '../src/reader.js';
import { NOW, PK, OTHER, ID, SINCE, yes, no, healthEvent, watcherEvent, infoEvent } from './helpers/events.js';

const throws = () => {
  throw new Error('bad hex');
};

const reason = (event, now = NOW, verify = yes) => parseHealthEvent(event, now, verify).reason;
const parseInfo = (event, verify) => parseInfoEvent(event, NOW, verify);

test('a health event as the protocol shows it parses into an instance report', () => {
  // Arrange
  const event = healthEvent();

  // Act
  const result = parseHealthEvent(event, NOW, yes);

  // Assert
  assert.equal(result.valid, true);
  assert.deepEqual(result.report, {
    shape: 'instance',
    pubkey: PK,
    id: ID,
    createdAt: NOW,
    interval: 60,
    seq: 7,
    expiration: NOW + 180,
    name: 'Test Mostro',
    status: 'ok',
    escrowMode: 'lightning',
    maintenance: false,
    version: '0.19.3',
    blockHeight: 971485,
    synced: true,
    network: 'mainnet',
    checks: [
      { name: 'lnd_sync', state: 'ok', since: 1791900000 },
      { name: 'payouts', state: 'ok', since: 1791900000 },
      { name: 'relays', state: 'ok', since: 1791900000 },
      { name: 'database', state: 'ok', since: 1791900000 },
    ],
  });
});

test('an event that is not an object of kind 38389 is rejected', () => {
  assert.equal(reason(null), 'not kind 38389');
  assert.equal(reason({ ...healthEvent(), kind: 38385 }), 'not kind 38389');
  assert.equal(reason({ ...healthEvent(), tags: 'x' }), 'not kind 38389');
});

test('an event whose id, pubkey or content has the wrong shape is rejected', () => {
  assert.equal(reason({ ...healthEvent(), id: 'E'.repeat(64) }), 'malformed event');
  assert.equal(reason({ ...healthEvent(), pubkey: 'not a key' }), 'malformed event');
  assert.equal(reason({ ...healthEvent(), content: 7 }), 'malformed event');
});

test('a tag that is not a non-empty list of strings is rejected', () => {
  const empty = healthEvent();
  empty.tags.push([]);
  const number = healthEvent();
  number.tags.push(['seq', 7]);
  const notList = healthEvent();
  notList.tags.push('seq');

  assert.equal(reason(empty), 'malformed tags');
  assert.equal(reason(number), 'malformed tags');
  assert.equal(reason(notList), 'malformed tags');
});

test('an event with a bad signature is rejected', () => {
  assert.equal(reason(healthEvent(), NOW, no), 'invalid signature');
});

test('an event whose z is neither health nor watcher is rejected', () => {
  assert.equal(reason(healthEvent({ z: ['order'] })), 'bad z');
  assert.equal(reason(healthEvent({ z: null })), 'bad z');
});

test('d must equal the author', () => {
  assert.equal(reason(healthEvent({ d: [OTHER] })), 'd is not the author');
});

test('every required instance tag must be present', () => {
  // A missing d fails the author check first, which every event kind shares.
  assert.equal(reason(healthEvent({ d: null })), 'd is not the author');
  for (const name of ['y', 'status', 'escrow_mode', 'maintenance_mode', 'mostro_version', 'interval', 'seq', 'expiration']) {
    assert.equal(reason(healthEvent({ [name]: null })), `missing ${name}`, name);
  }
});

test('a tag of the table repeated, or present without a value, rejects the event', () => {
  const repeated = healthEvent();
  repeated.tags.push(['seq', '7']);
  const valueless = healthEvent({ lnd_network: null });
  valueless.tags.push(['lnd_network']);

  assert.equal(reason(repeated), 'repeated seq');
  assert.equal(reason(valueless), 'bad lnd_network');
});

test('created_at must be a safe, non-negative integer', () => {
  assert.equal(reason({ ...healthEvent(), created_at: 2 ** 60 }), 'bad created_at');
  assert.equal(reason({ ...healthEvent(), created_at: -1 }), 'bad created_at');
  assert.equal(reason({ ...healthEvent(), created_at: 1.5 }), 'bad created_at');
});

test('an event more than 300 seconds in the future is ignored', () => {
  assert.equal(reason(healthEvent({}, { createdAt: NOW + 301 })), 'dated in the future');
  assert.equal(parseHealthEvent(healthEvent({}, { createdAt: NOW + 300 }), NOW, yes).valid, true);
});

test('interval must be an integer within 30 to 3600', () => {
  assert.equal(reason(healthEvent({ interval: ['29'], expiration: [String(NOW + 87)] })), 'bad interval');
  assert.equal(reason(healthEvent({ interval: ['3601'], expiration: [String(NOW + 10803)] })), 'bad interval');
  assert.equal(reason(healthEvent({ interval: ['60.0'] })), 'bad interval');
  assert.equal(parseHealthEvent(healthEvent({ interval: ['30'], expiration: [String(NOW + 90)] }), NOW, yes).valid, true);
  assert.equal(parseHealthEvent(healthEvent({ interval: ['3600'], expiration: [String(NOW + 10800)] }), NOW, yes).valid, true);
});

test('seq must be an integer from 1 to 2^53 − 1 with no leading zero', () => {
  assert.equal(reason(healthEvent({ seq: ['0'] })), 'bad seq');
  assert.equal(reason(healthEvent({ seq: ['07'] })), 'bad seq');
  assert.equal(reason(healthEvent({ seq: ['-7'] })), 'bad seq');
  assert.equal(reason(healthEvent({ seq: ['9007199254740992'] })), 'bad seq');
  assert.equal(parseHealthEvent(healthEvent({ seq: ['9007199254740991'] }), NOW, yes).valid, true);
});

test('expiration must be exactly created_at + 3 × interval', () => {
  assert.equal(reason(healthEvent({ expiration: [String(NOW + 181)] })), 'bad expiration');
  assert.equal(reason(healthEvent({ expiration: [String(NOW + 179)] })), 'bad expiration');
  assert.equal(reason(healthEvent({ expiration: ['soon'] })), 'bad expiration');
});

test('an instance event must say y = mostro', () => {
  assert.equal(reason(healthEvent({ y: ['mostro-watchdog'] })), 'bad y');
});

test('the name in y is optional', () => {
  const { report } = parseHealthEvent(healthEvent({ y: ['mostro'] }), NOW, yes);

  assert.equal(report.name, null);
});

test('status, escrow_mode and maintenance_mode take only the values of the protocol', () => {
  assert.equal(reason(healthEvent({ status: ['fine'] })), 'bad status');
  assert.equal(reason(healthEvent({ escrow_mode: ['onchain'] })), 'bad escrow_mode');
  assert.equal(reason(healthEvent({ maintenance_mode: ['yes'] })), 'bad maintenance_mode');
});

test('maintenance_mode true reads as maintenance', () => {
  const { report } = parseHealthEvent(healthEvent({ maintenance_mode: ['true'] }), NOW, yes);

  assert.equal(report.maintenance, true);
});

test('the check tag may repeat once per check name, never twice with the same name', () => {
  const twice = healthEvent();
  twice.tags.push(['check', 'relays', 'fail', SINCE]);

  assert.equal(parseHealthEvent(healthEvent(), NOW, yes).report.checks.length, 4);
  assert.equal(reason(twice), 'bad check');
});

test('a check with no since, a malformed since or a since after created_at is rejected', () => {
  assert.equal(reason(healthEvent({}, { checks: [['relays', 'ok']] })), 'bad check');
  assert.equal(reason(healthEvent({}, { checks: [['relays', 'ok', 'yesterday']] })), 'bad check');
  assert.equal(reason(healthEvent({}, { checks: [['relays', 'ok', String(NOW + 1)]] })), 'bad check');
});

test('an event with no check is rejected', () => {
  assert.equal(reason(healthEvent({}, { checks: [] })), 'no check');
});

test('unknown check names are skipped and unknown states read as unknown', () => {
  const event = healthEvent({}, { checks: [['lnd_sync', 'weird', SINCE], ['quantum', 'fail', SINCE]] });

  const { report } = parseHealthEvent(event, NOW, yes);

  assert.deepEqual(report.checks[0], { name: 'lnd_sync', state: 'unknown', since: 1791900000 });
  assert.equal(report.checks.some((c) => c.name === 'quantum'), false);
});

test('an event whose only checks are unknown names is still valid, its expected checks unknown', () => {
  const { valid, report } = parseHealthEvent(healthEvent({}, { checks: [['quantum', 'ok', SINCE]] }), NOW, yes);

  assert.equal(valid, true);
  assert.deepEqual(report.checks.map((c) => [c.name, c.state]), [
    ['lnd_sync', 'unknown'], ['payouts', 'unknown'], ['relays', 'unknown'], ['database', 'unknown'],
  ]);
});

test('the LND tags are optional, and checked when present', () => {
  const { report } = parseHealthEvent(
    healthEvent({ lnd_block_height: null, lnd_synced_to_chain: null, lnd_network: null }),
    NOW,
    yes,
  );

  assert.equal(report.blockHeight, null);
  assert.equal(report.synced, null);
  assert.equal(report.network, null);
  assert.equal(reason(healthEvent({ lnd_block_height: ['9007199254740993'] })), 'bad lnd_block_height');
  assert.equal(reason(healthEvent({ lnd_synced_to_chain: ['maybe'] })), 'bad lnd_synced_to_chain');
  assert.equal(reason(healthEvent({ lnd_network: ['litecoin'] })), 'bad lnd_network');
  assert.equal(parseHealthEvent(healthEvent({ lnd_synced_to_chain: ['false'] }), NOW, yes).report.synced, false);
});

test('p is present if and only if content is not empty, and is a lowercase hex key', () => {
  assert.equal(reason(healthEvent({}, { content: 'abc' })), 'p and content disagree');
  assert.equal(reason(healthEvent({ p: [OTHER] })), 'p and content disagree');
  assert.equal(reason(healthEvent({ p: ['B'.repeat(64)] }, { content: 'abc' })), 'bad p');
  assert.equal(parseHealthEvent(healthEvent({ p: [OTHER] }, { content: 'abc' }), NOW, yes).valid, true);
});

test('a watcher heartbeat needs no instance tags and may watch several instances', () => {
  const event = watcherEvent({}, { watching: [OTHER, 'c'.repeat(64)] });

  const { valid, report } = parseHealthEvent(event, NOW, yes);

  assert.equal(valid, true);
  assert.deepEqual(report, {
    shape: 'watcher',
    pubkey: PK,
    id: ID,
    createdAt: NOW,
    interval: 60,
    seq: 88213,
    expiration: NOW + 180,
    software: 'mostro-watchdog',
    watching: [OTHER, 'c'.repeat(64)],
  });
});

test('a watcher heartbeat follows the same interval, seq and expiration rules', () => {
  assert.equal(reason(watcherEvent({ interval: null })), 'missing interval');
  assert.equal(reason(watcherEvent({ seq: ['0'] })), 'bad seq');
  assert.equal(reason(watcherEvent({ expiration: [String(NOW + 1)] })), 'bad expiration');
});

test('a watcher heartbeat that repeats or misspells a watching key is rejected', () => {
  assert.equal(reason(watcherEvent({}, { watching: [OTHER, OTHER] })), 'bad watching');
  assert.equal(reason(watcherEvent({}, { watching: ['nope'] })), 'bad watching');
});

test('a fresh report is one before its expiration and no older than three intervals', () => {
  const { report } = parseHealthEvent(healthEvent(), NOW, yes);

  assert.equal(isFresh(report, NOW), true);
  assert.equal(isFresh(report, NOW + 179), true);
  assert.equal(isFresh(report, NOW + 180), false);
  assert.equal(isFresh(undefined, NOW), false);
});

test('a report older than three intervals is stale even before its expiration', () => {
  // Arrange: expiration is checked at parse time, so build the stale case
  // directly from a parsed report.
  const { report } = parseHealthEvent(healthEvent(), NOW, yes);
  const odd = { ...report, expiration: NOW + 10000 };

  // Act and assert
  assert.equal(isFresh(odd, NOW + 180), true);
  assert.equal(isFresh(odd, NOW + 181), false);
});

test('a report more than 300 seconds in the future is not fresh', () => {
  const { report } = parseHealthEvent(healthEvent(), NOW, yes);

  assert.equal(isFresh(report, NOW - 300), true);
  assert.equal(isFresh(report, NOW - 301), false);
});

test('one rule orders revisions: a higher seq, then the lower id', () => {
  const r = (seq, id) => ({ seq, id });

  assert.equal(better(r(8, 'b'), r(7, 'a')), true);
  assert.equal(better(r(7, 'a'), r(7, 'b')), true);
  assert.equal(better(r(7, 'b'), r(7, 'a')), false);
  assert.equal(better(r(7, 'a'), r(7, 'a')), false, 'a revision never beats itself');
  assert.equal(better(r(1, 'z'), undefined), true);
  assert.equal(better(undefined, r(1, 'z')), false);
});

test('status is derived from the checks and maintenance as the protocol orders it', () => {
  const c = (name, state) => ({ name, state, since: 0 });

  assert.equal(deriveStatus([c('lnd_sync', 'ok'), c('payouts', 'ok')], false), 'ok');
  assert.equal(deriveStatus([c('lnd_sync', 'unknown')], false), 'down');
  assert.equal(deriveStatus([c('lnd_sync', 'fail')], false), 'down');
  assert.equal(deriveStatus([c('cashu_mint', 'fail')], false), 'down');
  assert.equal(deriveStatus([c('database', 'fail')], false), 'down');
  assert.equal(deriveStatus([c('relays', 'fail')], false), 'down');
  assert.equal(deriveStatus([c('payouts', 'fail')], false), 'degraded');
  assert.equal(deriveStatus([c('cashu_mint', 'unknown')], false), 'degraded');
  assert.equal(deriveStatus([c('relays', 'warn')], false), 'degraded');
  assert.equal(deriveStatus([c('relays', 'ok')], true), 'degraded');
});

test('the worse of two statuses is kept', () => {
  assert.equal(worseStatus('ok', 'down'), 'down');
  assert.equal(worseStatus('degraded', 'ok'), 'degraded');
  assert.equal(worseStatus('down', 'degraded'), 'down');
  assert.equal(worseStatus('ok', 'ok'), 'ok');
});

test('an info event gives the name, the fee and the version', () => {
  const { valid, info } = parseInfo(infoEvent(), yes);

  assert.equal(valid, true);
  assert.deepEqual(info, { pubkey: PK, id: ID, createdAt: NOW, name: 'Info Mostro', fee: 0.006, version: '0.19.3' });
});

test('an info event with a bad shape, signature or d is rejected', () => {
  assert.equal(parseInfo(null, yes).reason, 'not kind 38385');
  assert.equal(parseInfo(healthEvent(), yes).reason, 'not kind 38385');
  assert.equal(parseInfo({ ...infoEvent(), pubkey: 'x' }, yes).reason, 'malformed event');
  assert.equal(parseInfo({ ...infoEvent(), tags: [['d']] }, yes).reason, 'd is not the author');
  assert.equal(parseInfo({ ...infoEvent(), tags: [[1]] }, yes).reason, 'malformed tags');
  assert.equal(parseInfo({ ...infoEvent(), created_at: -5 }, yes).reason, 'bad created_at');
  assert.equal(parseInfo(infoEvent(), no).reason, 'invalid signature');
});

test('an info event without a name, fee or version gives null for each', () => {
  const { info } = parseInfo(infoEvent({ y: null, fee: null, mostro_version: null }), yes);

  assert.equal(info.name, null);
  assert.equal(info.fee, null);
  assert.equal(info.version, null);
});

test('an info event whose y is not mostro gives no name', () => {
  assert.equal(parseInfo(infoEvent({ y: ['other', 'Name'] }), yes).info.name, null);
});

test('a fee that is not a plain decimal fraction of at most 1 is ignored, not trusted', () => {
  assert.equal(parseInfo(infoEvent({ fee: ['1e3'] }), yes).info.fee, null);
  assert.equal(parseInfo(infoEvent({ fee: ['-0.1'] }), yes).info.fee, null);
  assert.equal(parseInfo(infoEvent({ fee: ['1.5'] }), yes).info.fee, null);
  assert.equal(parseInfo(infoEvent({ fee: ['0'] }), yes).info.fee, 0);
});

test('a name or version longer than 64 characters is cut, and a blank one is absent', () => {
  const long = 'x'.repeat(70);

  const { info } = parseInfo(infoEvent({ y: ['mostro', long], mostro_version: [long] }), yes);

  assert.equal(info.name, `${'x'.repeat(63)}…`);
  assert.equal(info.version, `${'x'.repeat(63)}…`);
  assert.equal(parseInfo(infoEvent({ y: ['mostro', '   '] }), yes).info.name, null);
});

test('the newer info event wins, and on the same second the lower id', () => {
  const at = (createdAt, id) => ({ createdAt, id });

  assert.equal(newerInfo(at(2, 'b'), at(1, 'a')), true);
  assert.equal(newerInfo(at(1, 'a'), at(1, 'b')), true);
  assert.equal(newerInfo(at(1, 'b'), at(1, 'a')), false);
  assert.equal(newerInfo(at(1, 'a'), undefined), true);
});

test('a verifier that throws on a malformed signature rejects the event instead of breaking the reader', () => {
  assert.equal(reason(healthEvent(), NOW, throws), 'invalid signature');
  assert.equal(parseInfo(infoEvent(), throws).reason, 'invalid signature');
});

test('a Lightning event missing lnd_sync or payouts reads them as unknown, so it is never green', () => {
  const { report } = parseHealthEvent(healthEvent({}, { checks: [['relays', 'ok', SINCE], ['database', 'ok', SINCE]] }), NOW, yes);

  assert.deepEqual(report.checks, [
    { name: 'relays', state: 'ok', since: 1791900000 },
    { name: 'database', state: 'ok', since: 1791900000 },
    { name: 'lnd_sync', state: 'unknown', since: null },
    { name: 'payouts', state: 'unknown', since: null },
  ]);
  assert.equal(deriveStatus(report.checks, report.maintenance), 'down');
});

test('a Cashu event missing cashu_mint reads it as unknown', () => {
  const event = healthEvent(
    { escrow_mode: ['cashu'], lnd_block_height: null, lnd_synced_to_chain: null, lnd_network: null },
    { checks: [['relays', 'ok', SINCE], ['database', 'ok', SINCE]] },
  );

  const { report } = parseHealthEvent(event, NOW, yes);

  assert.deepEqual(report.checks.at(-1), { name: 'cashu_mint', state: 'unknown', since: null });
  assert.equal(deriveStatus(report.checks, report.maintenance), 'degraded');
});

test('a Cashu mint check follows the protocol: fail is down, warn is degraded', () => {
  const c = (state) => [{ name: 'cashu_mint', state, since: 0 }];

  assert.equal(deriveStatus(c('fail'), false), 'down');
  assert.equal(deriveStatus(c('warn'), false), 'degraded');
});

test('tags the protocol does not list are ignored on both shapes', () => {
  const instance = healthEvent();
  instance.tags.push(['client', 'something'], ['t', 'mostro']);
  const watcher = watcherEvent();
  watcher.tags.push(['alt', 'heartbeat']);

  assert.equal(parseHealthEvent(instance, NOW, yes).valid, true);
  assert.equal(parseHealthEvent(watcher, NOW, yes).valid, true);
});

test('an info event more than 300 seconds in the future is ignored', () => {
  assert.equal(parseInfoEvent(infoEvent({}, { createdAt: NOW + 301 }), NOW, yes).reason, 'dated in the future');
  assert.equal(parseInfoEvent(infoEvent({}, { createdAt: NOW + 300 }), NOW, yes).valid, true);
});

test('an info event repeating d, y, fee or mostro_version is rejected', () => {
  for (const [name, value] of [['d', PK], ['y', 'mostro'], ['fee', '0.01'], ['mostro_version', '1']]) {
    const event = infoEvent();
    event.tags.push([name, value]);
    assert.equal(parseInfo(event, yes).reason, `repeated ${name}`, name);
  }
});

test('control and bidirectional characters are removed from text, never shown', () => {
  const { report } = parseHealthEvent(healthEvent({ y: ['mostro', '\u202Eevil\nname\u2066'], mostro_version: ['0.19\u00003'] }), NOW, yes);

  assert.equal(report.name, 'evil name');
  assert.equal(report.version, '0.19 3');
  assert.equal(parseHealthEvent(healthEvent({ y: ['mostro', '\u202E\u200F'] }), NOW, yes).report.name, null);
});

test('emoji, accents and flags in a name are kept', () => {
  const name = 'Mostro ₿oliviano 🇧🇴 España';

  assert.equal(parseHealthEvent(healthEvent({ y: ['mostro', name] }), NOW, yes).report.name, name);
});

test('an event with too many tags, a huge content or a huge tag value is refused before its signature is checked', () => {
  let verified = false;
  const spy = () => {
    verified = true;
    return true;
  };
  const manyTags = healthEvent();
  for (let i = 0; i < 300; i += 1) manyTags.tags.push(['x', String(i)]);
  const hugeContent = healthEvent({ p: [OTHER] }, { content: 'a'.repeat(200000) });
  const hugeValue = healthEvent();
  hugeValue.tags.push(['x', 'a'.repeat(5000)]);

  assert.equal(parseHealthEvent(manyTags, NOW, spy).reason, 'too large');
  assert.equal(parseHealthEvent(hugeContent, NOW, spy).reason, 'too large');
  assert.equal(parseHealthEvent(hugeValue, NOW, spy).reason, 'too large');
  assert.equal(verified, false);
});

test('an info event must say z = info, exactly once', () => {
  const repeated = infoEvent();
  repeated.tags.push(['z', 'info']);

  assert.equal(parseInfo(infoEvent({ z: null }), yes).reason, 'missing z');
  assert.equal(parseInfo(infoEvent({ z: ['dev-fee-payment'] }), yes).reason, 'bad z');
  assert.equal(parseInfo(repeated, yes).reason, 'repeated z');
});
