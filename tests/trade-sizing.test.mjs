/**
 * Sizing a new position, which is now only ever by share count.
 *
 * Both ends were offered once — "I put $1,000 in" and "I bought 3 shares" —
 * with the amount as the default. The share count is what the broker actually
 * filled and what every later figure is computed from, and recovering it by
 * dividing an amount by the entry price turned "3 shares" into
 * 2.9999999999999996 at the moment the trade was created. Everything
 * downstream inherited that, in a way nothing on screen explained.
 *
 * So the form asks for shares, fractions included, and what they cost is
 * arithmetic.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { sizeFrom } from '../src/ui/views/addTrade.js';
import { state } from '../src/core/store.js';
import { addPosition } from '../src/core/positions.js';

beforeEach(() => {
  state.positions = [];
  state.cash = 100000;
});

describe('reading the field', () => {
  test('a share count gives what it cost', () => {
    assert.deepEqual(sizeFrom(200, 5), { qty: 5, amount: 1000 });
  });

  test('a fraction of a share is a real size, not a rounding error', () => {
    // 0.00398 BTC at $79,772 — the ordinary crypto case.
    const { amount, qty } = sizeFrom(79772, 0.00398);
    assert.equal(qty, 0.00398);
    assert.ok(Math.abs(amount - 317.492) < 0.001, `got ${amount}`);
  });

  test('fractional shares of a stock too', () => {
    const { qty, amount } = sizeFrom(233.45, 0.5);
    assert.equal(qty, 0.5);
    assert.ok(Math.abs(amount - 116.725) < 1e-9);
  });

  test('nothing typed, or nonsense typed, is not a number', () => {
    for (const [entry, qty] of [[0, 100], [200, 0], [NaN, 5], [200, NaN], [-5, 10], [200, -3]]) {
      const size = sizeFrom(entry, qty);
      assert.ok(Number.isNaN(size.amount) && Number.isNaN(size.qty), `${entry}/${qty} slipped through`);
    }
  });
});

describe('what reaches the position', () => {
  test('a stated share count survives exactly', () => {
    // The whole point. 3 shares must be 3, not 2.9999999999999996.
    const { amount, qty } = sizeFrom(233.45, 3);
    const p = addPosition({
      ticker: 'AAA', cls: 'Stocks', dir: 'Long', open: '2026-09-04',
      entry: 233.45, amount, qty,
    });
    assert.equal(p.qty, 3);
    assert.ok(Math.abs(p.amount - 700.35) < 1e-9);
  });

  test('a position saved before this existed still works', () => {
    // Books written by the old form carry an amount and no share count; they
    // must still open, falling back to amount ÷ entry.
    const p = addPosition({
      ticker: 'AAA', cls: 'Stocks', dir: 'Long', open: '2026-09-04',
      entry: 200, amount: 1000,
    });
    assert.equal(p.qty, 5);
  });

  test('the cash spent is what the shares cost, not the share count', () => {
    const before = state.cash;
    const { amount, qty } = sizeFrom(233.45, 3);
    addPosition({
      ticker: 'AAA', cls: 'Stocks', dir: 'Long', open: '2026-09-04',
      entry: 233.45, amount, qty,
    });
    assert.ok(Math.abs((before - state.cash) - 700.35) < 1e-9, `spent ${before - state.cash}`);
  });

  test('the position values at what it is worth, not at what was typed', () => {
    const { amount, qty } = sizeFrom(100, 4);
    const p = addPosition({
      ticker: 'AAA', cls: 'Stocks', dir: 'Long', open: '2026-09-04',
      entry: 100, amount, qty,
    });
    p.cur = 150;
    assert.equal(p.qty * p.cur, 600, 'four shares at 150');
  });
});

/**
 * Topping up follows the same rule as opening.
 *
 * A DCA used to ask for an amount and divide it by the price, which put the
 * same fractional error into the share count on every addition — and unlike the
 * opening trade, it compounds, because each top-up averages against the last
 * one's slightly-wrong figure.
 */
describe('adding to a position', () => {
  const held = () => addPosition({
    ticker: 'AAA', cls: 'Stocks', dir: 'Long', open: '2026-09-04',
    entry: 100, amount: 1000, qty: 10,
  });

  test('is sized by the shares added, and says what they cost', async () => {
    const { previewDca } = await import('../src/core/positions.js');
    const next = previewDca(held(), 5, 120);
    assert.equal(next.addQty, 5);
    assert.equal(next.spend, 600);
    assert.equal(next.qty, 15);
    assert.equal(next.cost, 1600);
    // $1,600 over 15 shares.
    assert.ok(Math.abs(next.avgEntry - 106.6666666666) < 1e-6, `${next.avgEntry}`);
  });

  test('a fractional top-up survives exactly', async () => {
    const { applyDca } = await import('../src/core/positions.js');
    const p = held();
    const before = state.cash;
    applyDca(p.id, 0.25, 200);
    assert.equal(p.qty, 10.25);
    // Cash moves by what the quarter share cost, not by the share count.
    assert.ok(Math.abs((before - state.cash) - 50) < 1e-9, `spent ${before - state.cash}`);
  });

  test('three top-ups leave the share count a round number', async () => {
    const { applyDca } = await import('../src/core/positions.js');
    const p = held();
    applyDca(p.id, 3, 233.45);
    applyDca(p.id, 3, 197.13);
    applyDca(p.id, 3, 311.07);
    assert.equal(p.qty, 19, 'ten plus three plus three plus three');
  });
});
