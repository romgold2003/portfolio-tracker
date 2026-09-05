/**
 * Money is never created by recording a trade.
 *
 * The bug this exists for, found by running four hundred randomly generated
 * books through the invariants: `spendCash` stopped at zero. Recording a
 * $10,000 buy against $8,359 of cash left the position on the books, the cash
 * at zero, and $1,641 of stock paid for by nothing — the account total rose by
 * that much on a trade that moved no money at all. With no cash, an entire
 * position was free.
 *
 * The same clamp sat in two more places: editing a trade upward, and reopening
 * a closed one. All three now let the balance go negative, which is either a
 * stale cash figure or borrowed money and is worth seeing either way.
 *
 * The invariant that matters is not "cash is positive". It is that the account
 * only moves when something is actually worth more.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state, loadState } from '../src/core/store.js';
import { addPosition, closePosition, updatePosition, reopenPosition } from '../src/core/positions.js';
import { accountTotals } from '../src/core/portfolio.js';

const account = () => accountTotals(state.positions, state.cash).account;
const near = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;

beforeEach(() => {
  loadState({ positions: [], cash: 0, cashFlows: [], snapshots: [] });
});

const buy = (over = {}) => addPosition({
  ticker: 'AAA', cls: 'Stocks', dir: 'Long', open: '2026-09-06',
  entry: 100, amount: 10000, qty: 100, ...over,
});

describe('buying does not conjure money', () => {
  test('a buy larger than the cash on hand leaves the account where it was', () => {
    loadState({ positions: [], cash: 8359.63, cashFlows: [], snapshots: [] });
    const before = account();
    buy();
    assert.ok(near(account(), before), `account moved by ${account() - before}`);
    assert.ok(near(state.cash, 8359.63 - 10000), `cash is ${state.cash}`);
  });

  test('a buy with no cash at all is not a free position', () => {
    const before = account();
    buy({ amount: 5000, qty: 50 });
    assert.ok(near(account(), before), `account moved by ${account() - before}`);
    assert.equal(state.cash, -5000);
  });

  test('cash is allowed below zero, because the alternative loses the difference', () => {
    loadState({ positions: [], cash: 100, cashFlows: [], snapshots: [] });
    buy({ amount: 1000, qty: 10 });
    assert.equal(state.cash, -900);
  });

  test('a buy within the cash still behaves exactly as before', () => {
    loadState({ positions: [], cash: 50000, cashFlows: [], snapshots: [] });
    const before = account();
    buy();
    assert.ok(near(account(), before));
    assert.equal(state.cash, 40000);
  });
});

describe('editing does not conjure money', () => {
  test('raising the amount past the cash on hand still balances', () => {
    loadState({ positions: [], cash: 12000, cashFlows: [], snapshots: [] });
    const p = buy();
    const before = account();
    updatePosition(p.id, {
      ticker: 'AAA', cls: 'Stocks', dir: 'Long', open: '2026-09-06',
      entry: 100, amount: 30000, reason: null,
    });
    assert.ok(near(account(), before), `account moved by ${account() - before}`);
    assert.ok(near(state.cash, 12000 - 30000), `cash is ${state.cash}`);
  });
});

describe('reopening is the exact inverse of closing', () => {
  test('it gives back the position and takes back every cent of the proceeds', () => {
    loadState({ positions: [], cash: 20000, cashFlows: [], snapshots: [] });
    const p = buy();
    const afterBuy = { cash: state.cash, qty: p.qty, amount: p.amount, account: account() };

    closePosition(p.id, 130, 100);
    reopenPosition(p.id);

    assert.ok(near(state.cash, afterBuy.cash), `cash ${state.cash} vs ${afterBuy.cash}`);
    assert.ok(near(p.qty, afterBuy.qty));
    assert.ok(near(p.amount, afterBuy.amount));
    assert.equal(p.status, 'Open');

    /**
     * The account does *not* return to where it was, and should not.
     *
     * Closing marks the position at the exit price, and reopening leaves it
     * there — 130 rather than the 100 it carried before, which was only a
     * placeholder standing in until a quote arrived. The position really is
     * worth 130 a share, so the account is right to say so. What must be
     * restored is the money and the size, not the mark.
     */
    assert.ok(near(account(), afterBuy.cash + p.qty * 130),
      `account ${account()} does not match the position marked at 130`);
  });

  test('and does so even when the proceeds exceed the cash held', () => {
    // The clamp bit hardest here: reopening returned the position to the book
    // without removing all the money the exits had paid in.
    loadState({ positions: [], cash: 10000, cashFlows: [], snapshots: [] });
    const p = buy();
    closePosition(p.id, 500, 100);   // proceeds 50,000
    loadState({ positions: state.positions, cash: 100, cashFlows: [], snapshots: [] });
    reopenPosition(state.positions[0].id);
    assert.ok(near(state.cash, 100 - 50000), `cash is ${state.cash}`);
  });
});

describe('the invariant behind all of it', () => {
  test('across a run of trades, the account only moves when value does', () => {
    loadState({ positions: [], cash: 5000, cashFlows: [], snapshots: [] });
    let expected = account();

    for (let i = 0; i < 20; i++) {
      const p = buy({ ticker: `T${i}`, amount: 4000, qty: 40, entry: 100 });
      // Buying at the price it is already marked at cannot change the account.
      assert.ok(near(account(), expected), `buy ${i} moved the account`);
      if (i % 3 === 0) {
        p.cur = 120;
        expected = account();
        closePosition(p.id, 120, p.qty);
        assert.ok(near(account(), expected), `close ${i} moved the account`);
      }
    }
  });
});
