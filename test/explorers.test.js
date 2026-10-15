import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchTip, refreshTips, explorerUrls } from '../src/explorers.js';

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
  assert.deepEqual([...tips], [[B, { height: 971480, at: NOW - 600 }], [A, { height: 971490, at: NOW }]]);
  assert.equal(before.has(A), false, 'the old map is left as it was');
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
