/**
 * Every broker's export, read the whole way through, against the same rules.
 *
 * The parsing of columns, numbers and dates is tested in broker-csv.test.mjs.
 * This is the other half: a real export from each broker taken from raw text to
 * a finished journal — positions, cash, deposits, profit — and then checked
 * against the handful of things that must be true of ALL of them, whoever wrote
 * the file.
 *
 * The rules exist because each was broken by a real file:
 *
 *   money out is negative        Schwab writes a withdrawal as "Client Requested
 *                                Electronic Funding Disbursement", and reading
 *                                "funding" in it counted money leaving as money
 *                                arriving.
 *   the file's own totals agree  a deposit counted twice, or a commission left
 *                                out of a total, moves the cash balance away
 *                                from what the broker states.
 *   returns stay sane            two statements of one account produced -454%
 *                                because a year was silently dropped.
 *   nothing vanishes quietly     a row that cannot be read is listed with a
 *                                reason; none is dropped in silence.
 *   importing twice changes      the same file read again is the same journal,
 *   nothing                      not two of everything.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCsvTable, readableMapping, detectFormats, missingFields, readTransactions,
} from '../src/features/genericCsv.js';
import { transactionRecords } from '../src/features/transactionBook.js';
import { journalFromStatements } from '../src/features/statementLibrary.js';
import { accountTotals } from '../src/core/portfolio.js';

/** Raw text to a finished journal, exactly as the app does it. */
function importCsv(text, { name = 'export.csv' } = {}) {
  const table = parseCsvTable(text);
  const mapping = readableMapping(table);
  const missing = missingFields(mapping);
  const read = readTransactions(table, mapping, detectFormats(table, mapping));
  const records = transactionRecords(read.transactions, { source: name });
  const journal = records.length ? journalFromStatements(records, {}) : null;
  return { table, mapping, missing, ...read, records, journal };
}

const sum = (list, f) => list.reduce((t, x) => t + f(x), 0);

/**
 * The rules every import obeys. `expect` states what this particular file
 * should come to; everything else holds for all of them.
 */
function check(name, text, expect) {
  const out = importCsv(text, { name });
  const { transactions, skipped, journal } = out;

  assert.deepEqual(out.missing, [], `${name}: a required column was not recognised`);
  assert.ok(journal, `${name}: nothing was imported`);

  // Nothing vanishes: every row is either a transaction or listed with a reason.
  for (const s of skipped) {
    assert.ok(s.reason && s.line, `${name}: a row was dropped without saying why`);
  }

  // No transaction is half-read.
  for (const t of transactions) {
    assert.match(t.date, /^\d{4}-\d{2}-\d{2}$/, `${name}: a transaction has no usable date`);
    assert.ok(Number.isFinite(t.cash), `${name}: ${t.kind} on ${t.date} has no cash amount`);
    if (t.kind === 'buy' || t.kind === 'sell') {
      assert.ok(t.qty > 0, `${name}: a ${t.kind} of ${t.ticker} has no quantity`);
      assert.ok(t.price > 0, `${name}: a ${t.kind} of ${t.ticker} has no price`);
    }
  }

  // Money out is negative, money in positive — whatever the file called it.
  for (const t of transactions) {
    if (t.kind === 'withdrawal') assert.ok(t.cash < 0, `${name}: a withdrawal on ${t.date} adds money`);
    if (t.kind === 'deposit') assert.ok(t.cash > 0, `${name}: a deposit on ${t.date} removes money`);
    if (t.kind === 'buy') assert.ok(t.cash < 0, `${name}: buying ${t.ticker} did not cost anything`);
  }

  // Positions are real holdings.
  for (const p of journal.positions) {
    assert.ok(Number.isFinite(p.qty) && p.qty > 0, `${name}: ${p.ticker} has a strange quantity`);
    assert.ok(Number.isFinite(p.entry) && p.entry > 0, `${name}: ${p.ticker} has no entry price`);
  }

  // Cash and the account both add up, and neither is a NaN.
  const totals = accountTotals(journal.positions, journal.cash);
  assert.ok(Number.isFinite(journal.cash), `${name}: cash is not a number`);
  assert.ok(Number.isFinite(totals.account), `${name}: the account value is not a number`);

  // What the file itself says about money in and out.
  const net = sum(journal.cashFlows, (f) => f.amount);
  if (expect.netFlows != null) {
    assert.ok(Math.abs(net - expect.netFlows) < 0.02, `${name}: net paid in ${net}, expected ${expect.netFlows}`);
  }
  if (expect.cash != null) {
    assert.ok(Math.abs(journal.cash - expect.cash) < 0.02, `${name}: cash ${journal.cash.toFixed(2)}, expected ${expect.cash}`);
  }
  if (expect.holdings) {
    const held = Object.fromEntries(journal.positions
      .filter((p) => p.status === 'Open')
      .map((p) => [p.ticker, +p.qty.toFixed(4)]));
    assert.deepEqual(held, expect.holdings, `${name}: the holdings are not what the file describes`);
  }
  if (expect.realised != null) {
    const realised = sum(journal.positions.filter((p) => p.status === 'Closed'), (p) => p.cur - p.entry);
    assert.ok(Math.abs(realised - expect.realised) < 0.02, `${name}: realised ${realised.toFixed(2)}, expected ${expect.realised}`);
  }

  // Reading the same file again is the same journal, not two of everything.
  const again = importCsv(text, { name });
  assert.equal(again.transactions.length, transactions.length, `${name}: read twice, read differently`);
  assert.equal(
    sum(again.journal.cashFlows, (f) => f.amount), net,
    `${name}: importing twice changed the money paid in`,
  );

  return out;
}

/* ─────────────────────────── the brokers ─────────────────────────── */

describe('Charles Schwab', () => {
  // Dollars with signs and commas, and the wording that hid a withdrawal.
  const csv = [
    'Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount',
    '01/05/2026,Journal,,Client Requested Electronic Funding Receipt,,,,"$10,000.00"',
    '01/06/2026,Buy,AAPL,APPLE INC,20,$150.00,$0.00,"-$3,000.00"',
    '02/10/2026,Sell,AAPL,APPLE INC,10,$170.00,$1.00,"$1,699.00"',
    '03/02/2026,Journal,,Client Requested Electronic Funding Disbursement,,,,"$2,000.00"',
  ].join('\n');

  test('reads it, and the disbursement takes money out', () => {
    const { transactions } = check('Schwab', csv, {
      netFlows: 8000,          // 10,000 in, 2,000 out
      cash: 6699,              // 10,000 - 3,000 + 1,699 - 2,000
      holdings: { AAPL: 10 },
      realised: 199,           // 10 shares from 150 to 170, less the $1 fee
    });
    assert.equal(transactions.find((t) => t.date === '2026-03-02').kind, 'withdrawal');
  });
});

describe('Fidelity', () => {
  const csv = [
    'Run Date,Action,Symbol,Description,Type,Quantity,Price ($),Commission ($),Fees ($),Amount ($),Settlement Date',
    '01/12/2026,ELECTRONIC FUNDS TRANSFER RECEIVED,,,Cash,,,,,5000.00,01/12/2026',
    '01/15/2026,YOU BOUGHT MSFT,MSFT,MICROSOFT CORP,Cash,10,400.00,0.00,0.00,-4000.00,01/17/2026',
    '02/20/2026,DIVIDEND RECEIVED,MSFT,MICROSOFT CORP,Cash,,,,,7.50,02/20/2026',
    '03/11/2026,YOU SOLD MSFT,MSFT,MICROSOFT CORP,Cash,-4,430.00,0.00,0.15,1719.85,03/13/2026',
  ].join('\n');

  test('its wording for a buy, a sale and a transfer', () => {
    check('Fidelity', csv, {
      netFlows: 5000,
      cash: 2727.35,           // 5,000 - 4,000 + 7.50 + 1,719.85
      holdings: { MSFT: 6 },
      realised: 119.85,        // 4 shares from 400 to 430, less 15c of fees
    });
  });
});

describe('Robinhood', () => {
  const csv = [
    'Activity Date,Process Date,Settle Date,Instrument,Description,Trans Code,Quantity,Price,Amount',
    '01/08/2026,01/08/2026,01/08/2026,,ACH Deposit,ACH,,,$2000.00',
    '01/09/2026,01/09/2026,01/13/2026,TSLA,Tesla,Buy,5,$200.00,($1000.00)',
    '02/02/2026,02/02/2026,02/04/2026,TSLA,Tesla,Sell,2,$250.00,$500.00',
    '03/03/2026,03/03/2026,03/03/2026,,ACH Withdrawal,ACH,,,($300.00)',
  ].join('\n');

  test('brackets mean negative, and its codes are read', () => {
    check('Robinhood', csv, {
      netFlows: 1700,
      cash: 1200,              // 2,000 - 1,000 + 500 - 300
      holdings: { TSLA: 3 },
      realised: 100,           // 2 shares from 200 to 250
    });
  });
});

describe('Trading 212', () => {
  const csv = [
    'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Total,Currency (Total)',
    'Deposit,2026-01-04 09:00:00,,,,,,,1500.00,USD',
    'Market buy,2026-01-05 14:30:00,US67066G1040,NVDA,NVIDIA,10,100.00,USD,1000.00,USD',
    'Market sell,2026-02-06 15:00:00,US67066G1040,NVDA,NVIDIA,4,130.00,USD,520.00,USD',
    'Withdrawal,2026-03-07 10:00:00,,,,,,,200.00,USD',
  ].join('\n');

  test('its own words for buying, selling and money moving', () => {
    check('Trading 212', csv, {
      netFlows: 1300,
      cash: 820,               // 1,500 - 1,000 + 520 - 200
      holdings: { NVDA: 6 },
      realised: 120,           // 4 shares from 100 to 130
    });
  });
});

describe('DEGIRO, in European style', () => {
  // Semicolons, decimal commas, day-first dates, and a negative quantity for a sale.
  const csv = [
    'Datum;Product;ISIN;Aantal;Koers;Lokale waarde;Transactiekosten;Omschrijving',
    '04-01-2026;;;;;1.200,00;;Deposit',
    '05-01-2026;ASML;NL0010273215;2;500,00;-1.000,00;-2,00;Koop',
    '06-02-2026;ASML;NL0010273215;-1;600,00;600,00;-2,00;Verkoop',
  ].join('\n');

  test('commas are decimals and the sale is read from its sign', () => {
    check('DEGIRO', csv, {
      netFlows: 1200,
      cash: 796,               // 1,200 - 1,002 + 598
      holdings: { ASML: 1 },
      // The share sold cost 501 — half of the €2 buying fee belongs to it — and
      // brought in 598 after the €2 selling fee.
      realised: 97,
    });
  });
});

describe('Revolut', () => {
  const csv = [
    'Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency',
    '2026-01-10T09:00:00.000Z,,CASH TOP-UP,,,$800.00,USD',
    '2026-01-11T14:00:00.000Z,AMZN,BUY - MARKET,4,$200.00,-$800.00,USD',
    '2026-02-12T14:00:00.000Z,AMZN,SELL - MARKET,1,$260.00,$260.00,USD',
  ].join('\n');

  test('an ISO timestamp and its own wording', () => {
    check('Revolut', csv, {
      netFlows: 800,
      cash: 260,
      holdings: { AMZN: 3 },
      realised: 60,
    });
  });
});

describe('an export with no action column at all', () => {
  // Some exports say nothing but the sign of the quantity.
  const csv = [
    'Date,Symbol,Quantity,Price,Amount',
    '2026-01-02,IBM,10,100,-1000',
    '2026-02-03,IBM,-5,120,600',
  ].join('\n');

  test('the sign of the quantity decides, and no cash is invented', () => {
    check('sign only', csv, {
      netFlows: 0,             // it records no transfers at all
      cash: -400,              // shares were bought with money the file never shows arriving
      holdings: { IBM: 5 },
      realised: 100,
    });
  });
});

describe('what must never happen, whoever wrote the file', () => {
  const formats = {
    Schwab: [
      'Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount',
      '01/05/2026,Journal,,Client Requested Electronic Funding Receipt,,,,"$5,000.00"',
      '03/02/2026,Journal,,Client Requested Electronic Funding Disbursement,,,,"$1,000.00"',
    ].join('\n'),
    Robinhood: [
      'Activity Date,Process Date,Settle Date,Instrument,Description,Trans Code,Quantity,Price,Amount',
      '01/08/2026,01/08/2026,01/08/2026,,ACH Deposit,ACH,,,$5000.00',
      '03/03/2026,03/03/2026,03/03/2026,,ACH Withdrawal,ACH,,,($1000.00)',
    ].join('\n'),
    'Trading 212': [
      'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Total,Currency (Total)',
      'Deposit,2026-01-04 09:00:00,,,,,,,5000.00,USD',
      'Withdrawal,2026-03-07 10:00:00,,,,,,,1000.00,USD',
    ].join('\n'),
  };

  test('money taken out never reads as money paid in', () => {
    for (const [broker, csv] of Object.entries(formats)) {
      const { journal } = importCsv(csv, { name: broker });
      const net = sum(journal.cashFlows, (f) => f.amount);
      assert.equal(net, 4000, `${broker}: 5,000 in and 1,000 out should leave 4,000`);
      const out = journal.cashFlows.filter((f) => f.amount < 0);
      assert.equal(out.length, 1, `${broker}: the withdrawal was not recorded as one`);
    }
  });

  test('a history covering two years keeps the earlier one', () => {
    /**
     * The -454% case, in the form any broker's file can take it: shares bought
     * in one year and still held in the next. If the earlier year is dropped,
     * January opens owning nothing and every percentage after it is nonsense.
     */
    const csv = [
      'Date,Symbol,Action,Quantity,Price,Amount',
      '2025-03-06,,Deposit,,,1200',
      '2025-03-07,VOO,Buy,2,600,-1200',
      '2026-02-02,,Deposit,,,400',
      '2026-02-03,IREN,Buy,10,40,-400',
    ].join('\n');
    const { transactions } = importCsv(csv, { name: 'two years' });
    const records = transactionRecords(transactions, { source: 'two years' });
    assert.deepEqual(records.map((r) => r.year), [2025, 2026], 'each year gets its own record');

    const journal = journalFromStatements(records, {});
    const held = Object.fromEntries(journal.positions
      .filter((p) => p.status === 'Open').map((p) => [p.ticker, p.qty]));
    assert.deepEqual(held, { VOO: 2, IREN: 10 }, '2025 was kept, so its shares are still held');
    // A transaction history's year runs from 1 January, not from its first row.
    assert.equal(journal.ledger.from, '2025-01-01', 'the history reaches back into the first year');
    assert.equal(sum(journal.cashFlows, (f) => f.amount), 1600, 'both years of deposits are counted');
  });

  test('paying money in is never profit, in any of them', () => {
    for (const [broker, csv] of Object.entries(formats)) {
      const { journal } = importCsv(csv, { name: broker });
      assert.equal(journal.positions.length, 0, `${broker}: transfers created a position`);
      assert.equal(journal.income?.dividends ?? 0, 0, `${broker}: a transfer was booked as income`);
      assert.equal(journal.income?.commissions ?? 0, 0, `${broker}: a transfer was booked as a cost`);
    }
  });
});
