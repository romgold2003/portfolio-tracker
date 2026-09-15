/**
 * The order yearly files are imported in changes nothing.
 *
 * Asked for directly: putting 2023 in first and then 2024, or the other way
 * round, must give the same journal. Checked on a real account's three IBKR
 * statements in all six orders (one identical result), and pinned here on a
 * four-year history from another broker in all twenty-four orders, through the
 * same plan, rebuild and load the Add button uses.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadState, state } from '../src/core/store.js';
import { importPlan, journalFromStatements } from '../src/features/statementLibrary.js';
import { transactionRecords } from '../src/features/transactionBook.js';
import { realized, accountTotals } from '../src/core/portfolio.js';

const Y = new Date().getFullYear();
let order = 0;
const tx = (date, kind, extra) => ({ date, at: `${date} 10:00:00`, order: order++, kind, ...extra });

/** Four years, each leaning on the one before: holdings carried in, sold later, deposits along the way. */
const years = () => {
  const [a, b, c, d] = [Y - 3, Y - 2, Y - 1, Y];
  const all = transactionRecords([
    tx(`${a}-02-01`, 'deposit', { cash: 10_000 }),
    tx(`${a}-02-02`, 'buy', { ticker: 'SPY', qty: 10, price: 400, cash: -4000 }),
    tx(`${a}-06-01`, 'buy', { ticker: 'NVDA', qty: 20, price: 50, cash: -1000 }),
    tx(`${b}-03-01`, 'sell', { ticker: 'NVDA', qty: 10, price: 90, cash: 900 }),
    tx(`${b}-04-01`, 'deposit', { cash: 2000 }),
    tx(`${b}-05-01`, 'buy', { ticker: 'MSFT', qty: 5, price: 300, cash: -1500 }),
    tx(`${c}-01-15`, 'dividend', { ticker: 'SPY', cash: 55 }),
    tx(`${c}-02-01`, 'sell', { ticker: 'SPY', qty: 4, price: 500, cash: 2000 }),
    tx(`${c}-09-01`, 'withdrawal', { cash: -1000 }),
    tx(`${d}-01-05`, 'sell', { ticker: 'NVDA', qty: 10, price: 120, cash: 1200 }),
    tx(`${d}-01-06`, 'buy', { ticker: 'OKLO', qty: 30, price: 40, cash: -1200 }),
  ], { source: 'history.csv' });
  return Object.fromEntries(all.map((r) => [r.year, r]));
};

const permutations = (list) => (list.length <= 1
  ? [list]
  : list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [x, ...rest])));

/** Everything a person would see: positions and their sizes, trades and their profit, cash, deposits, value. */
const fingerprint = () => JSON.stringify({
  years: state.statements.map((r) => r.year),
  cash: +state.cash.toFixed(6),
  open: state.positions.filter((p) => p.status === 'Open')
    .map((p) => `${p.ticker}:${+p.qty.toFixed(6)}@${+p.entry.toFixed(6)}:${p.open}`).sort(),
  closed: state.positions.filter((p) => p.status === 'Closed')
    .map((p) => `${p.ticker}:${p.open}:${p.close}:${+realized(p).toFixed(6)}`).sort(),
  flows: state.cashFlows.map((f) => `${f.date}:${f.amount}`).sort(),
  events: state.ledger?.events?.length ?? 0,
  account: +accountTotals(state.positions, state.cash).account.toFixed(6),
});

test('all 24 orders of four yearly files give one and the same journal', () => {
  const byYear = years();
  const results = new Map();
  for (const sequence of permutations(Object.keys(byYear).map(Number))) {
    loadState({ positions: [], cash: 0, statements: [] });
    for (const year of sequence) {
      const plan = importPlan(state.statements ?? [], [byYear[year]]);
      loadState(journalFromStatements(plan.records, { snapshots: state.snapshots, apiKey: '' }));
    }
    const fp = fingerprint();
    results.set(fp, [...(results.get(fp) ?? []), sequence.join('→')]);
  }
  assert.equal(results.size, 1, `different journals from different orders: ${[...results.values()].map((o) => o[0]).join(' vs ')}`);

  // And that one journal is the right one: this year's book, the earlier years as history.
  const f = JSON.parse([...results.keys()][0]);
  assert.deepEqual(f.years, [Y - 3, Y - 2, Y - 1, Y]);
  assert.deepEqual(f.open.map((s) => s.split(':')[0]), ['MSFT', 'OKLO', 'SPY']);
  assert.equal(f.cash, 10_000 - 4000 - 1000 + 900 + 2000 - 1500 + 55 + 2000 - 1000 + 1200 - 1200);
});

test('importing them all at once gives that same journal too', () => {
  const byYear = years();
  loadState({ positions: [], cash: 0, statements: [] });
  const oneByOne = (() => {
    for (const year of Object.keys(byYear)) {
      const plan = importPlan(state.statements ?? [], [byYear[year]]);
      loadState(journalFromStatements(plan.records, { snapshots: state.snapshots, apiKey: '' }));
    }
    return fingerprint();
  })();
  loadState({ positions: [], cash: 0, statements: [] });
  loadState(journalFromStatements(importPlan([], Object.values(byYear)).records, { apiKey: '' }));
  assert.equal(fingerprint(), oneByOne);
});
