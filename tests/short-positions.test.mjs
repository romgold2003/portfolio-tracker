/**
 * Short positions, booked the way a broker books them.
 *
 * Reported: shorting in the app made cash fall. At Interactive Brokers, Schwab
 * or Fidelity a short sale credits its proceeds to cash, the position is held at
 * a negative market value, and covering it pays the buy-back price out — so
 * opening a short leaves the account where it was and only the price move after
 * that counts. The app spent cash on the way in and paid it back on the way out;
 * the total agreed, the cash and the position did not.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { loadState, state, journalSnapshot, SHORT_CASH_MODEL } from '../src/core/store.js';
import {
  addPosition, closePosition, applyDca, reopenPosition, updatePosition,
} from '../src/core/positions.js';
import { accountTotals, marketValueOf, realized } from '../src/core/portfolio.js';
import { cashOn, valueOn } from '../src/core/rebuild.js';

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const fresh = (cash = 10_000) => loadState({ positions: [], cash, cashModel: SHORT_CASH_MODEL });
const account = () => accountTotals(state.positions, state.cash).account;
const shortTsla = () => addPosition({
  ticker: 'TSLA', cls: 'Stocks', dir: 'Short', open: '2026-09-15', entry: 100, amount: 1000, qty: 10,
});

describe('opening a short', () => {
  test('puts the sale proceeds into cash and holds the position at a negative market value', () => {
    fresh();
    const p = shortTsla();
    assert.equal(state.cash, 11_000);
    assert.equal(marketValueOf(p), -1000);
    // Opening changes nothing about what the account is worth.
    assert.equal(account(), 10_000);
  });

  test('a rise in price is a loss, a fall a gain', () => {
    fresh();
    const p = shortTsla();
    p.cur = 110;
    assert.equal(account(), 9_900);
    p.cur = 80;
    assert.equal(account(), 10_200);
  });

  test('a long is untouched: buying still spends cash and is held at its value', () => {
    fresh();
    const p = addPosition({ ticker: 'AAPL', cls: 'Stocks', dir: 'Long', open: '2026-09-15', entry: 100, amount: 1000, qty: 10 });
    assert.equal(state.cash, 9_000);
    assert.equal(marketValueOf(p), 1000);
    assert.equal(account(), 10_000);
  });
});

describe('covering a short', () => {
  test('in full: the buy-back leaves cash, and the account keeps the profit', () => {
    fresh();
    const p = shortTsla();
    closePosition(p.id, 90, 10);
    assert.equal(p.status, 'Closed');
    assert.equal(state.cash, 10_100);
    assert.equal(account(), 10_100);
    assert.ok(near(realized(p), 100));
  });

  test('in part: only the shares bought back are paid for', () => {
    fresh();
    const p = shortTsla();
    closePosition(p.id, 90, 4);
    assert.equal(state.cash, 11_000 - 360);
    assert.equal(p.qty, 6);
    // Six shares still short at $100 and $40 already banked on the four.
    assert.ok(near(account(), 10_040), `${account()}`);
  });

  test('reopening a covered short puts the buy-back money back', () => {
    fresh();
    const p = shortTsla();
    closePosition(p.id, 90, 10);
    reopenPosition(p.id);
    assert.equal(state.cash, 11_000);
    assert.equal(p.qty, 10);
  });
});

describe('adding to and editing a short', () => {
  test('adding to a short brings in that sale too', () => {
    fresh();
    const p = shortTsla();
    applyDca(p.id, 500, 125);
    assert.equal(state.cash, 11_500);
    assert.equal(p.qty, 14);
  });

  test('editing the amount moves cash by the same rule', () => {
    fresh();
    const p = shortTsla();
    updatePosition(p.id, { ticker: 'TSLA', cls: 'Stocks', dir: 'Short', open: '2026-09-15', entry: 100, amount: 1500 });
    assert.equal(state.cash, 11_500);
  });

  test('turning a long into a short undoes the purchase and books the sale', () => {
    fresh();
    const p = addPosition({ ticker: 'TSLA', cls: 'Stocks', dir: 'Long', open: '2026-09-15', entry: 100, amount: 1000, qty: 10 });
    updatePosition(p.id, { ticker: 'TSLA', cls: 'Stocks', dir: 'Short', open: '2026-09-15', entry: 100, amount: 1000 });
    assert.equal(state.cash, 11_000);
    assert.equal(account(), 10_000);
  });
});

describe('a journal saved before this', () => {
  const oldJournal = () => ({
    positions: [
      { id: 1, ticker: 'TSLA', cls: 'Stocks', dir: 'Short', status: 'Open', open: '2026-09-01', entry: 100, cur: 110, qty: 10, amount: 1000 },
      { id: 2, ticker: 'NVDA', cls: 'Stocks', dir: 'Short', status: 'Closed', open: '2026-08-01', close: '2026-08-20', entry: 50, cur: 40, qty: 10, amount: 500 },
      { id: 3, ticker: 'AAPL', cls: 'Stocks', dir: 'Long', status: 'Open', open: '2026-09-01', entry: 200, cur: 210, qty: 5, amount: 1000 },
    ],
    // The old rule had spent the open short's $1,000.
    cash: 8_000,
  });

  test('has its open shorts\' cash put right, with the account total unchanged', () => {
    // Before: 8,000 cash + AAPL 1,050 + the short at collateral 1,000 − 100 lost = 9,950.
    loadState(oldJournal());
    assert.equal(state.cash, 10_000);
    assert.equal(account(), 9_950);
  });

  test('is put right once: saving and loading again changes nothing', () => {
    loadState(oldJournal());
    const saved = journalSnapshot();
    assert.equal(saved.cashModel, SHORT_CASH_MODEL);
    loadState(saved);
    assert.equal(state.cash, 10_000);
  });
});

describe('the day-by-day history', () => {
  test('an open short is minus its market value, and before it opened its proceeds were not in cash', () => {
    const p = { ticker: 'TSLA', dir: 'Short', status: 'Open', open: '2026-09-10', entry: 100, cur: 110, qty: 10 };
    const priceOn = (t, d) => (d < '2026-09-12' ? 100 : 110);
    assert.equal(valueOn(p, '2026-09-11', priceOn).value, -1000);
    assert.equal(valueOn(p, '2026-09-14', priceOn).value, -1100);
    assert.equal(cashOn([p], 11_000, [], '2026-09-09'), 10_000);
    assert.equal(cashOn([p], 11_000, [], '2026-09-11'), 11_000);
  });

  test('a covered short: before the cover its buy-back had not left cash, and it was worth minus its shares at that day\'s price', () => {
    const p = {
      ticker: 'TSLA', dir: 'Short', status: 'Closed', open: '2026-09-01', close: '2026-09-12',
      entry: 100, cur: 90, qty: 10, origQty: 10, exits: [{ d: '2026-09-12', qty: 10, price: 90, pnl: 100 }],
    };
    const priceOn = (t, d) => (d === '2026-09-12' ? 90 : 95);
    assert.equal(cashOn([p], 10_100, [], '2026-09-11'), 11_000);
    assert.equal(cashOn([p], 10_100, [], '2026-08-31'), 10_000);
    assert.ok(near(valueOn(p, '2026-09-11', priceOn).value, -950));
    // The whole account on 11 September: 11,000 cash less 950 owed back.
    assert.ok(near(cashOn([p], 10_100, [], '2026-09-11') + valueOn(p, '2026-09-11', priceOn).value, 10_050));
  });
});
