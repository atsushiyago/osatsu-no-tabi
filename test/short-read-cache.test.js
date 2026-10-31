import test from 'node:test';
import assert from 'node:assert/strict';
import { createShortReadCache } from '../src/utils/shortReadCache.ts';

test('Home revisits reuse reads for 30 seconds, then fetch fresh results', async () => {
  let time = 0;
  let reads = 0;
  const cache = createShortReadCache(30_000, () => time);
  const load = async () => ++reads;
  assert.equal(await cache.get('anonymous-a', load), 1);
  time = 29_999;
  assert.equal(await cache.get('anonymous-a', load), 1);
  time = 30_000;
  assert.equal(await cache.get('anonymous-a', load), 2);
});

test('different UIDs never reuse private results, and invalidation forces a fresh read', async () => {
  let reads = 0;
  const cache = createShortReadCache(30_000);
  assert.equal(await cache.get('anonymous-a', async () => { reads++; return 'a'; }), 'a');
  assert.equal(await cache.get('google-b', async () => { reads++; return 'b'; }), 'b');
  cache.clear();
  assert.equal(await cache.get('anonymous-a', async () => { reads++; return 'updated-a'; }), 'updated-a');
  assert.equal(reads, 3);
});

test('overlapping effects share one pending read, even if it exceeds the TTL', async () => {
  let time = 0;
  let reads = 0;
  let finish;
  const cache = createShortReadCache(30_000, () => time);
  const load = () => { reads++; return new Promise((resolve) => { finish = resolve; }); };
  const first = cache.get('uid', load);
  await Promise.resolve();
  time = 40_000;
  const second = cache.get('uid', load);
  assert.equal(first, second);
  assert.equal(reads, 1);
  finish('result');
  await first;
  assert.equal(await cache.get('uid', async () => 'fresh'), 'fresh');
});

test('late reads cannot restore invalidated data after a seen update, registration, or account switch', async () => {
  let finish;
  const cache = createShortReadCache(30_000);
  const old = cache.get('uid', () => new Promise((resolve) => { finish = resolve; }));
  await Promise.resolve();
  cache.clear();
  assert.equal(await cache.get('uid', async () => 'new'), 'new');
  finish('old');
  assert.equal(await old, 'old');
  assert.equal(await cache.get('uid', async () => 'unexpected'), 'new');
});

test('failed requests are not cached and an old failure cannot evict newer data', async () => {
  const cache = createShortReadCache(30_000);
  await assert.rejects(cache.get('uid', async () => { throw new Error('offline'); }));
  let rejectOld;
  const old = cache.get('uid', () => new Promise((_resolve, reject) => { rejectOld = reject; }));
  await Promise.resolve();
  cache.clear();
  assert.equal(await cache.get('uid', async () => 'recovered'), 'recovered');
  rejectOld(new Error('late failure'));
  await assert.rejects(old);
  assert.equal(await cache.get('uid', async () => 'unexpected'), 'recovered');
});
