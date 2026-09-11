/**
 * Reconstructing the account value on days the app was not open.
 *
 * Three real bugs are pinned here, all found by checking the reconstruction
 * against the IBKR statement it was supposed to reproduce:
 *
 *   1. a holding carried in from an earlier year was read as never held, which
 *      hid $23,687.78 of a $26,365.95 account on the first of January and drew
 *      a crash and a recovery that never happened
 *   2. a holding partly sold during the year was valued at the quantity that
 *      survived, not the quantity actually held
 *   3. a delisted stub worth a hundred dollars deleted four months of history
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  daysBetween, carriedIn, heldOn, valueOn, cashOn,
  rebuildDailyValue, rebuildFromLedger, spliceHistory,
} from '../src/core/rebuild.js';

const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const flat = (prices) => (ticker) => prices[ticker] ?? null;

describe('the days in a range', () => {
  test('are every calendar day, ends included', () => {
    assert.deepEqual(daysBetween('2026-01-01', '2026-01-04'),
      ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
  });

  test('include weekends, because an account has a value on a Sunday', () => {
    assert.equal(daysBetween('2026-09-04', '2026-09-07').length, 4);
  });

  test('an inverted or unreadable range is empty, not endless', () => {
    assert.deepEqual(daysBetween('2026-02-01', '2026-01-01'), []);
    assert.deepEqual(daysBetween('nonsense', '2026-01-01'), []);
  });
});

describe('a holding carried in from an earlier year', () => {
  const carried = {
    ticker: 'AAA', dir: 'Long', status: 'Open', open: null, qty: 100, entry: 50, carriedIn: true,
  };

  test('is recognised by either marker', () => {
    assert.equal(carriedIn(carried), true);
    assert.equal(carriedIn({ ticker: 'A', open: null }), true);
    assert.equal(carriedIn({ ticker: 'A', open: '2026-03-01' }), false);
  });

  test('was held on every day being rebuilt, not none of them', () => {
    // This is the bug that hid ninety per cent of January.
    assert.equal(heldOn(carried, '2026-01-01'), true);
    assert.equal(heldOn(carried, '2026-06-01'), true);
  });

  test('is valued at the market, not left out', () => {
    const got = valueOn(carried, '2026-01-01', flat({ AAA: 60 }));
    assert.ok(near(got.value, 6000), `${got.value}`);
  });

  test('does not put its cost back into past cash', () => {
    // The money left the account before any day being rebuilt.
    assert.equal(cashOn([carried], 9000, [], '2026-01-01'), 9000);
  });

  test('while one bought inside the window does', () => {
    const bought = { ticker: 'BBB', dir: 'Long', status: 'Open', open: '2026-03-01', qty: 10, entry: 100 };
    assert.equal(cashOn([bought], 9000, [], '2026-01-01'), 10000);
    assert.equal(heldOn(bought, '2026-01-01'), false);
  });
});

describe('a holding partly sold during the year', () => {
  const position = {
    ticker: 'AAA', dir: 'Long', status: 'Open', open: null, carriedIn: true,
    qty: 10, entry: 126,
    exits: [{ d: '2026-05-10', qty: 11, price: 400, pnl: 3014 }],
  };

  test('was bigger before the sale than after it', () => {
    // AMD: ten shares survive, twenty-one were held in January.
    const before = valueOn(position, '2026-05-09', flat({ AAA: 400 }));
    const after = valueOn(position, '2026-05-11', flat({ AAA: 400 }));
    assert.ok(near(before.value, 21 * 400), `${before.value}`);
    assert.ok(near(after.value, 10 * 400), `${after.value}`);
  });
});

describe('a closed tranche with no share count', () => {
  /** How an IBKR statement arrives: one synthetic unit, cost and profit in money. */
  const tranche = {
    ticker: 'AAA', dir: 'Long', status: 'Closed', open: null, carriedIn: true,
    close: '2026-06-01', entry: 1000, cur: 1500, qty: 1, origQty: 1,
    exits: [{ d: '2026-06-01', qty: 1, price: 1500, pnl: 500 }],
  };

  test('is worth its proceeds on the day it was sold', () => {
    const got = valueOn(tranche, '2026-05-31', (t, d) => (d >= '2026-05-31' ? 100 : 100));
    assert.ok(near(got.value, 1500), `${got.value}`);
  });

  test('and scales back along the ticker\'s own price path', () => {
    // Half the price three months earlier means half the value.
    const priceOn = (t, d) => (d < '2026-03-01' ? 50 : 100);
    const got = valueOn(tranche, '2026-02-01', priceOn);
    assert.ok(near(got.value, 750), `${got.value}`);
  });

  test('is gone the day after it was sold', () => {
    assert.equal(valueOn(tranche, '2026-06-02', flat({ AAA: 100 })), null);
  });

  test('its proceeds leave past cash alone only after the sale', () => {
    assert.equal(cashOn([tranche], 5000, [], '2026-06-02'), 5000);
    assert.equal(cashOn([tranche], 5000, [], '2026-05-31'), 3500);
  });
});

describe('cash walked backwards', () => {
  const positions = [{
    ticker: 'AAA', dir: 'Long', entry: 100, cur: 130, qty: 50,
    open: '2026-03-01', close: '2026-06-01', status: 'Closed',
    exits: [{ d: '2026-06-01', qty: 50, price: 130, pnl: 1500 }],
  }];

  test('today is today', () => {
    assert.equal(cashOn(positions, 9000, [], '2026-07-01'), 9000);
  });

  test('before the sale, the proceeds had not arrived', () => {
    assert.ok(near(cashOn(positions, 9000, [], '2026-05-31'), 2500));
  });

  test('before the purchase, the money had not been spent', () => {
    assert.ok(near(cashOn(positions, 9000, [], '2026-02-28'), 7500));
  });

  test('before a deposit, the deposit was not there', () => {
    const flows = [{ date: '2026-04-01', amount: 3000 }];
    assert.ok(near(cashOn(positions, 9000, flows, '2026-03-15'), -500));
  });

  test('a withdrawal is added back, not subtracted twice', () => {
    const flows = [{ date: '2026-04-01', amount: -1000 }];
    assert.ok(near(cashOn(positions, 9000, flows, '2026-03-15'), 3500));
  });
});

describe('rebuilding from the broker ledger', () => {
  /** 100 shares at the start, 20 sold in March, 30 bought in June. */
  const ledger = {
    holdings: { AAA: 110 },
    trades: [
      { date: '2026-03-10', ticker: 'AAA', qty: -20, price: 50, cash: 1000 },
      { date: '2026-06-10', ticker: 'AAA', qty: 30, price: 60, cash: -1800 },
    ],
  };
  const priceOn = () => 50;

  test('undoes the year to get a past quantity', () => {
    const rows = rebuildFromLedger({
      ledger, cash: 1000, flows: [], priceOn, from: '2026-01-01', to: '2026-01-01',
    });
    // 110 today, less 30 bought since, plus 20 sold since = 100 shares.
    // Cash 1000 today, less the 1000 that came in and plus the 1800 that went out.
    assert.ok(near(rows[0].value, 100 * 50 + 1800), `${rows[0].value}`);
  });

  test('selling at the mark moves the total by nothing', () => {
    // Twenty shares leave the holding and their proceeds arrive in cash. If the
    // two do not cancel, the walk-back has the sign or the date wrong somewhere.
    const rows = rebuildFromLedger({
      ledger, cash: 1000, flows: [], priceOn, from: '2026-03-09', to: '2026-03-10',
    });
    assert.ok(near(rows[0].value, rows[1].value), `${rows[0].value} vs ${rows[1].value}`);
  });

  test('a deposit made later was not there earlier', () => {
    const flows = [{ date: '2026-07-01', amount: 5000 }];
    const withFlow = rebuildFromLedger({
      ledger, cash: 6000, flows, priceOn, from: '2026-01-01', to: '2026-01-01',
    });
    const without = rebuildFromLedger({
      ledger, cash: 1000, flows: [], priceOn, from: '2026-01-01', to: '2026-01-01',
    });
    assert.ok(near(withFlow[0].value, without[0].value), 'the deposit leaked into January');
  });

  test('no ledger is no series rather than a guess', () => {
    assert.deepEqual(rebuildFromLedger({ ledger: null, priceOn, from: '2026-01-01', to: '2026-01-02' }), []);
    assert.deepEqual(rebuildFromLedger({ ledger: { trades: [] }, priceOn, from: '2026-01-01', to: '2026-01-02' }), []);
  });

  test('a book that cannot be priced at all is dropped, not drawn at cash', () => {
    // Falling back to the last traded price is fine for a stub; when it is the
    // whole book the day is a guess and is left out.
    const rows = rebuildFromLedger({
      ledger, cash: 1000, flows: [], priceOn: () => null, from: '2026-01-01', to: '2026-01-01',
    });
    assert.equal(rows.length, 0);
  });
});

describe('rebuilding from positions, when there is no ledger', () => {
  const positions = [{
    ticker: 'AAA', cls: 'Stocks', dir: 'Long', entry: 100, cur: 120, qty: 100,
    open: '2026-01-05', status: 'Open',
  }];

  test('covers the whole range asked for', () => {
    const rows = rebuildDailyValue({
      positions, cash: 5000, flows: [], priceOn: flat({ AAA: 120 }),
      from: '2026-01-01', to: '2026-01-10',
    });
    assert.equal(rows.length, 10);
  });

  test('before the trade it is all cash, after it the position is valued', () => {
    const rows = rebuildDailyValue({
      positions, cash: 5000, flows: [], priceOn: flat({ AAA: 120 }),
      from: '2026-01-01', to: '2026-01-10',
    });
    const on = (d) => rows.find((r) => r.date === d).value;
    assert.ok(near(on('2026-01-04'), 15000), `${on('2026-01-04')}`);
    assert.ok(near(on('2026-01-05'), 17000), `${on('2026-01-05')}`);
  });

  test('a tiny unpriceable stub does not delete the month', () => {
    // 250 shares of a delisted shell at 0.40 is a hundred dollars against a
    // twenty-six thousand dollar account, and it used to drop every day it was
    // held — which was January to April.
    const withStub = [...positions, {
      ticker: 'TBH', cls: 'Stocks', dir: 'Long', entry: 0.4, cur: 0.7, qty: 250,
      open: null, carriedIn: true, status: 'Open',
    }];
    const rows = rebuildDailyValue({
      positions: withStub, cash: 5000, flows: [],
      priceOn: (t) => (t === 'TBH' ? null : 120),
      from: '2026-01-05', to: '2026-01-10',
    });
    assert.equal(rows.length, 6, 'the stub deleted the days it was held');
  });

  test('but a holding that is most of the book does', () => {
    const big = [{
      ticker: 'BIG', cls: 'Stocks', dir: 'Long', entry: 100, cur: 100, qty: 100,
      open: null, carriedIn: true, status: 'Open',
    }];
    const rows = rebuildDailyValue({
      positions: big, cash: 100, flows: [], priceOn: () => null,
      from: '2026-01-05', to: '2026-01-10',
    });
    assert.equal(rows.length, 0);
  });

  test('a short gains when the price falls', () => {
    const short = [{
      ticker: 'BBB', dir: 'Short', entry: 100, cur: 80, qty: 10,
      open: '2026-01-01', status: 'Open',
    }];
    const at = (price) => rebuildDailyValue({
      positions: short, cash: 0, flows: [], priceOn: flat({ BBB: price }),
      from: '2026-01-02', to: '2026-01-02',
    })[0].value;
    assert.ok(at(80) > at(120));
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
    assert.deepEqual(spliceHistory(recorded, rebuilt).filter((r) => r.date >= '2026-08-12'), recorded);
  });

  test('the reconstructed days come first and reach back', () => {
    const out = spliceHistory(recorded, rebuilt);
    assert.equal(out[0].date, '2026-01-02');
    assert.ok(out.every((r, i) => i === 0 || r.date >= out[i - 1].date));
  });

  test('the join has no step in it', () => {
    const out = spliceHistory(recorded, rebuilt);
    const lastRebuilt = out.filter((r) => r.rebuilt).pop();
    assert.ok(near(lastRebuilt.value, 30000 * (45000 / 40000), 1), `${lastRebuilt.value}`);
  });

  test('scaling leaves the reconstructed returns alone', () => {
    const out = spliceHistory(recorded, rebuilt).filter((r) => r.rebuilt);
    assert.ok(near(30000 / 20000, out[1].value / out[0].value, 1e-6));
  });

  test('either side alone still works', () => {
    assert.deepEqual(spliceHistory(recorded, []), recorded);
    assert.deepEqual(spliceHistory([], rebuilt), rebuilt);
    assert.deepEqual(spliceHistory(null, null), []);
  });
});
