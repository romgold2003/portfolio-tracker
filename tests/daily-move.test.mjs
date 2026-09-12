/**
 * The day's move, and the close it is measured from.
 *
 * Checked against a real holding on a real session: 291 shares of ETHA on 11
 * September 2026, 18.56 to 19.16, which is 174.60 dollars. Every figure on the
 * overview that describes today stands on this one number.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { dailyDollar } from '../src/core/portfolio.js';


describe("the close today's move is measured from", () => {
  /**
   * The day's baseline is taken from the feed, not rebuilt from the percentage.
   *
   * `cur / (1 + dailyChg)` recovers the previous close only while those two
   * fields come from the same moment. The price is written by the regular
   * refresh, by the extended-hours pass and by a statement import, so any of
   * them landing between the other two leaves a percentage describing a price
   * that has moved on — and the reconstruction then shifts the whole day's
   * baseline, taking every figure standing on it along.
   */
  test('is used directly when the quote supplied it', () => {
    // ETHA on 11 September: 291 shares, 18.56 to 19.16.
    const p = {
      status: 'Open', dir: 'Long', ticker: 'ETHA', qty: 291,
      entry: 19.19, cur: 19.16, prevClose: 18.56, dailyChg: 3.2327586,
      open: '2026-02-03',
    };
    assert.ok(Math.abs(dailyDollar(p, '2026-09-11') - 174.6) < 0.01,
      `${dailyDollar(p, '2026-09-11')}`);
  });

  test('and a stale percentage can no longer move it', () => {
    // The price has been updated; the percentage still describes the old one.
    // Rebuilt from that ratio the baseline lands at 18.25 and the day reads
    // nearly five dollars a share instead of sixty cents.
    const stale = {
      status: 'Open', dir: 'Long', ticker: 'ETHA', qty: 291,
      entry: 19.19, cur: 19.16, prevClose: 18.56, dailyChg: 25,
      open: '2026-02-03',
    };
    assert.ok(Math.abs(dailyDollar(stale, '2026-09-11') - 174.6) < 0.01,
      'the stale percentage was used instead of the close');
  });

  test('the percentage still answers for a position quoted before this existed', () => {
    const old = {
      status: 'Open', dir: 'Long', ticker: 'ETHA', qty: 291,
      entry: 19.19, cur: 19.16, dailyChg: 3.2327586, open: '2026-02-03',
    };
    assert.ok(Math.abs(dailyDollar(old, '2026-09-11') - 174.6) < 0.01);
  });

  test('a short measures the same close in its own direction', () => {
    const short = {
      status: 'Open', dir: 'Short', ticker: 'ETHA', qty: 10,
      entry: 19, cur: 19.16, prevClose: 18.56, open: '2026-02-03',
    };
    assert.ok(Math.abs(dailyDollar(short, '2026-09-11') + 6) < 0.01);
  });

  test('a nonsense close is ignored rather than trusted', () => {
    const bad = {
      status: 'Open', dir: 'Long', ticker: 'ETHA', qty: 291,
      entry: 19.19, cur: 19.16, prevClose: 0, dailyChg: 3.2327586, open: '2026-02-03',
    };
    assert.ok(Math.abs(dailyDollar(bad, '2026-09-11') - 174.6) < 0.01);
  });

  test('it survives a reload', async () => {
    const { loadState, state } = await import('../src/core/store.js');
    loadState({
      positions: [{
        id: 1, ticker: 'ETHA', status: 'Open', dir: 'Long', qty: 291,
        entry: 19.19, cur: 19.16, prevClose: 18.56, open: '2026-02-03',
      }],
      cash: 0,
    });
    assert.equal(state.positions[0].prevClose, 18.56);
  });
});
