/**
 * Sorting the holdings lists by a column (November 2026: the columns are the
 * user's own, IBKR-style, and any heading sorts up or down).
 *
 * Carried over from the old "D% ↓ Worst" button, whose lesson still holds:
 * a percent column ranks by percent, not by the money behind it — a small
 * holding down six per cent is worse than a large one down one. Signed for the
 * position, so a short whose stock rose is a loser. A figure not known yet goes
 * last whichever way the list is turned.
 *
 * Crypto here, because its day never closes, so the figures do not depend on
 * when the tests run.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { dailyPercent } = await import('../src/core/portfolio.js');
const { sortByLayout, columnValue, listContext } = await import('../src/ui/views/holdingColumns.js');
const { cleanLayout, cleanLayouts, defaultLayout, COLUMNS, COLUMN_PRESETS, MAX_COLUMNS } = await import('../src/config/columns.js');

/** A holding, sized in dollars so money and percent can be made to disagree. */
function pos(ticker, { pct, qty = 1, price = 100, dir = 'Long', entry = price } = {}) {
  return {
    id: ticker, ticker, cls: 'Crypto', dir, status: 'Open', open: '2026-01-02',
    entry, cur: price, qty,
    ...(pct === undefined ? {} : { dailyChg: pct }),
  };
}

const ctx = () => listContext([]);
const order = (list, id, dir) => sortByLayout(list, { cols: [id], sort: { id, dir } }, ctx()).map((p) => p.ticker);

describe('a percent column ranks by percent, not by money', () => {
  const uso = pos('USO', { pct: -6.2, qty: 10, price: 70 });
  const spy = pos('SPY', { pct: -0.4, qty: 200, price: 560 });

  test('lowest first puts the biggest faller first, whatever it is worth', () => {
    assert.deepEqual(order([spy, uso], 'dayPct', 'asc'), ['USO', 'SPY']);
  });

  test('highest first is the same list the other way up', () => {
    assert.deepEqual(order([uso, spy], 'dayPct', 'desc'), ['SPY', 'USO']);
  });

  test('and the money column ranks by money', () => {
    const big = pos('BIG', { pct: -0.4, qty: 200, price: 560 });
    const small = pos('SMALL', { pct: -6.2, qty: 10, price: 70 });
    assert.deepEqual(order([small, big], 'value', 'desc'), ['BIG', 'SMALL']);
  });
});

describe('direction', () => {
  test('a short whose stock rose is a loser', () => {
    const short = pos('TSLA', { pct: 4.0, dir: 'Short' });
    const long = pos('AAPL', { pct: -1.0 });
    assert.deepEqual(order([long, short], 'dayPct', 'asc'), ['TSLA', 'AAPL']);
  });

  test('dailyPercent reports the sign the position feels', () => {
    assert.equal(dailyPercent(pos('X', { pct: 4, dir: 'Short' })), -4);
    assert.equal(dailyPercent(pos('X', { pct: 4 })), 4);
  });

  test('unrealised P&L of a short gains when the price falls', () => {
    const short = pos('S', { dir: 'Short', entry: 100, price: 90, qty: 10 });
    assert.equal(columnValue('unrealUsd', short, ctx()), 100);
    assert.equal(columnValue('value', short, ctx()), -900);
  });
});

describe('a figure not known yet', () => {
  const known = pos('AAPL', { pct: -2.0 });
  const unknown = pos('NEW');

  test('goes last either way round', () => {
    assert.equal(dailyPercent(unknown), null);
    assert.equal(order([unknown, known], 'dayPct', 'asc')[0], 'AAPL');
    assert.equal(order([unknown, known], 'dayPct', 'desc')[0], 'AAPL');
  });

  test('and so does a figure that is not a number', () => {
    for (const bad of [NaN, Infinity, undefined, null]) {
      assert.equal(dailyPercent({ dir: 'Long', dailyChg: bad }), null, String(bad));
    }
  });
});

describe('text columns and the symbol', () => {
  test('sort A to Z', () => {
    const list = [pos('MSFT'), pos('AAPL'), pos('BTC')];
    assert.deepEqual(order(list, 'symbol', 'asc'), ['AAPL', 'BTC', 'MSFT']);
    assert.deepEqual(order(list, 'symbol', 'desc'), ['MSFT', 'BTC', 'AAPL']);
  });
});

describe('the layout a person keeps', () => {
  test('everyone starts on Simple, largest unrealised P&L first', () => {
    assert.deepEqual(defaultLayout(), { cols: COLUMN_PRESETS.simple.cols, sort: { id: 'unrealUsd', dir: 'desc' } });
    assert.deepEqual(cleanLayouts(undefined).home, defaultLayout());
    assert.deepEqual(cleanLayouts(undefined).positions, defaultLayout());
  });

  test('a stored layout keeps known columns once each, at most twelve, and a known sort', () => {
    const l = cleanLayout({ cols: ['dayPct', 'junk', 'dayPct', 'weight', 42], sort: { id: 'nope', dir: 'up' } });
    assert.deepEqual(l.cols, ['dayPct', 'weight']);
    assert.deepEqual(l.sort, { id: 'unrealUsd', dir: 'desc' });
    assert.equal(cleanLayout({ cols: Object.keys(COLUMNS) }).cols.length, MAX_COLUMNS);
    assert.deepEqual(cleanLayout({ cols: [], sort: { id: 'symbol', dir: 'asc' } }), { cols: [], sort: { id: 'symbol', dir: 'asc' } });
  });

  test('every preset names only real columns', () => {
    for (const [key, preset] of Object.entries(COLUMN_PRESETS)) {
      for (const id of preset.cols) assert.ok(COLUMNS[id], `${key}: ${id}`);
    }
  });
});
