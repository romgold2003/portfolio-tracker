/**
 * A held position's realised and unrealised P&L, as the expanded card shows it.
 *
 * Checked against the real IBKR statement of 18 September 2026: ETHA reads
 * realised −$566.31 (140 shares sold that day, from −467.89 and −98.42) and
 * unrealised +$777.47 on the 151 still held.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { realisedSoFar } from '../src/core/portfolio.js';

const held = (extra = {}) => ({
  ticker: 'ETHA', dir: 'Long', status: 'Open', qty: 151, entry: 20, cur: 25, open: '2026-02-03', ...extra,
});
// An imported sale: a closed trade of its own, priced as one unit.
const sale = (pnl, close, extra = {}) => ({
  ticker: 'ETHA', dir: 'Long', status: 'Closed', qty: 1, entry: 1000, cur: 1000 + pnl,
  open: '2026-02-03', close, summary: true, ...extra,
});

describe('realised so far on a position still held', () => {
  test('the ETHA case: two imported sales on the day are its realised profit', () => {
    const p = held();
    const book = [p, sale(-467.89, '2026-09-18'), sale(-98.42, '2026-09-18')];
    assert.ok(Math.abs(realisedSoFar(p, book) - -566.31) < 1e-9);
  });

  test('a sale made in the app is an exit on the position itself', () => {
    const p = held({ exits: [{ d: '2026-05-01', qty: 50, price: 30, pnl: 500 }] });
    assert.equal(realisedSoFar(p, [p]), 500);
  });

  test('both kinds together, with nothing counted twice', () => {
    const p = held({ exits: [{ d: '2026-05-01', qty: 50, price: 30, pnl: 500 }] });
    assert.ok(Math.abs(realisedSoFar(p, [p, sale(-100, '2026-06-01')]) - 400) < 1e-9);
  });

  test('nothing sold means zero', () => {
    const p = held();
    assert.equal(realisedSoFar(p, [p]), 0);
  });

  test('an earlier round trip in the same stock is not this holding', () => {
    // Bought and fully sold in 2025, then bought again in February.
    const p = held();
    const earlier = sale(900, '2025-11-20', { open: '2025-06-01' });
    assert.equal(realisedSoFar(p, [p, earlier]), 0);
  });

  test('sold out and bought back the same day: the first holding keeps its sale', () => {
    const p = held({ open: '2026-02-03' });
    const soldThatMorning = sale(250, '2026-02-03', { open: '2025-09-01' });
    const soldFromThisOne = sale(40, '2026-02-03', { open: '2026-02-03' });
    assert.equal(realisedSoFar(p, [p, soldThatMorning, soldFromThisOne]), 40);
  });

  test('another ticker, the other direction or another account never mixes in', () => {
    const p = held({ account: 'a' });
    const book = [
      p,
      sale(111, '2026-09-18', { ticker: 'IBIT', account: 'a' }),
      sale(222, '2026-09-18', { dir: 'Short', account: 'a' }),
      sale(333, '2026-09-18', { account: 'b' }),
      sale(10, '2026-09-18', { account: 'a' }),
    ];
    assert.equal(realisedSoFar(p, book), 10);
  });

  test('with no start date only its own exits count, rather than a guess', () => {
    const p = held({ open: null, exits: [{ d: '2026-05-01', qty: 1, price: 1, pnl: 7 }] });
    assert.equal(realisedSoFar(p, [p, sale(500, '2026-09-18')]), 7);
  });
});
