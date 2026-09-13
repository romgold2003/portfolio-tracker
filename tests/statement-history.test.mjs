/**
 * Several years of broker statements, joined into one history.
 *
 * Two halves. The first runs everywhere, on small statements built here, and
 * pins each rule: the HTML statement reads the same as the CSV, a year replaces
 * the same year, years must join up, splits are carried back through time, and
 * the book is rebuilt from all of them together.
 *
 * The second runs against the real statements when they are on this machine —
 * 2024 and 2025 as IBKR's zipped HTML, 2026 as CSV — and checks the join the
 * way the broker would: walking every share movement forward from the first
 * deposit must arrive at exactly the holdings IBKR states on the last day.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

import { parseIbkrStatement } from '../src/features/ibkr.js';
import { looksLikeHtmlStatement } from '../src/features/ibkrHtml.js';
import {
  statementRecord, withStatements, withoutStatement, chainReport, journalFromStatements, newestYearIn,
} from '../src/features/statementLibrary.js';
import { state, loadState, journalSnapshot } from '../src/core/store.js';

const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);

/* ───────────────────────── an HTML statement, in miniature ───────────────────────── */

/**
 * Laid out exactly as IBKR lays out the real page: a heading div per section,
 * group rows for the asset class and currency, subtotal rows, the NAV block as
 * two tables with the return on a trailing row, a stacked header over the
 * mark-to-market columns, and a help link inside one heading.
 *
 * The book: 1,000 in cash on 1 January, 500 deposited, 400 shares of ABC bought
 * at 2.50, split 1-for-20 into 20 shares, 10 of them sold for a profit of 100,
 * 10 left at 110.
 */
const PAGE = `<html><head><title>U1 Activity Statement January 1, 2025 - December 31, 2025 - Interactive Brokers</title></head><body>
<div class="sectionHeadingClosed" id="secAccountInformation_U1Heading"><span class="accordion-icon"></span>Account Information</div>
<div id="tblAccountInformation_U1Body"><table><tr><td>Account</td><td>U1</td></tr></table></div>
<div class="sectionHeadingClosed" id="secNAV_U1Heading">Net Asset Value</div>
<div id="tblNAV_U1Body"><table><thead>
<tr><th>&nbsp;</th><th>December 31, 2024</th><th colspan="3">December 31, 2025</th><th>&nbsp;</th></tr>
<tr><th>&nbsp;</th><th>Total</th><th>Long</th><th>Short</th><th>Total</th><th>Change</th></tr></thead>
<tr><td>Cash </td><td>1,000.00</td><td>1,100.00</td><td>0.00</td><td class="border-right subtotal">1,100.00</td><td>100.00</td></tr>
<tr><td>Stock</td><td>0.00</td><td>1,100.00</td><td>0.00</td><td class="border-right subtotal">1,100.00</td><td>1,100.00</td></tr>
<tr class="subtotal"><td>&nbsp;&nbsp;Total</td><td>1,000.00</td><td>2,200.00</td><td>0.00</td><td>2,200.00</td><td>1,200.00</td></tr>
<tr><td colspan="6"></td></tr>
<tr><td colspan="5">Time Weighted Rate of Return</td><td>10.00%</td></tr>
</table>
<table><thead><tr><th>&nbsp;</th><th>&nbsp;</th></tr><tr><th>Change in NAV</th><th>Total</th></tr></thead>
<tr><td>Starting Value</td><td>1,000.00</td></tr>
<tr><td class="indent">Deposits &amp; Withdrawals</td><td>500.00</td></tr>
<tr><td>Ending Value</td><td>2,200.00</td></tr>
</table></div>
<div class="sectionHeadingClosed" id="secMtmPerfSumByUnderlying_U1Heading">Mark-to-Market Performance Summary</div>
<div id="tblMtmPerfSumByUnderlying_U1Body"><table><thead>
<tr><th></th><th colspan="2">Quantity</th><th colspan="2">Price</th><th></th></tr>
<tr><th>Symbol</th><th>Prior</th><th>Current</th><th>Prior</th><th>Current</th><th>Code</th></tr></thead>
<tr><td class="header-asset" colspan="6">Stocks</td></tr>
<tr><td>ABC</td><td>0</td><td>10</td><td>--</td><td>110.0000</td><td>&nbsp;</td></tr>
<tr><td class="header-asset" colspan="6">Forex</td></tr>
<tr><td>USD</td><td>1000</td><td>1100</td><td>--</td><td>--</td><td>&nbsp;</td></tr>
</table></div>
<div class="sectionHeadingClosed" id="secOpenPositions_U1Heading">Open Positions</div>
<div id="tblOpenPositions_U1Body"><table><thead><tr><th>Symbol</th><th>Quantity</th><th>Mult</th><th>Cost Price</th><th>Cost Basis</th><th>Close Price</th><th>Value</th><th>Unrealized P/L</th><th>Code</th></tr></thead>
<tr><td class="header-asset" colspan="9">Stocks</td></tr><tr><td class="header-currency" colspan="9">USD</td></tr>
<tr><td>ABC</td><td>10</td><td>1</td><td>50.00</td><td>500.00</td><td>110.0000</td><td>1,100.00</td><td>600.00</td><td>&nbsp;</td></tr>
<tr class="subtotal"><td colspan="2">Total</td><td>&nbsp;</td><td>&nbsp;</td><td>500.00</td><td>&nbsp;</td><td>1,100.00</td><td>600.00</td><td>&nbsp;</td></tr>
</table></div>
<div class="sectionHeadingClosed" id="secTransactions_U1Heading">Trades</div>
<div id="tblTransactions_U1Body"><table><thead><tr><th>Symbol</th><th>Date/Time</th><th>Quantity</th><th>T. Price</th><th>C. Price</th><th>Proceeds</th><th>Comm/Fee</th><th>Basis</th><th>Realized P/L</th><th>MTM P/L</th><th>Code</th></tr></thead>
<tr><td class="header-asset" colspan="11">Stocks</td></tr><tr><td class="header-currency" colspan="11">USD</td></tr>
<tr><td>ABC</td><td>2025-03-03, 10:00:00</td><td>400</td><td>2.5000</td><td>2.5000</td><td>-1,000.00</td><td>0.00</td><td>1,000.00</td><td>0.00</td><td>0.00</td><td>O</td></tr>
<tr><td>ABC</td><td>2025-06-02, 11:00:00</td><td>-10</td><td>60.0000</td><td>60.0000</td><td>600.00</td><td>0.00</td><td>-500.00</td><td>100.00</td><td>0.00</td><td>C</td></tr>
<tr class="subtotal"><td colspan="2">Total&nbsp;ABC</td><td>390</td><td>&nbsp;</td><td>&nbsp;</td><td>-400.00</td><td>0.00</td><td>500.00</td><td>100.00</td><td>0.00</td><td>&nbsp;</td></tr>
</table></div>
<div class="sectionHeadingClosed" id="secCorporateActions_U1Heading">Corporate Actions<span class="btn-group-right"><a href="#">Glossary</a></span></div>
<div id="tblCorporateActions_U1Body"><table><thead><tr><th>Report Date</th><th>Date/Time</th><th>Description</th><th>Quantity</th><th>Proceeds</th><th>Value</th><th>Realized P/L</th><th>Code</th></tr></thead>
<tr><td class="header-asset" colspan="8">Stocks</td></tr>
<tr><td>2025-05-02</td><td>2025-05-01, 20:25:00</td><td>ABC(US0000000001) Split 1 for 20 (ABC, ABC CORP, US0000000002)</td><td>20</td><td>0.00</td><td>0.00</td><td>0.00</td><td>&nbsp;</td></tr>
<tr><td>2025-05-02</td><td>2025-05-01, 20:25:00</td><td>ABC(US0000000001) Split 1 for 20 (ABC.OLD, ABC CORP, US0000000001)</td><td>-400</td><td>0.00</td><td>0.00</td><td>0.00</td><td>&nbsp;</td></tr>
</table></div>
<div class="sectionHeadingClosed" id="secCombDepWith_U1Heading">Deposits &amp; Withdrawals</div>
<div id="tblCombDepWith_U1Body"><table><thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead>
<tr><td class="header-currency" colspan="3">USD</td></tr>
<tr><td>2025-02-01</td><td>Electronic Fund Transfer</td><td>500.00</td></tr>
<tr class="subtotal"><td colspan="2">Total</td><td>500.00</td></tr>
</table></div>
</body></html>`;

describe('an HTML statement reads the same as the CSV', () => {
  const parsed = parseIbkrStatement(PAGE);

  test('it is recognised, and a CSV is not mistaken for one', () => {
    assert.equal(looksLikeHtmlStatement(PAGE), true);
    assert.equal(looksLikeHtmlStatement('Statement,Header,Field Name,Field Value\n'), false);
  });

  test('the period comes from the page title', () => {
    assert.equal(parsed.periodStart, '2025-01-01');
    assert.equal(parsed.periodEnd, '2025-12-31');
  });

  test("the balances, both ends of the period, and the broker's return", () => {
    assert.equal(parsed.openingCash, 1000);
    assert.equal(parsed.cash, 1100);
    assert.equal(parsed.navChange.startNav, 1000);
    assert.equal(parsed.navChange.endNav, 2200);
    assert.equal(parsed.twr, 10);
  });

  test('open positions, closed trades and deposits', () => {
    assert.deepEqual(parsed.positions, [{ ticker: 'ABC', qty: 10, entry: 50, cur: 110 }]);
    assert.equal(parsed.closed.length, 1);
    assert.equal(parsed.closed[0].pnl, 100);
    assert.equal(parsed.closed[0].cost, 500);
    assert.deepEqual(parsed.flows.map((f) => [f.date, f.amount]), [['2025-02-01', 500]]);
  });

  test('the stacked header is read, and the cash wearing a symbol is not a holding', () => {
    // "Prior" under "Quantity" is the column the opening holdings come from;
    // the Forex group's USD row must not become a holding of 1,000 dollars.
    assert.deepEqual(parsed.openingHoldings, {});
  });

  test('each trade keeps its time of day', () => {
    assert.equal(parsed.ledger[0].at, '2025-03-03 10:00:00');
  });

  test('a split is found even though its heading carries a help link', () => {
    // The real page's "Corporate Actions" heading has a Glossary link beside it,
    // and reading that as part of the name lost every split in the file.
    assert.deepEqual(parsed.splits, [{ ticker: 'ABC', date: '2025-05-01', at: '2025-05-01 20:25:00', ratio: 0.05 }]);
  });
});

/* ───────────────────────── the library, on statements built by hand ───────────────────────── */

/** A parsed statement with only the fields a test needs to say. */
function parsedLike(over) {
  return {
    accounts: ['U1'],
    twr: null,
    positions: [],
    closed: [],
    firstBuy: new Map(),
    netQty: new Map(),
    ledger: [],
    transfers: [],
    dated: [],
    flows: [],
    splits: [],
    openingCash: 0,
    openingHoldings: {},
    openingMarks: {},
    cash: 0,
    accruals: 0,
    income: { dividends: 0, interest: 0, commissions: 0, tax: 0 },
    navChange: {},
    ...over,
  };
}

/**
 * Two years of one holding across a split.
 *
 * 2024: 1,000 deposited, 400 XYZ bought at 2.50. 2025: split 1-for-20 in May,
 * so the 400 are 20. That day 40 more were bought before the split (2 after
 * it) and 1 after it, then 10 sold. Closing: 13 shares.
 */
const Y2024 = () => parsedLike({
  periodStart: '2024-01-01',
  periodEnd: '2024-12-31',
  twr: 20,
  positions: [{ ticker: 'XYZ', qty: 400, entry: 2.5, cur: 3 }],
  firstBuy: new Map([['XYZ', '2024-06-03']]),
  netQty: new Map([['XYZ', 400]]),
  ledger: [{ date: '2024-06-03', at: '2024-06-03 10:00:00', ticker: 'XYZ', qty: 400, price: 2.5, cash: -1000 }],
  flows: [{ date: '2024-06-01', amount: 1000, description: 'Electronic Fund Transfer' }],
  openingCash: 0,
  cash: 0,
  navChange: { startNav: 0, endNav: 1200 },
});

const Y2025 = () => parsedLike({
  periodStart: '2025-01-01',
  periodEnd: '2025-12-31',
  twr: 5,
  positions: [{ ticker: 'XYZ', qty: 13, entry: 50, cur: 60 }],
  closed: [{
    ticker: 'XYZ', open: '2025-05-01', close: '2025-06-02', pnl: 100, pct: 20, cost: 500, carriedIn: true,
  }],
  firstBuy: new Map([['XYZ', '2025-05-01']]),
  netQty: new Map([['XYZ', 31]]),
  ledger: [
    { date: '2025-05-01', at: '2025-05-01 12:00:00', ticker: 'XYZ', qty: 40, price: 2.5, cash: -100 },
    { date: '2025-05-01', at: '2025-05-01 21:00:00', ticker: 'XYZ', qty: 1, price: 50, cash: -50 },
    { date: '2025-06-02', at: '2025-06-02 11:00:00', ticker: 'XYZ', qty: -10, price: 60, cash: 600 },
  ],
  splits: [{ ticker: 'XYZ', date: '2025-05-01', at: '2025-05-01 20:25:00', ratio: 0.05 }],
  openingHoldings: { XYZ: 400 },
  openingCash: 0,
  cash: 450,
  navChange: { startNav: 1200, endNav: 1230 },
});

describe('one statement per year', () => {
  test('a statement that straddles a new year is refused, with the reason', () => {
    assert.throws(
      () => statementRecord(parsedLike({ periodStart: '2024-11-01', periodEnd: '2025-02-28' })),
      /across more than one year/,
    );
  });

  test('a year imported again replaces the one before it', () => {
    const first = statementRecord(parsedLike({ periodStart: '2025-01-01', periodEnd: '2025-06-30' }));
    const again = statementRecord(parsedLike({ periodStart: '2025-01-01', periodEnd: '2025-03-31' }));
    const merged = withStatements([first], [again]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].to, '2025-03-31', 'the file just imported wins');
  });

  test('two files for one year in a single batch keep the one reaching later', () => {
    const short = statementRecord(parsedLike({ periodStart: '2026-01-01', periodEnd: '2026-05-31' }));
    const longer = statementRecord(parsedLike({ periodStart: '2026-01-01', periodEnd: '2026-09-11' }));
    assert.equal(withStatements([], [longer, short])[0].to, '2026-09-11');
  });

  test('years are kept oldest first, and one can be taken out again', () => {
    const merged = withStatements([], [statementRecord(Y2025()), statementRecord(Y2024())]);
    assert.deepEqual(merged.map((r) => r.year), [2024, 2025]);
    assert.deepEqual(withoutStatement(merged, 2024).map((r) => r.year), [2025]);
  });
});

describe('the years must join up', () => {
  const records = () => withStatements([], [statementRecord(Y2024()), statementRecord(Y2025())]);

  test('a year that opens where the last one closed, split and all, joins', () => {
    // 2024 closes holding 400; 2025 opens holding 400; both become 20 after
    // May's split, and the values agree at 1,200.
    assert.deepEqual(chainReport(records()).map((l) => l.ok), [true]);
  });

  test('a missing year is named', () => {
    const y2026 = statementRecord(parsedLike({ periodStart: '2026-01-01', periodEnd: '2026-03-31' }));
    const report = chainReport(withStatements([], [statementRecord(Y2024()), y2026]));
    assert.equal(report[0].ok, false);
    assert.match(report[0].reason, /No statement for 2025/);
  });

  test('a year that opens at a different value says so', () => {
    const y2025 = Y2025();
    y2025.navChange = { startNav: 900, endNav: 1230 };
    const report = chainReport(withStatements([], [statementRecord(Y2024()), statementRecord(y2025)]));
    assert.equal(report[0].ok, false);
    assert.match(report[0].reason, /closed at \$1,200\.00 but 2025 opens at \$900\.00/);
  });

  test('a year that opens holding something else says which', () => {
    const y2025 = Y2025();
    y2025.openingHoldings = { XYZ: 380 };
    const report = chainReport(withStatements([], [statementRecord(Y2024()), statementRecord(y2025)]));
    assert.equal(report[0].ok, false);
    assert.match(report[0].reason, /XYZ 20 vs 19/);
  });
});

describe('the book rebuilt from every year', () => {
  const journal = () => journalFromStatements(
    withStatements([], [statementRecord(Y2024()), statementRecord(Y2025())]),
    { snapshots: [{ date: '2025-12-01', value: 1 }], apiKey: 'k' },
  );

  test("today's positions and cash come from the newest year", () => {
    const j = journal();
    const open = j.positions.filter((p) => p.status === 'Open');
    assert.deepEqual(open.map((p) => [p.ticker, p.qty]), [['XYZ', 13]]);
    assert.equal(j.cash, 450);
    assert.equal(j.openingNav.date, '2025-01-01');
    assert.equal(j.openingNav.twr, 5);
  });

  test('closed trades and deposits come from every year', () => {
    const j = journal();
    assert.equal(j.positions.filter((p) => p.status === 'Closed').length, 1);
    assert.deepEqual(j.cashFlows.map((f) => f.date), ['2024-06-01']);
  });

  test('what the app itself recorded is kept', () => {
    const j = journal();
    assert.deepEqual(j.snapshots, [{ date: '2025-12-01', value: 1 }]);
    assert.equal(j.apiKey, 'k');
  });

  test('every row has its own id, however many years it was built from', () => {
    const j = journal();
    assert.equal(new Set(j.positions.map((p) => p.id)).size, j.positions.length);
  });

  test('the ledger runs from the first year, in after-split shares', () => {
    const { ledger } = journal();
    assert.equal(ledger.from, '2024-01-01');
    assert.equal(ledger.to, '2025-12-31');
    const xyz = ledger.events.filter((e) => e.ticker === 'XYZ').map((e) => e.qty);
    // 400 before the split is 20; the 40 bought that morning is 2; the 1 bought
    // that evening, after it, is 1.
    assert.deepEqual(xyz, [20, 2, 1, -10]);
    assert.ok(near(sum(ledger.events.filter((e) => e.ticker === 'XYZ'), (e) => e.qty), 13));
  });

  test('and prices before the split are scaled the other way', () => {
    const first = journal().ledger.events.find((e) => e.ticker === 'XYZ');
    assert.equal(first.price, 50);
  });

  test('a holding bought in an earlier year is dated to that purchase', () => {
    // Within 2025 alone the 13 shares look bought in May, and the sale looks
    // opened in May; across both years the holding began in June 2024.
    const j = journal();
    const open = j.positions.find((p) => p.status === 'Open');
    const sold = j.positions.find((p) => p.status === 'Closed');
    assert.equal(open.open, '2024-06-03');
    assert.equal(open.carriedIn, false);
    assert.equal(sold.open, '2024-06-03');
  });

  test('the ledger does not reach across a missing year', () => {
    const y2026 = statementRecord(parsedLike({
      periodStart: '2026-01-01', periodEnd: '2026-03-31', openingHoldings: {}, cash: 5,
    }));
    const j = journalFromStatements(withStatements([], [statementRecord(Y2024()), y2026]), {});
    assert.equal(j.ledger.from, '2026-01-01');
  });

  test('the statements travel with the journal so the next import can merge', () => {
    assert.deepEqual(journal().statements.map((r) => r.year), [2024, 2025]);
  });
});

describe('the newest year a journal already holds', () => {
  test('from positions, the ledger and the anchor, whichever is latest', () => {
    assert.equal(newestYearIn({ positions: [{ open: '2025-02-01', close: '2026-03-01' }] }), 2026);
    assert.equal(newestYearIn({ positions: [], ledger: { to: '2024-12-31' } }), 2024);
    assert.equal(newestYearIn({ positions: [] }), null);
  });
});

describe('the years survive the trip through the vault', () => {
  test('stored, reloaded, and a malformed year dropped', () => {
    const good = statementRecord(Y2025());
    loadState({
      positions: [],
      cash: 0,
      statements: [good, { year: 2030, from: '2024-01-01', to: '2024-12-31' }, { year: 2023, from: '2023-01-01', to: '2023-12-31', positions: 'nope' }],
    });
    assert.deepEqual(state.statements.map((r) => r.year), [2025]);
    assert.deepEqual(journalSnapshot().statements.map((r) => r.year), [2025]);
  });

  test('a holding marked as carried in stays marked', () => {
    loadState({
      positions: [{ id: 1, ticker: 'XYZ', status: 'Open', dir: 'Long', qty: 1, entry: 1, cur: 1, carriedIn: true }],
      cash: 0,
    });
    assert.equal(state.positions[0].carriedIn, true);
  });
});

/* ───────────────────────── the real statements ───────────────────────── */

/** The first file in a zip archive, read with nothing but zlib. */
function unzipFirst(path) {
  const buf = readFileSync(path);
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) return null;
  const central = buf.readUInt32LE(end + 16);
  if (buf.readUInt32LE(central) !== 0x02014b50) return null;
  const method = buf.readUInt16LE(central + 10);
  const size = buf.readUInt32LE(central + 20);
  const local = buf.readUInt32LE(central + 42);
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const data = buf.subarray(start, start + size);
  return (method === 0 ? data : inflateRawSync(data)).toString('utf8');
}

/**
 * Personal files, so not in the repository; these tests no-op without them.
 * Both places they are normally kept are tried.
 */
const PLACES = [
  'C:/Users/User/OneDrive - Reichman University/Desktop',
  'C:/Users/User/Downloads',
];
const locate = (...names) => names.flatMap((n) => PLACES.map((p) => `${p}/${n}`)).find((f) => existsSync(f));

const real = (() => {
  const zip2024 = locate('Annuals.2024 (1).zip', 'Annuals.2024.zip');
  const zip2025 = locate('Annuals.2025.zip');
  const csv2026 = locate('MULTI_20260101_20260911.csv');
  if (!zip2024 || !zip2025 || !csv2026) return null;
  return {
    2024: parseIbkrStatement(unzipFirst(zip2024)),
    2025: parseIbkrStatement(unzipFirst(zip2025)),
    2026: parseIbkrStatement(readFileSync(csv2026, 'utf8')),
  };
})();
const withReal = (fn) => () => { if (real) fn(real); };

describe('the real statements, 2024 to 2026', () => {
  test('2024, from the HTML page, matches what IBKR states', withReal((r) => {
    const p = r[2024];
    assert.equal(p.periodStart, '2024-01-01');
    assert.equal(p.navChange.startNav, 0);
    assert.ok(near(p.navChange.endNav, 15103.8));
    assert.ok(near(p.twr, -2.43));
    assert.ok(near(sum(p.flows, (f) => f.amount), 15480));
    assert.equal(p.positions.length, 4);
  }));

  test('2025, from the HTML page, matches what IBKR states', withReal((r) => {
    const p = r[2025];
    assert.ok(near(p.navChange.startNav, 15103.8));
    assert.ok(near(p.navChange.endNav, 26365.95));
    assert.ok(near(p.twr, 20.36));
    assert.equal(p.positions.length, 16);
    assert.equal(p.closed.length, 17);
    assert.ok(near(sum(p.closed, (c) => c.pnl), 889.25));
    assert.ok(near(sum(p.flows, (f) => f.amount), 6531.51));
  }));

  test("ETHU's 1-for-20 in April 2025 is found", withReal((r) => {
    assert.deepEqual(r[2025].splits, [{ ticker: 'ETHU', date: '2025-04-08', at: '2025-04-08 20:25:00', ratio: 0.05 }]);
  }));

  test('the three years join up exactly', withReal((r) => {
    const records = withStatements([], [r[2024], r[2025], r[2026]].map(statementRecord));
    assert.deepEqual(chainReport(records).map((l) => l.ok), [true, true]);
  }));

  test('walking every share from November 2024 lands on IBKR\'s holdings, ticker by ticker', withReal((r) => {
    const records = withStatements([], [r[2024], r[2025], r[2026]].map(statementRecord));
    const { ledger } = journalFromStatements(records, {});
    const held = { ...ledger.openingHoldings };
    let atNewYear = null;
    let cash = ledger.openingCash;
    for (const e of ledger.events) {
      if (!atNewYear && e.date >= '2026-01-01') atNewYear = { ...held };
      if (e.ticker && (e.kind === 'trade' || e.kind === 'transfer')) held[e.ticker] = (held[e.ticker] ?? 0) + e.qty;
      cash += e.cash;
    }
    const same = (have, want, when) => {
      for (const t of new Set([...Object.keys(have), ...Object.keys(want)])) {
        assert.ok(near(have[t] ?? 0, want[t] ?? 0, 1e-6), `${when}: ${t} walked ${have[t]} vs stated ${want[t]}`);
      }
    };
    same(atNewYear, r[2026].openingHoldings, '1 January 2026');
    same(held, ledger.holdings, '11 September 2026');
    // Everything that moved cash was a dated event, so the cash walks too — to
    // within the few cents of FX translation IBKR books without a date.
    assert.ok(near(cash, r[2026].cash, 0.05), `cash walked to ${cash}`);
  }));

  test('the rebuilt book: today from 2026, history from all three', withReal((r) => {
    const records = withStatements([], [r[2024], r[2025], r[2026]].map(statementRecord));
    const j = journalFromStatements(records, {});
    const open = j.positions.filter((p) => p.status === 'Open');
    assert.equal(open.length, 14);
    assert.equal(j.positions.length - open.length, 17 + 59);
    assert.ok(near(sum(j.cashFlows, (f) => f.amount), 15480 + 6531.51 + 8497));
    assert.ok(near(j.openingNav.twr, 30.444233794, 1e-6));
    // ETHA's first 138 shares were bought on 10 January 2025, which the 2026
    // statement alone had no way to know.
    assert.equal(open.find((p) => p.ticker === 'ETHA').open, '2025-01-10');
    assert.equal(open.find((p) => p.ticker === 'AMD').open, '2024-11-27');
  }));
});
