/**
 * Switching between people's journals: import, remove, import someone else.
 *
 * Reported: after removing files the app still showed positions nobody had, and
 * after importing another person's CSV it sometimes stayed on the previous
 * journal. These run the whole sequence the way the Settings buttons do — the
 * same import plan, the same rebuild, the same removal, through loadState — with
 * two made-up people, and check after every step that nothing of the other
 * person is left and that each step is quick on a history of realistic size.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { loadState, state, onJournalLoaded } from '../src/core/store.js';
import {
  importPlan, journalFromStatements, journalWithoutYear, sourceOf,
} from '../src/features/statementLibrary.js';
import { transactionRecords } from '../src/features/transactionBook.js';

let order = 0;
const tx = (date, kind, extra) => ({ date, at: `${date} 10:00:${String(order % 60).padStart(2, '0')}`, order: order++, kind, ...extra });

/** Person A: two years at a bank, ending with IVV and OKLO. */
const personA = () => transactionRecords([
  tx('2025-03-06', 'deposit', { cash: 5000 }),
  tx('2025-03-07', 'buy', { ticker: 'IVV', qty: 4, price: 500, cash: -2000 }),
  tx('2025-06-02', 'buy', { ticker: 'AMZN', qty: 5, price: 200, cash: -1000 }),
  tx('2026-01-12', 'sell', { ticker: 'AMZN', qty: 5, price: 230, cash: 1150 }),
  tx('2026-02-03', 'buy', { ticker: 'OKLO', qty: 30, price: 40, cash: -1200 }),
], { source: 'personA.csv' });

/** Person B: one year somewhere else, holding only NFLX. */
const personB = () => transactionRecords([
  tx('2026-01-05', 'deposit', { cash: 3000 }),
  tx('2026-01-06', 'buy', { ticker: 'NFLX', qty: 20, price: 90, cash: -1800 }),
], { source: 'personB.csv' });

/** A stand-in for an IBKR statement year: enough for the plan to know its source. */
const ibkrYear = (year) => ({ kind: 'ibkr', year, from: `${year}-01-01`, to: `${year}-12-31` });

/** The Import button: the plan, then the rebuilt journal loaded. */
function importFiles(incoming, { replace = false } = {}) {
  const plan = importPlan(state.statements ?? [], incoming, { replace });
  assert.equal(plan.mixed, false, 'a plain import should never be mixed');
  loadState(journalFromStatements(plan.records, {
    snapshots: plan.replaced.length ? [] : state.snapshots,
    apiKey: state.apiKey,
  }));
  return plan;
}

/** The Remove button on one year. */
const removeYear = (year) => loadState(journalWithoutYear(state, year));

const openTickers = () => state.positions.filter((p) => p.status === 'Open').map((p) => p.ticker).sort();
const everyTicker = () => [...new Set(state.positions.map((p) => p.ticker))].sort();
const years = () => state.statements.map((r) => r.year);

function startEmpty() {
  loadState({ positions: [], cash: 0, snapshots: [], statements: [], apiKey: 'key-kept' });
}

describe('one person, then nobody, then another person', () => {
  test('importing person A builds exactly A', () => {
    startEmpty();
    importFiles(personA());
    assert.deepEqual(years(), [2025, 2026]);
    assert.deepEqual(openTickers(), ['IVV', 'OKLO']);
    assert.ok(Math.abs(state.cash - 1950) < 1e-9, `${state.cash}`);
  });

  test('removing A\'s files one by one leaves nothing of A', () => {
    startEmpty();
    importFiles(personA());
    removeYear(2026);
    // Only this year's file sets today's book: with 2026 gone, 2025 is history —
    // its trades stay, but its closing holdings are not shown as held today.
    assert.deepEqual(years(), [2025]);
    assert.deepEqual(openTickers(), []);
    assert.equal(state.cash, 0);
    // Both of A's 2025 holdings were still open at the year's end, so nothing of
    // 2025 is a position — its deposit and its days stay as history.
    assert.deepEqual(everyTicker(), []);
    assert.equal(state.cashFlows.length, 1);
    removeYear(2025);
    assert.deepEqual(years(), []);
    assert.deepEqual(state.positions, []);
    assert.equal(state.cash, 0);
    assert.deepEqual(state.cashFlows, []);
    assert.deepEqual(state.snapshots, []);
    assert.equal(state.ledger, null);
    assert.equal(state.apiKey, 'key-kept');
  });

  test('then importing person B shows only B', () => {
    startEmpty();
    importFiles(personA());
    removeYear(2026);
    removeYear(2025);
    importFiles(personB());
    assert.deepEqual(years(), [2026]);
    assert.deepEqual(everyTicker(), ['NFLX']);
    assert.ok(Math.abs(state.cash - 1200) < 1e-9, `${state.cash}`);
  });
});

describe('another person imported straight over the last one', () => {
  test('Replace journal gives exactly person B, with no year of A left behind', () => {
    startEmpty();
    importFiles(personA());
    const plan = importFiles(personB(), { replace: true });
    assert.deepEqual(plan.replaced, [2025, 2026]);
    assert.deepEqual(years(), [2026]);
    assert.deepEqual(everyTicker(), ['NFLX']);
    assert.ok(Math.abs(state.cash - 1200) < 1e-9, `${state.cash}`);
  });

  test('which is why it has to be offered: adding would have kept A\'s 2025 under B\'s 2026', () => {
    startEmpty();
    importFiles(personA());
    importFiles(personB());
    assert.deepEqual(years(), [2025, 2026]);
    assert.ok(everyTicker().includes('IVV'), 'adding keeps the other person\'s older year');
  });

  test('a CSV over an IBKR journal replaces it without being asked', () => {
    const plan = importPlan([ibkrYear(2024), ibkrYear(2025)], personB());
    assert.deepEqual(plan.replaced, [2024, 2025]);
    assert.deepEqual(plan.records.map(sourceOf), ['transactions']);
  });
});

describe('back and forth', () => {
  test('A, B, A, B: every switch shows only that person, and every load is announced', () => {
    let announced = 0;
    const stop = onJournalLoaded(() => { announced += 1; });
    startEmpty();
    for (const [files, expected] of [[personA, ['IVV', 'OKLO']], [personB, ['NFLX']], [personA, ['IVV', 'OKLO']], [personB, ['NFLX']]]) {
      importFiles(files(), { replace: true });
      assert.deepEqual(openTickers(), expected);
    }
    stop();
    // The empty start and four imports: the home page resets its figures each time.
    assert.equal(announced, 5);
  });
});

test('each import and removal is quick on a history the size of a real one', () => {
  // About 400 rows over two years, like the bank history that prompted this.
  const rows = [tx('2025-01-02', 'deposit', { cash: 50_000 })];
  const tickers = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH'];
  for (let i = 0; i < 400; i++) {
    const day = new Date(Date.UTC(2025, 0, 3) + i * 1.6 * 86_400_000).toISOString().slice(0, 10);
    const ticker = tickers[i % tickers.length];
    rows.push(i % 3 === 2
      ? tx(day, 'sell', { ticker, qty: 1, price: 105, cash: 105 })
      : tx(day, 'buy', { ticker, qty: 1, price: 100, cash: -100 }));
  }
  startEmpty();
  const started = performance.now();
  importFiles(transactionRecords(rows, { source: 'big.csv' }));
  removeYear(2026);
  removeYear(2025);
  importFiles(personB(), { replace: true });
  const took = performance.now() - started;
  assert.deepEqual(everyTicker(), ['NFLX']);
  assert.ok(took < 1500, `import, two removals and a switch took ${took.toFixed(0)}ms`);
});
