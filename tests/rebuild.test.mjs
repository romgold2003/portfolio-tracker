/**
 * Reconstructing the account value on days the app was not open.
 *
 * The bug this exists for: the recorded curve starts the day the app was first
 * used, so a book traded since January drew six weeks and called it YTD.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  daysBetween, qtyHeldOn, cashOn, rebuildDailyValue, spliceHistory,
} from '../src/core/rebuild.js';

const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

/** A flat price book: every ticker at one price on every day. */
const flat = (prices) => (ticker) => prices[ticker] ?? null;

describe('the days in a range', () => {
  test('are every calendar day, ends included', () => {
    assert.deepEqual(daysBetween('2026-01-01', '2026-01-04'),
      ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
  });

  test('include weekends, because an account has a value on a Sunday', () => {
    const days = daysBetween('2026-09-04', '2026-09-07');
    assert.equal(days.length, 4);
  });

  test('an inverted or unreadable range is empty, not endless', () => {
    assert.deepEqual(daysBetween('2026-02-01', '2026-01-01'), []);
    assert.deepEqual(daysBetween('nonsense', '2026-01-01'), []);
  });
});

describe('how much was held on a day', () => {
  const position = {
    ticker: 'AAA', dir: 'Long', entry: 100, cur: 120, qty: 40, origQty: 100,
    open: '2026-03-01', status: 'Open',
    exits: [{ d: '2026-05-10', qty: 60, price: 110, pnl: 600 }],
  };

  test('is nothing before it was opened', () => {
    assert.equal(qtyHeldOn(position, '2026-02-28'), 0);
  });

  test('is the whole position before any exit', () => {
    assert.equal(qtyHeldOn(position, '2026-04-01'), 100);
  });

  test('drops on the day of a partial exit, not before it', () => {
    assert.equal(qtyHeldOn(position, '2026-05-09'), 100);
    assert.equal(qtyHeldOn(position, '2026-05-10'), 40);
  });
});

describe('cash walked backwards', () => {
  const positions = [
    {
      ticker: 'AAA', dir: 'Long', entry: 100, cur: 130, qty: 50,
      open: '2026-03-01', close: '2026-06-01', status: 'Closed',
      exits: [{ d: '2026-06-01', qty: 50, price: 130, pnl: 1500 }],
    },
  ];

  test('today is today', () => {
    assert.equal(cashOn(positions, 9000, [], '2026-07-01'), 9000);
  });

  test('before the sale, the proceeds had not arrived', () => {
    // 9,000 today less the 6,500 that came back on 1 June.
    assert.ok(near(cashOn(positions, 9000, [], '2026-05-31'), 2500));
  });

  test('before the purchase, the money had not been spent', () => {
    // 2,500 while held, plus the 5,000 that had not gone out yet.
    assert.ok(near(cashOn(positions, 9000, [], '2026-02-28'), 7500));
  });

  test('before a deposit, the deposit was not there', () => {
    const flows = [{ date: '2026-04-01', amount: 3000 }];
    assert.ok(near(cashOn(positions, 9000, flows, '2026-03-15'), 2500 - 3000));
  });

  test('a withdrawal is added back, not subtracted twice', () => {
    const flows = [{ date: '2026-04-01', amount: -1000 }];
    assert.ok(near(cashOn(positions, 9000, flows, '2026-03-15'), 2500 + 1000));
  });
});

describe('rebuilding the daily value', () => {
  const positions = [{
    ticker: 'AAA', dir: 'Long', entry: 100, cur: 120, qty: 100,
    open: '2026-01-05', status: 'Open',
  }];

  test('covers the whole range asked for, not just recent days', () => {
    const rows = rebuildDailyValue({
      positions, cash: 5000, flows: [], priceOn: flat({ AAA: 120 }),
      from: '2026-01-01', to: '2026-01-10',
    });
    assert.equal(rows.length, 10);
    assert.equal(rows[0].date, '2026-01-01');
    assert.equal(rows[rows.length - 1].date, '2026-01-10');
  });

  test('before the trade it is all cash, after it the position is valued', () => {
    const rows = rebuildDailyValue({
      positions, cash: 5000, flows: [], priceOn: flat({ AAA: 120 }),
      from: '2026-01-01', to: '2026-01-10',
    });
    const on = (d) => rows.find((r) => r.date === d).value;
    // 4 Jan: not yet bought, so the 10,000 of cost is still cash.
    assert.ok(near(on('2026-01-04'), 15000), `${on('2026-01-04')}`);
    // 5 Jan: 100 units at 120 plus the 5,000 left.
    assert.ok(near(on('2026-01-05'), 17000), `${on('2026-01-05')}`);
  });

  test('a day it cannot price is dropped, not valued short', () => {
    // Reporting the book without one of its holdings is not a smaller book,
    // it is a wrong number, and the dip would read as a loss.
    const rows = rebuildDailyValue({
      positions, cash: 5000, flows: [],
      priceOn: (t, d) => (d === '2026-01-07' ? null : 120),
      from: '2026-01-05', to: '2026-01-08',
    });
    assert.equal(rows.length, 3);
    assert.ok(!rows.some((r) => r.date === '2026-01-07'));
  });

  test('a short gains when the price falls', () => {
    const short = [{
      ticker: 'BBB', dir: 'Short', entry: 100, cur: 80, qty: 10,
      open: '2026-01-01', status: 'Open',
    }];
    const high = rebuildDailyValue({
      positions: short, cash: 0, flows: [], priceOn: flat({ BBB: 120 }),
      from: '2026-01-02', to: '2026-01-02',
    })[0].value;
    const low = rebuildDailyValue({
      positions: short, cash: 0, flows: [], priceOn: flat({ BBB: 80 }),
      from: '2026-01-02', to: '2026-01-02',
    })[0].value;
    assert.ok(low > high, `short should be worth more at 80 (${low}) than 120 (${high})`);
  });

  test('no price function is no series rather than a throw', () => {
    assert.deepEqual(rebuildDailyValue({ positions, from: '2026-01-01', to: '2026-01-02' }), []);
  });
});

describe('splicing the rebuild onto the recording', () => {
  const recorded = [
    { date: '2026-08-12', value: 45000 },
    { date: '2026-08-13', value: 45500 },
  ];
  const rebuilt = [
    { date: '2026-01-02', value: 20000 },
    { date: '2026-06-01', value: 30000 },
    { date: '2026-08-12', value: 40000 },
  ];

  test('the recorded days survive untouched', () => {
    const out = spliceHistory(recorded, rebuilt);
    const kept = out.filter((r) => r.date >= '2026-08-12');
    assert.deepEqual(kept, recorded);
  });

  test('the reconstructed days come first and reach back', () => {
    const out = spliceHistory(recorded, rebuilt);
    assert.equal(out[0].date, '2026-01-02');
    assert.ok(out.every((r, i) => i === 0 || r.date >= out[i - 1].date), 'out of order');
  });

  test('the join has no step in it', () => {
    // The rebuild said 40,000 on the join day and the account really held
    // 45,000. Left alone that draws as a 12% jump the account never made.
    const out = spliceHistory(recorded, rebuilt);
    const lastRebuilt = out.filter((r) => r.rebuilt).pop();
    assert.ok(near(lastRebuilt.value, 30000 * (45000 / 40000), 1),
      `${lastRebuilt.value} should be scaled onto the recording`);
  });

  test('scaling leaves the reconstructed returns alone', () => {
    const out = spliceHistory(recorded, rebuilt).filter((r) => r.rebuilt);
    const before = 30000 / 20000;
    const after = out[1].value / out[0].value;
    assert.ok(near(before, after, 1e-6), `${before} vs ${after}`);
  });

  test('reconstructed days are marked as such', () => {
    const out = spliceHistory(recorded, rebuilt);
    assert.equal(out.filter((r) => r.rebuilt).length, 2);
  });

  test('either side alone still works', () => {
    assert.deepEqual(spliceHistory(recorded, []), recorded);
    assert.deepEqual(spliceHistory([], rebuilt), rebuilt);
    assert.deepEqual(spliceHistory(null, null), []);
  });

  test('a rebuild that adds nothing earlier is ignored', () => {
    assert.deepEqual(spliceHistory(recorded, [{ date: '2026-09-01', value: 1 }]), recorded);
  });
});
