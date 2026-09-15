/**
 * Today's book comes from this year's file; earlier years are history.
 *
 * Asked for directly: open positions, cash and account value decided only by
 * the current calendar year's file, while earlier years add closed trades, win
 * rate and the monthly and cumulative returns. Before, a journal whose newest
 * file was last year showed last year's closing holdings as if held today.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { loadState, state } from '../src/core/store.js';
import { journalFromStatements, journalWithoutYear } from '../src/features/statementLibrary.js';
import { transactionRecords } from '../src/features/transactionBook.js';

const Y = new Date().getFullYear();
let order = 0;
const tx = (date, kind, extra) => ({ date, at: `${date} 10:00:00`, order: order++, kind, ...extra });

/** Last year: a deposit, a buy still held, and a trade closed. This year: another buy. */
const history = () => transactionRecords([
  tx(`${Y - 1}-02-03`, 'deposit', { cash: 5000 }),
  tx(`${Y - 1}-02-04`, 'buy', { ticker: 'IVV', qty: 4, price: 500, cash: -2000 }),
  tx(`${Y - 1}-03-01`, 'buy', { ticker: 'AMZN', qty: 5, price: 200, cash: -1000 }),
  tx(`${Y - 1}-06-01`, 'sell', { ticker: 'AMZN', qty: 5, price: 230, cash: 1150 }),
  tx(`${Y}-01-05`, 'buy', { ticker: 'OKLO', qty: 30, price: 40, cash: -1200 }),
]);

const open = () => state.positions.filter((p) => p.status === 'Open').map((p) => p.ticker).sort();
const closed = () => state.positions.filter((p) => p.status === 'Closed').map((p) => p.ticker).sort();

describe('with this year\'s file', () => {
  test('today\'s positions and cash are the ones this year leaves, carried in from last year where they began', () => {
    loadState(journalFromStatements(history(), {}));
    assert.deepEqual(open(), ['IVV', 'OKLO']);
    assert.ok(Math.abs(state.cash - 1950) < 1e-9, `${state.cash}`);
    assert.deepEqual(closed(), ['AMZN']);
  });
});

describe('without this year\'s file', () => {
  test('there are no open positions and no cash, only the history', () => {
    const lastYearOnly = history().filter((r) => r.year === Y - 1);
    loadState(journalFromStatements(lastYearOnly, {}));
    assert.deepEqual(open(), []);
    assert.equal(state.cash, 0);
    assert.equal(state.openingNav, null);
    // Last year's closed trade and deposit stay, for win rate and returns.
    assert.deepEqual(closed(), ['AMZN']);
    assert.equal(state.cashFlows.length, 1);
    assert.deepEqual(state.statements.map((r) => r.year), [Y - 1]);
  });

  test('removing this year\'s file leaves the history and empties today\'s book', () => {
    loadState(journalFromStatements(history(), {}));
    loadState(journalWithoutYear(state, Y));
    assert.deepEqual(open(), []);
    assert.equal(state.cash, 0);
    assert.deepEqual(closed(), ['AMZN']);
  });

  test('a journal saved last year empties by itself once the calendar has moved on', () => {
    // Saved while last year was current: it still carries that year's holdings and cash.
    const saved = {
      positions: [
        { id: 1, ticker: 'IVV', cls: 'Stocks', dir: 'Long', status: 'Open', open: `${Y - 1}-02-04`, entry: 500, cur: 520, qty: 4, amount: 2000 },
        { id: 2, ticker: 'AMZN', cls: 'Stocks', dir: 'Long', status: 'Closed', open: `${Y - 1}-03-01`, close: `${Y - 1}-06-01`, entry: 200, cur: 230, qty: 5, amount: 1000 },
      ],
      cash: 3150,
      statements: history().filter((r) => r.year === Y - 1),
    };
    loadState(saved);
    assert.deepEqual(open(), []);
    assert.equal(state.cash, 0);
    assert.deepEqual(closed(), ['AMZN']);
  });
});

test('a journal entered by hand, with no files, is left exactly as it is', () => {
  loadState({
    positions: [{ id: 1, ticker: 'NVDA', cls: 'Stocks', dir: 'Long', status: 'Open', open: `${Y - 2}-05-01`, entry: 100, cur: 150, qty: 10, amount: 1000 }],
    cash: 2500,
  });
  assert.deepEqual(open(), ['NVDA']);
  assert.equal(state.cash, 2500);
});
