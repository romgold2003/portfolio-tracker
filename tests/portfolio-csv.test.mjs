/**
 * Exporting the portfolio as a CSV.
 *
 * The export used to be only the JSON backup, which opens in nothing a person
 * uses. The CSV is one row per position with the app's own figures, then cash
 * and the account's totals, and must read as an ordinary table.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { portfolioCsv } from '../src/features/backup.js';
import { parseCsvTable } from '../src/features/genericCsv.js';

const positions = [
  { ticker: 'TSLA', cls: 'Stocks', dir: 'Short', status: 'Closed', open: '2026-02-01', close: '2026-03-01', entry: 300, cur: 250, qty: 2, origQty: 2 },
  { ticker: 'AAPL', cls: 'Stocks', dir: 'Long', status: 'Open', open: '2026-01-02', close: null, entry: 100, cur: 110, qty: 10 },
  { ticker: 'IREN', cls: 'Stocks', dir: 'Long', status: 'Open', open: '2026-04-01', close: null, entry: 40, cur: 50, qty: 5, origQty: 10, exits: [{ d: '2026-05-01', qty: 5, price: 45, pnl: 25 }] },
  { ticker: 'NET', cls: 'Stocks', dir: 'Long', status: 'Closed', open: '2026-01-21', close: '2026-02-02', entry: 456.87, cur: 490, qty: 1, origQty: 1, summary: true },
];

describe('the portfolio as a CSV', () => {
  const table = parseCsvTable(portfolioCsv(positions, 500));
  const row = (ticker) => Object.fromEntries(table.headers.map((h, i) => [h, table.rows.find((r) => r[0] === ticker)[i]]));

  test('reads as an ordinary table with one row per position, open first', () => {
    assert.deepEqual(table.headers.slice(0, 4), ['Ticker', 'Asset class', 'Direction', 'Status']);
    assert.deepEqual(table.rows.slice(0, 4).map((r) => r[0]), ['IREN', 'AAPL', 'TSLA', 'NET']);
  });

  test('an open position carries its value and what it is up', () => {
    assert.deepEqual(
      [row('AAPL').Quantity, row('AAPL').Cost, row('AAPL')['Market value'], row('AAPL')['Unrealised P&L'], row('AAPL')['Return %']],
      ['10', '1000.00', '1100.00', '100.00', '10.00'],
    );
  });

  test('a partial exit shows as already banked on the position still open', () => {
    assert.equal(row('IREN')['Realised P&L'], '25.00');
    assert.equal(row('IREN').Quantity, '5');
  });

  test('a closed short banks what the price fell, and has no market value', () => {
    assert.deepEqual(
      [row('TSLA')['Close date'], row('TSLA')['Realised P&L'], row('TSLA')['Market value'], row('TSLA')['Return %']],
      ['2026-03-01', '100.00', '', '16.67'],
    );
  });

  test('a result entered without prices leaves quantity and prices empty', () => {
    assert.deepEqual([row('NET').Quantity, row('NET')['Entry price'], row('NET').Cost], ['', '', '456.87']);
  });

  test('cash and the account value close the sheet', () => {
    assert.equal(row('Cash')['Market value'], '500.00');
    // 1,100 in AAPL + 250 in IREN + 500 cash.
    assert.equal(row('Account value')['Market value'], '1850.00');
  });
});
