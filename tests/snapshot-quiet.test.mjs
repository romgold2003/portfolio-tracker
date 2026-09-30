/**
 * The daily snapshot, and the write it is not allowed to make.
 *
 * It runs every five minutes for as long as the app is open. A save reaches the
 * cloud vault, so writing unconditionally meant a database write every five
 * minutes for ever — overnight, at weekends, with the tab hidden and the figure
 * unchanged. The database suspends after five minutes of quiet, so that
 * schedule was exactly the one thing that could stop it ever sleeping. It
 * stayed awake all month and the allowance ran out.
 *
 * These tests are about silence: that nothing is written when nothing moved,
 * and that a real move is still written.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../src/core/store.js';
import { recordDailySnapshot } from '../src/core/snapshots.js';
import { todayStr } from '../src/core/portfolio.js';

beforeEach(() => {
  state.positions = [];
  state.cash = 10_000;
  state.snapshots = [];
});

describe('a value that has not moved', () => {
  test('is written once, then not again', () => {
    recordDailySnapshot();
    const first = state.snapshots.find((s) => s.date === todayStr());
    assert.ok(first, 'the first run has to record the day');
    assert.equal(first.value, 10_000);

    // Nothing has changed. Five minutes later, and five after that.
    const stamp = { ...first };
    recordDailySnapshot();
    recordDailySnapshot();

    assert.equal(state.snapshots.length, 1, 'the day must not be recorded twice');
    assert.deepEqual({ ...state.snapshots[0] }, stamp, 'the point must be untouched');
  });

  test('is not disturbed by a fraction of a penny', () => {
    // The total is a sum of floats; re-adding the same numbers can land a
    // hair apart. That is not a change worth a database write.
    recordDailySnapshot();
    state.cash = 10_000 + 0.001;
    recordDailySnapshot();
    assert.equal(state.snapshots[0].value, 10_000, 'a sub-cent drift rewrote the point');
  });
});

describe('a value that has moved', () => {
  test('is still written', () => {
    recordDailySnapshot();
    state.cash = 10_500;
    recordDailySnapshot();
    assert.equal(state.snapshots[0].value, 10_500);
    assert.equal(state.snapshots.length, 1, 'the day is overwritten, not appended to');
  });

  test('down as well as up', () => {
    recordDailySnapshot();
    state.cash = 9_400;
    recordDailySnapshot();
    assert.equal(state.snapshots[0].value, 9_400);
  });

  test('by a whole cent, which is the smallest real move', () => {
    recordDailySnapshot();
    state.cash = 10_000.01;
    recordDailySnapshot();
    assert.equal(state.snapshots[0].value, 10_000.01);
  });
});

describe('the day itself', () => {
  test('a day with no point yet always gets one, moved or not', () => {
    state.snapshots = [{ date: '2020-01-01', value: 10_000 }];
    recordDailySnapshot();
    const today = state.snapshots.find((s) => s.date === todayStr());
    assert.ok(today, 'an identical value on an earlier day must not suppress today');
    assert.equal(today.value, 10_000);
    assert.equal(state.snapshots.length, 2);
  });

  test('yesterday is left alone', () => {
    state.snapshots = [{ date: '2020-01-01', value: 42 }];
    recordDailySnapshot();
    assert.equal(state.snapshots[0].value, 42);
  });
});
