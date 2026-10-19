import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchTip, refreshTips, explorerUrls, parseTips } from '../src/explorers.js';

const NOW = 1792000000;
const A = 'https://a.example/tip';
const B = 'https://b.example/tip';

function fakeFetch(answers) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const answer = answers[url];
    if (answer instanceof Error) throw answer;
    return { ok: answer.status === undefined || answer.status < 400, status: answer.status ?? 200, text: async () => answer.body };
  };
  return { fetchImpl, calls };
}

test('a tip is the integer an explorer answers with', async () => {
  const { fetchImpl, calls } = fakeFetch({ [A]: { body: '971485\n' } });

  assert.equal(await fetchTip(A, fetchImpl, 5000), 971485);
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.redirect, 'error');
  assert.ok(calls[0].options.signal);
});

test('an answer that is not a plain integer, or an HTTP error, is refused', async () => {
  const { fetchImpl } = fakeFetch({ [A]: { body: '9.7e5' }, [B]: { status: 503, body: 'down' } });

  await assert.rejects(fetchTip(A, fetchImpl, 5000), /not a block height/);
  await assert.rejects(fetchTip(B, fetchImpl, 5000), /HTTP 503/);
});

test('a slow explorer is given up after the timeout', async () => {
  const fetchImpl = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason));
  });

  await assert.rejects(fetchTip(A, fetchImpl, 10));
});

test('a refresh keeps each new tip with its time, and the old tip of an explorer that failed', async () => {
  // Arrange
  const { fetchImpl } = fakeFetch({ [A]: { body: '971490' }, [B]: new Error('offline') });
  const before = new Map([[B, { height: 971480, at: NOW - 600 }]]);

  // Act
  const tips = await refreshTips({ urls: [A, B], tips: before, fetchImpl, now: NOW, timeoutMs: 5000 });

  // Assert
  assert.deepEqual([...tips], [[B, { height: 971480, at: NOW - 600 }], [A, { height: 971490, at: NOW, since: null, previous: null }]]);
  assert.equal(before.has(A), false, 'the old map is left as it was');
});

test('a tip found on the first look has no history: nobody knows how long it had been there', async () => {
  const { fetchImpl } = fakeFetch({ [A]: { body: '971490' } });

  const tips = await refreshTips({ urls: [A], tips: new Map(), fetchImpl, now: NOW, timeoutMs: 5000 });

  assert.deepEqual(tips.get(A), { height: 971490, at: NOW, since: null, previous: null });
});

test('a tip that moved remembers since when, and what the explorer answered before', async () => {
  const { fetchImpl } = fakeFetch({ [A]: { body: '971493' } });
  const before = new Map([[A, { height: 971490, at: NOW - 60, since: null, previous: null }]]);

  const tips = await refreshTips({ urls: [A], tips: before, fetchImpl, now: NOW, timeoutMs: 5000 });

  assert.deepEqual(tips.get(A), { height: 971493, at: NOW, since: NOW, previous: { height: 971490, at: NOW - 60 } });
});

test('a tip that did not move keeps its history and only renews its time', async () => {
  const { fetchImpl } = fakeFetch({ [A]: { body: '971493' } });
  const history = { since: NOW - 120, previous: { height: 971490, at: NOW - 180 } };
  const before = new Map([[A, { height: 971493, at: NOW - 60, ...history }]]);

  const tips = await refreshTips({ urls: [A], tips: before, fetchImpl, now: NOW, timeoutMs: 5000 });

  assert.deepEqual(tips.get(A), { height: 971493, at: NOW, ...history });
});

test('stored tips are read back for the configured explorers only, and anything malformed is dropped', () => {
  const good = { height: 971493, at: NOW, since: NOW - 60, previous: { height: 971490, at: NOW - 120 } };
  const raw = [
    [A, good],
    [B, { height: '971490', at: NOW, since: null, previous: null }],
    ['https://gone.example/tip', { height: 1, at: NOW, since: null, previous: null }],
    [A + '/x', { height: 2, at: NOW, since: NOW, previous: null }],
    'not an entry',
  ];

  const tips = parseTips(raw, [A, B, A + '/x']);

  assert.deepEqual([...tips], [[A, good]]);
  assert.deepEqual([...parseTips({ [A]: good }, [A])], [], 'not a list of entries');
  assert.deepEqual([...parseTips(null, [A])], []);
});

test('only the explorers of networks with a trusted instance are asked', () => {
  const explorers = new Map([['mainnet', [A, B]], ['signet', ['https://s.example/tip']], ['testnet', ['https://t.example']]]);
  const trusted = { instances: [{ network: 'mainnet' }, { network: 'regtest' }, { network: 'mainnet' }] };

  assert.deepEqual(explorerUrls(explorers, trusted), [A, B]);
});

test('an answer longer than a block height could be is refused', async () => {
  const { fetchImpl } = fakeFetch({ [A]: { body: '9'.repeat(40) } });

  await assert.rejects(fetchTip(A, fetchImpl, 5000), /not a block height/);
});
