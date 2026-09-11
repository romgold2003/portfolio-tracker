/**
 * The percentage curve on the home page.
 *
 * The whole risk here is one thing: a percentage read straight off the account
 * curve is not a return. Money paid in raises the account without earning
 * anything, and dividing the new value by the old one reports the deposit as
 * performance. This file exists to keep that from creeping back.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../src/core/store.js';
import { returnSeries, curveSeries } from '../src/core/snapshots.js';

const DAY = 86_400_000;
const iso = (back) => new Date(Date.now() - back * DAY).toISOString().slice(0, 10);

/** Snapshots, newest last, given as [daysAgo, value]. */
const snaps = (points) => points.map(([back, value]) => ({ date: iso(back), value }));

const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const last = (s) => s.data[s.data.length - 1];

beforeEach(() => {
  state.snapshots = [];
  state.positions = [];
  state.cash = 0;
});

describe('the percentage curve', () => {
  test('starts at zero, because a window starts where it starts', () => {
    state.snapshots = snaps([[3, 10000], [2, 10500], [1, 11000]]);
    const s = returnSeries('1M', []);
    assert.equal(s.data[0], 0);
  });

  test('with no money moving, it is the plain change', () => {
    state.snapshots = snaps([[3, 10000], [2, 10500], [1, 11000]]);
    assert.ok(near(last(returnSeries('1M', [])), 10), `${last(returnSeries('1M', []))}`);
  });

  test('a deposit is not a return', () => {
    // The account doubles, but every cent of the rise was paid in.
    state.snapshots = snaps([[3, 10000], [2, 20000], [1, 20000]]);
    const flows = [{ date: iso(2), amount: 10000 }];
    assert.ok(near(last(returnSeries('1M', flows)), 0), `${last(returnSeries('1M', flows))}`);
    // And without telling it about the flow it would have said +100%.
    assert.ok(near(last(returnSeries('1M', [])), 100));
  });

  test('a withdrawal is not a loss', () => {
    state.snapshots = snaps([[3, 20000], [2, 10000], [1, 10000]]);
    const flows = [{ date: iso(2), amount: -10000 }];
    assert.ok(near(last(returnSeries('1M', flows)), 0), `${last(returnSeries('1M', flows))}`);
  });

  test('earning through a deposit still counts the earning', () => {
    // 10,000 -> deposit 10,000 -> 21,000. The 1,000 is real; the 10,000 is not.
    state.snapshots = snaps([[3, 10000], [2, 21000], [1, 21000]]);
    const flows = [{ date: iso(2), amount: 10000 }];
    assert.ok(near(last(returnSeries('1M', flows)), 10), `${last(returnSeries('1M', flows))}`);
  });

  test('it compounds rather than adding', () => {
    // +10% then +10% is +21%, not +20%.
    state.snapshots = snaps([[3, 10000], [2, 11000], [1, 12100]]);
    assert.ok(near(last(returnSeries('1M', [])), 21), `${last(returnSeries('1M', []))}`);
  });

  test('two flows on one day are netted, not applied twice', () => {
    state.snapshots = snaps([[3, 10000], [2, 20000], [1, 20000]]);
    const flows = [
      { date: iso(2), amount: 12000 },
      { date: iso(2), amount: -2000 },
    ];
    assert.ok(near(last(returnSeries('1M', flows)), 0), `${last(returnSeries('1M', flows))}`);
  });

  test('the timing of a deposit does not change the answer', () => {
    // This is what makes it time-weighted, and what separates it from the
    // money-weighted figure the Monthly page reports beside its own.
    state.snapshots = snaps([[4, 10000], [3, 11000], [2, 21000], [1, 23100]]);
    const lateFlow = [{ date: iso(2), amount: 10000 }];
    // Same underlying performance, deposit a day earlier.
    state.snapshots = snaps([[4, 10000], [3, 20000], [2, 22000], [1, 24200]]);
    const earlyFlow = [{ date: iso(3), amount: 10000 }];
    const early = last(returnSeries('1M', earlyFlow));

    state.snapshots = snaps([[4, 10000], [3, 11000], [2, 21000], [1, 23100]]);
    const lateR = last(returnSeries('1M', lateFlow));

    assert.ok(near(early, 21, 0.5), `early ${early}`);
    assert.ok(near(lateR, 21, 0.5), `late ${lateR}`);
  });

  test('a day with no capital behind it does not poison the chain', () => {
    state.snapshots = snaps([[3, 0], [2, 5000], [1, 5500]]);
    const s = returnSeries('1M', []);
    assert.ok(s.data.every((v) => Number.isFinite(v)), JSON.stringify(s.data));
    assert.ok(near(last(s), 10), `${last(s)}`);
  });

  test('malformed flows are ignored rather than thrown', () => {
    state.snapshots = snaps([[3, 10000], [2, 11000], [1, 11000]]);
    const flows = [null, { date: null, amount: 5 }, { date: iso(2), amount: NaN }];
    assert.ok(near(last(returnSeries('1M', flows)), 10));
  });

  test('it covers the same window and labels as the dollar curve', () => {
    state.snapshots = snaps([[3, 10000], [2, 10500], [1, 11000]]);
    const dollars = curveSeries('1M');
    const percent = returnSeries('1M', []);
    assert.deepEqual(percent.labels, dollars.labels);
    assert.equal(percent.data.length, dollars.data.length);
    assert.equal(percent.from, dollars.from);
    assert.equal(percent.to, dollars.to);
  });

  test('All reaches back to the first thing recorded', () => {
    state.snapshots = snaps([[400, 10000], [200, 12000], [1, 13000]]);
    const s = returnSeries('All', []);
    assert.equal(s.data.length, 3, 'every recorded point should be in the All window');
    assert.ok(near(last(s), 30), `${last(s)}`);
  });
});

describe('the window the curve actually covers', () => {
  /** Recording starts 1 August; the trades go back further, as they always do. */
  const recordFrom = (month, dayOfMonth) => {
    const out = [];
    const end = new Date();
    for (let d = new Date(Date.UTC(end.getUTCFullYear(), month, dayOfMonth)); d <= end;
      d.setUTCDate(d.getUTCDate() + 1)) {
      out.push({ date: d.toISOString().slice(0, 10), value: 30000 });
    }
    return out;
  };

  test('a window the record cannot reach is marked, not quietly shortened', () => {
    // This is the bug: a YTD curve drew six weeks, reported 6.34%, and the
    // figure beside it said 25.49% for the actual year. Both were right about
    // different periods and nothing on screen said which.
    state.snapshots = recordFrom(new Date().getUTCMonth(), 1);
    const ytd = curveSeries('YTD');
    if (ytd.wanted && ytd.from > ytd.wanted) {
      assert.equal(ytd.short, true, 'a truncated window must say so');
    }
  });

  test('a window the record does cover is not marked', () => {
    state.snapshots = recordFrom(0, 1);
    assert.equal(curveSeries('1W').short, false);
    assert.equal(curveSeries('1M').short, false);
  });

  test('a rolling window is not marked over a one-day boundary', () => {
    // The cutoff carries a time of day and a snapshot date does not, so the
    // first point inside any rolling window lands a day after it. Comparing
    // those flagged every timeframe, including a fully covered week.
    state.snapshots = recordFrom(0, 1);
    for (const tf of ['1W', '1M', '3M']) {
      assert.equal(curveSeries(tf).short, false, `${tf} was wrongly flagged`);
    }
  });

  test('All is never marked, because All is whatever there is', () => {
    state.snapshots = recordFrom(new Date().getUTCMonth(), 1);
    const all = curveSeries('All');
    assert.equal(all.wanted, null);
    assert.equal(all.short, false);
  });

  test('the percentage series carries the same coverage flags', () => {
    state.snapshots = recordFrom(new Date().getUTCMonth(), 1);
    const ytd = returnSeries('YTD', []);
    assert.equal(ytd.short, curveSeries('YTD').short);
    assert.equal(ytd.wanted, curveSeries('YTD').wanted);
  });
});
