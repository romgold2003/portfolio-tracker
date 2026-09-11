/**
 * The comparison curve: you, the S&P and the Nasdaq on one axis.
 *
 * The risk here is alignment. The account is valued on the days the app was
 * opened — weekends included, because a Sunday still has an account value —
 * while an index only closes on trading days. Lining the two up by position
 * slides the whole comparison by however many non-trading days fall in the
 * window, and the error grows the longer the window is.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { alignedReturns, COMPARISONS } from '../src/services/benchmark.js';

const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

/** Closes on trading days only — Friday 4th, then Monday 7th. */
const rows = [
  { date: '2026-09-04', close: 100 },
  { date: '2026-09-07', close: 110 },
  { date: '2026-09-08', close: 121 },
];

describe('aligning an index to the account days', () => {
  test('rebases to zero at the first day of the window', () => {
    const out = alignedReturns(['2026-09-04', '2026-09-07'], rows);
    assert.equal(out[0], 0);
  });

  test('a weekend reads the last close before it, not the next one', () => {
    // 5th and 6th are a weekend. Both must still be Friday's 100, or the index
    // appears to move on days it did not trade.
    const out = alignedReturns(['2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07'], rows);
    assert.deepEqual(out.slice(0, 3), [0, 0, 0]);
    assert.ok(near(out[3], 10), `${out[3]}`);
  });

  test('does not slide when the account has more days than the index', () => {
    // Six account days, three closes. Aligned by position the last point would
    // read the 8th's close on the 4th day and be wrong by two sessions.
    const out = alignedReturns(
      ['2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08'],
      rows,
    );
    assert.ok(near(out[4], 21), `${out[4]}`);
  });

  test('compounds like the account curve does', () => {
    // 100 -> 110 -> 121 is +21%, not +20%.
    const out = alignedReturns(['2026-09-04', '2026-09-08'], rows);
    assert.ok(near(out[1], 21));
  });

  test('a fall is negative', () => {
    const falling = [{ date: '2026-09-04', close: 100 }, { date: '2026-09-08', close: 80 }];
    const out = alignedReturns(['2026-09-04', '2026-09-08'], falling);
    assert.ok(near(out[1], -20), `${out[1]}`);
  });

  test('a window opening before the history starts where the data starts', () => {
    // This used to refuse the whole series, and that was the bug: a year-to-date
    // window opens on the first of January, which is a market holiday, so both
    // benchmarks vanished from the YTD chart entirely. A line that begins on the
    // second is a far better answer than no line.
    const out = alignedReturns(['2026-01-01', '2026-09-04', '2026-09-08'], rows);
    assert.equal(out[0], null, 'a day before any close has no value');
    assert.equal(out[1], 0, 'the first real close is the baseline');
    assert.ok(out[2] > 0);
  });

  test('a day with no close is a hole, not a zero', () => {
    // Chart.js joins across null with spanGaps; a zero would draw a crash.
    const gappy = [{ date: '2026-09-04', close: 100 }, { date: '2026-09-08', close: 110 }];
    const out = alignedReturns(['2026-09-03', '2026-09-04', '2026-09-08'], gappy);
    assert.deepEqual(out, [null, 0, 10]);

    const inside = alignedReturns(['2026-09-04', '2026-09-08'], gappy);
    assert.ok(inside.every((v) => v != null));
  });

  test('nothing to align is null rather than a flat line at zero', () => {
    assert.equal(alignedReturns([], rows), null);
    assert.equal(alignedReturns(['2026-09-04'], []), null);
    assert.equal(alignedReturns(['2026-09-04'], null), null);
  });

  test('a close of zero is skipped rather than used as a baseline', () => {
    // Dividing by it would produce infinities across the whole series.
    const broken = [{ date: '2026-09-04', close: 0 }, { date: '2026-09-08', close: 110 }];
    assert.deepEqual(alignedReturns(['2026-09-04', '2026-09-08'], broken), [null, 0]);
  });

  test('no usable close anywhere is still null', () => {
    const dead = [{ date: '2026-09-04', close: 0 }];
    assert.equal(alignedReturns(['2026-09-04', '2026-09-08'], dead), null);
  });
});

describe('what is compared', () => {
  test('is the S&P and the Nasdaq, each with its own colour', () => {
    assert.deepEqual(COMPARISONS.map((c) => c.label), ['S&P 500', 'Nasdaq 100']);
    const colours = new Set(COMPARISONS.map((c) => c.colour));
    assert.equal(colours.size, COMPARISONS.length, 'two series share a colour');
    // And neither may take the green the account line uses.
    assert.ok(!colours.has('#3dba6a'), 'a benchmark took the account colour');
  });

  test('every entry carries a fetchable ticker', () => {
    for (const c of COMPARISONS) {
      assert.match(c.symbol, /^[A-Z]{1,5}$/, `${c.symbol} is not a plain ticker`);
    }
  });
});
