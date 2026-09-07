/**
 * The budget that keeps a read from waiting on a write.
 *
 * This exists because production returned 504 on the first request into a cold
 * function: the feed awaited a full sweep of five chains, Vercel cut it at
 * sixty seconds, and the reader got nothing from a store that already held
 * thirty-three good rows. The rule these tests pin down is that the answer goes
 * out on time whatever the sweep is doing.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { withBudget } from '../api/_lib/budget.js';

const after = (ms, value) => new Promise((r) => { setTimeout(() => r(value), ms); });
const failsAfter = (ms) => new Promise((_, reject) => {
  setTimeout(() => reject(new Error('the chains are down')), ms);
});

describe('waiting, but not indefinitely', () => {
  test('work that lands in time is the answer', async () => {
    assert.equal(await withBudget(after(5, 'fresh'), 200, 'stale'), 'fresh');
  });

  test('work that overruns is not waited for', async () => {
    const t0 = Date.now();
    assert.equal(await withBudget(after(5_000, 'fresh'), 30, 'stale'), 'stale');
    // The point of the whole file: the answer went out on time.
    assert.ok(Date.now() - t0 < 1_000, 'the answer waited for the work anyway');
  });

  test('the overrunning work is left running, not cancelled', async () => {
    let finished = false;
    const work = after(40, 'fresh').then((v) => { finished = true; return v; });
    assert.equal(await withBudget(work, 5, 'stale'), 'stale');
    assert.equal(finished, false, 'it should not have finished yet');
    assert.equal(await work, 'fresh');
    assert.equal(finished, true, 'the sweep was cancelled — it must keep going');
  });

  test('work that fails answers with the fallback rather than throwing', async () => {
    // A provider having a bad afternoon must not take the page down with it.
    assert.equal(await withBudget(failsAfter(5), 200, 'stale'), 'stale');
  });

  test('a failure after the budget has passed is swallowed, not unhandled', async () => {
    // An unhandled rejection here would take the whole function down a beat
    // after it had already answered successfully.
    assert.equal(await withBudget(failsAfter(30), 5, 'stale'), 'stale');
    await after(60);
  });

  test('a budget of zero starts the work and waits for none of it', async () => {
    let started = false;
    const work = Promise.resolve().then(() => { started = true; return 'fresh'; });
    assert.equal(await withBudget(work, 0, 'stale'), 'stale');
    await work;
    assert.equal(started, true, 'the work was never started');
  });

  test('a value rather than a promise still works', async () => {
    assert.equal(await withBudget('fresh', 50, 'stale'), 'fresh');
  });

  test('the fallback can be any shape, including the last good answer', async () => {
    const last = { failed: [], written: 0, at: 0, slow: true };
    assert.deepEqual(await withBudget(after(500, null), 10, last), last);
  });
});
