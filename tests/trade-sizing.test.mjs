/**
 * Sizing a new position by cash spent or by share count.
 *
 * "I put $1,000 in" and "I bought 3 shares" are the same trade said from
 * either end, and which one someone remembers depends on how they bought it.
 * Only one is asked for; the other is arithmetic.
 *
 * The failure worth guarding is the quiet one: a stated share count must
 * survive into the position exactly. Deriving it back from an amount that was
 * itself derived from it turns "3 shares" into 2.9999999999999996, and every
 * figure downstream is then slightly wrong in a way nothing on screen explains.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { ui } from '../src/ui/uiState.js';
import { sizeFrom } from '../src/ui/views/addTrade.js';
import { state } from '../src/core/store.js';
import { addPosition } from '../src/core/positions.js';

beforeEach(() => {
  state.positions = [];
  state.cash = 100000;
  ui.formSizeMode = 'amount';
});

describe('reading the field either way round', () => {
  test('an amount gives the shares it buys', () => {
    assert.deepEqual(sizeFrom(200, 1000, 'amount'), { amount: 1000, qty: 5 });
  });

  test('a share count gives what it cost', () => {
    assert.deepEqual(sizeFrom(200, 5, 'qty'), { qty: 5, amount: 1000 });
  });

  test('the two agree on the same trade', () => {
    const byCash = sizeFrom(233.45, 700.35, 'amount');
    const byShares = sizeFrom(233.45, 3, 'qty');
    assert.ok(Math.abs(byCash.qty - byShares.qty) < 1e-9);
    assert.ok(Math.abs(byCash.amount - byShares.amount) < 1e-9);
  });

  test('a fractional crypto size is not rounded away', () => {
    const { amount } = sizeFrom(79772, 0.00398, 'qty');
    assert.ok(Math.abs(amount - 317.492) < 0.001, `got ${amount}`);
  });

  test('nothing typed, or nonsense typed, is not a number', () => {
    for (const [entry, typed] of [[0, 100], [200, 0], [NaN, 5], [200, NaN], [-5, 10]]) {
      const { amount, qty } = sizeFrom(entry, typed, 'amount');
      assert.ok(Number.isNaN(amount) && Number.isNaN(qty), `${entry}/${typed} slipped through`);
    }
  });
});

describe('what reaches the position', () => {
  test('a stated share count survives exactly', () => {
    // The whole point. 3 shares must be 3, not 2.9999999999999996.
    const { amount, qty } = sizeFrom(233.45, 3, 'qty');
    const p = addPosition({
      ticker: 'AAA', cls: 'Stocks', dir: 'Long', open: '2026-09-04',
      entry: 233.45, amount, qty,
    });
    assert.equal(p.qty, 3);
    assert.ok(Math.abs(p.amount - 700.35) < 1e-9);
  });

  test('sizing by amount still derives the shares, as it always did', () => {
    const { amount, qty } = sizeFrom(200, 1000, 'amount');
    const p = addPosition({
      ticker: 'AAA', cls: 'Stocks', dir: 'Long', open: '2026-09-04',
      entry: 200, amount, qty,
    });
    assert.equal(p.qty, 5);
    assert.equal(p.amount, 1000);
  });

  test('a position saved before this existed still works', () => {
    // Nothing passes qty in the old shape; it must fall back to amount ÷ entry.
    const p = addPosition({
      ticker: 'AAA', cls: 'Stocks', dir: 'Long', open: '2026-09-04',
      entry: 200, amount: 1000,
    });
    assert.equal(p.qty, 5);
  });

  test('either way, the cash spent is the amount and not the share count', () => {
    const before = state.cash;
    const { amount, qty } = sizeFrom(233.45, 3, 'qty');
    addPosition({
      ticker: 'AAA', cls: 'Stocks', dir: 'Long', open: '2026-09-04',
      entry: 233.45, amount, qty,
    });
    assert.ok(Math.abs((before - state.cash) - 700.35) < 1e-9, `spent ${before - state.cash}`);
  });

  test('the position values at what it is worth, not at what was typed', () => {
    const { amount, qty } = sizeFrom(100, 4, 'qty');
    const p = addPosition({
      ticker: 'AAA', cls: 'Stocks', dir: 'Long', open: '2026-09-04',
      entry: 100, amount, qty,
    });
    p.cur = 150;
    assert.equal(p.qty * p.cur, 600, 'four shares at 150');
  });
});
