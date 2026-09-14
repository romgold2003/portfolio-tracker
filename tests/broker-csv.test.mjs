/**
 * Trade histories from brokers other than Interactive Brokers.
 *
 * No broker's format is assumed, so these tests are written against the ways
 * exports differ rather than against any one of them: separators, number and
 * date conventions, where the header is, what the action column says or
 * whether there is one. Then the book: profit is first in, first out across
 * every year imported, and what the files cannot tell is warned about rather
 * than guessed.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCsvTable, guessMapping, missingFields, detectNumberStyle, parseNumber,
  detectDateOrder, parseDate, classifyAction, readTransactions, detectFormats, layoutKey, readableMapping,
} from '../src/features/genericCsv.js';
import {
  transactionRecords, journalFromTransactions, transactionWarnings, replayTransactions, transactionSummary,
} from '../src/features/transactionBook.js';
import { accountTotals } from '../src/core/portfolio.js';
import {
  chainReport, journalFromStatements, statementRecord, withStatements,
} from '../src/features/statementLibrary.js';
import { isIbkrStatement } from '../src/features/ibkr.js';
import { state, loadState } from '../src/core/store.js';

const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

/** A table read straight through with its own guesses. */
function read(text) {
  const table = parseCsvTable(text);
  const mapping = guessMapping(table.headers);
  return { table, mapping, ...readTransactions(table, mapping, detectFormats(table, mapping)) };
}

describe('reading the table', () => {
  test('a header below a title line, with semicolons and quoted fields', () => {
    const table = parseCsvTable([
      'Account statement for 1234',
      '',
      'Date;Symbol;Action;Quantity;Price;Description',
      '05.03.2025;AAPL;Buy;10;"170,50";"Apple; common"',
    ].join('\n'));
    assert.deepEqual(table.headers, ['Date', 'Symbol', 'Action', 'Quantity', 'Price', 'Description']);
    assert.deepEqual(table.rows, [['05.03.2025', 'AAPL', 'Buy', '10', '170,50', 'Apple; common']]);
  });

  test('duplicate column names are kept apart', () => {
    const table = parseCsvTable('Date,Amount,Amount\n2025-01-02,1,2\n');
    assert.deepEqual(table.headers, ['Date', 'Amount', 'Amount 2']);
  });

  test('a file from IBKR is recognised as IBKR, anything else is not', () => {
    assert.equal(isIbkrStatement('Statement,Header,Field Name,Field Value\nTrades,Header,Symbol\n'), true);
    assert.equal(isIbkrStatement('Date,Symbol,Action,Quantity,Price\n2025-01-02,AAPL,Buy,1,100\n'), false);
  });
});

describe('guessing which column is which', () => {
  test('a Robinhood-style export', () => {
    const mapping = guessMapping(['Activity Date', 'Process Date', 'Settle Date', 'Instrument', 'Description', 'Trans Code', 'Quantity', 'Price', 'Amount']);
    assert.equal(mapping.date, 'Activity Date');
    assert.equal(mapping.ticker, 'Instrument');
    assert.equal(mapping.action, 'Trans Code');
    assert.equal(mapping.quantity, 'Quantity');
    assert.equal(mapping.price, 'Price');
    assert.equal(mapping.amount, 'Amount');
  });

  test('a trade date is preferred over a settlement date', () => {
    assert.equal(guessMapping(['Settlement Date', 'Trade Date', 'Symbol', 'Qty']).date, 'Trade Date');
  });

  test('"Price per share" is the price and "Total" the amount, not the other way round', () => {
    const mapping = guessMapping(['Time', 'Ticker', 'Type', 'No. of shares', 'Price / share', 'Total', 'Currency']);
    assert.equal(mapping.quantity, 'No. of shares');
    assert.equal(mapping.amount, 'Total');
    assert.equal(mapping.currency, 'Currency');
  });

  test('a Dutch export is matched without asking, and its decimal commas are read as decimals', () => {
    /**
     * The case that caught the format detection out: with the number columns
     * unmatched there was nothing to tell a decimal comma from, and "612,30"
     * was read as 61,230. Once every column is matched the file's own numbers
     * decide.
     */
    const { mapping, transactions } = read([
      'Datum;Tijd;Product;Aantal;Koers;Waarde;Transactiekosten',
      '14-02-2024;10:02;ASML;2;"612,30";"-1.224,60";"-2,00"',
      '20-11-2025;15:40;ASML;-1;"810,00";"810,00";"-2,00"',
    ].join('\n'));
    assert.deepEqual(
      [mapping.date, mapping.ticker, mapping.quantity, mapping.price, mapping.amount, mapping.fees],
      ['Datum', 'Product', 'Aantal', 'Koers', 'Waarde', 'Transactiekosten'],
    );
    // "Waarde" is the value of the shares; the two euros of costs come on top.
    assert.deepEqual(transactions.map((t) => [t.date, t.kind, t.qty, t.price, t.cash]), [
      ['2024-02-14', 'buy', 2, 612.3, -1226.6],
      ['2025-11-20', 'sell', 1, 810, 808],
    ]);
  });

  test('what is still needed is named', () => {
    assert.deepEqual(missingFields({ date: 'Date' }), ['Ticker / symbol', 'Quantity or Total amount']);
    assert.deepEqual(missingFields({ date: 'D', ticker: 'T', quantity: 'Q' }), []);
  });

  test('a layout is recognised again whatever the case or spacing', () => {
    assert.equal(layoutKey(['Trade Date', 'Symbol']), layoutKey(['trade_date', ' SYMBOL ']));
  });
});

describe('numbers as brokers write them', () => {
  test('the decimal comma is detected from the file, not from one value', () => {
    assert.equal(detectNumberStyle(['1.234,56', '12,5', '3']), 'comma');
    assert.equal(detectNumberStyle(['1,234.56', '12.50', '3']), 'dot');
  });

  test('each style reads its own thousands and decimals', () => {
    assert.equal(parseNumber('1.234,56', 'comma'), 1234.56);
    assert.equal(parseNumber('1,234.56', 'dot'), 1234.56);
    assert.equal(parseNumber('$1,234.50', 'dot'), 1234.5);
    assert.equal(parseNumber('€ 12,00', 'comma'), 12);
  });

  test('negatives in brackets, with a trailing minus, or a leading one', () => {
    assert.equal(parseNumber('(12.50)'), -12.5);
    assert.equal(parseNumber('12.50-'), -12.5);
    assert.equal(parseNumber('-12.50 USD'), -12.5);
  });

  test('something that is not a number is null, not zero', () => {
    assert.equal(parseNumber(''), null);
    assert.equal(parseNumber('n/a'), null);
  });
});

describe('dates as brokers write them', () => {
  test('a day above twelve settles which way round', () => {
    assert.equal(detectDateOrder(['03/04/2025', '13/04/2025']), 'dmy');
    assert.equal(detectDateOrder(['03/04/2025', '04/13/2025']), 'mdy');
  });

  test('with nothing to settle it, slashes read American and dots European', () => {
    assert.equal(detectDateOrder(['03/04/2025']), 'mdy');
    assert.equal(detectDateOrder(['03.04.2025']), 'dmy');
  });

  test('every common way of writing one', () => {
    assert.deepEqual(parseDate('2025-03-04 14:05:09'), { date: '2025-03-04', time: '14:05:09' });
    assert.deepEqual(parseDate('2025-03-04T09:30:00Z'), { date: '2025-03-04', time: '09:30:00' });
    assert.equal(parseDate('04/03/2025', 'dmy').date, '2025-03-04');
    assert.equal(parseDate('03/04/2025', 'mdy').date, '2025-03-04');
    assert.equal(parseDate('3/4/25', 'mdy').date, '2025-03-04');
    assert.equal(parseDate('Mar 4, 2025').date, '2025-03-04');
    assert.equal(parseDate('4 janv. 2025').date, '2025-01-04');
    assert.deepEqual(parseDate('03/04/2025 2:05 PM', 'mdy'), { date: '2025-03-04', time: '14:05:00' });
  });

  test('an impossible date is null rather than rolled into the next month', () => {
    assert.equal(parseDate('31/02/2025', 'dmy'), null);
    assert.equal(parseDate('not a date'), null);
  });
});

describe('what kind of transaction a row is', () => {
  test('in the words brokers use', () => {
    assert.equal(classifyAction('Buy'), 'buy');
    assert.equal(classifyAction('Market sell'), 'sell');
    assert.equal(classifyAction('SLD'), 'sell');
    assert.equal(classifyAction('Achat'), 'buy');
    assert.equal(classifyAction('CDIV'), 'dividend');
    // A reinvested dividend is a purchase when it has a quantity; that is
    // decided where the quantity is read.
    assert.equal(classifyAction('Dividend reinvestment buy'), 'reinvest');
    assert.equal(classifyAction('ACH Deposit'), 'deposit');
    assert.equal(classifyAction('Withdrawal'), 'withdrawal');
    assert.equal(classifyAction('Commission'), 'fee');
    assert.equal(classifyAction('Interest earned'), 'interest');
    assert.equal(classifyAction('Wire transfer'), 'transfer');
    assert.equal(classifyAction('Stock split'), 'split');
    assert.equal(classifyAction('Something else'), null);
  });

  test('a tax refund is money back, not another charge', () => {
    // Israeli brokers charge capital-gains tax monthly and credit it back after
    // a losing month. Both rows read as tax; only the charge takes money out.
    const { transactions } = read([
      'Date,Action,Symbol,Quantity,Price,Amount,Fees',
      '2026-04-05,Tax,,,,-6.61,0',
      '2026-05-03,Tax refund,,,,17.80,0',
    ].join('\n'));
    assert.deepEqual(transactions.map((t) => [t.kind, t.cash]), [['fee', -6.61], ['fee', 17.8]]);
  });
});

describe('rows into transactions', () => {
  test('buys and sells with a fee column and no total: cash rebuilt from them', () => {
    const { transactions } = read('Date,Symbol,Action,Quantity,Price,Fees\n2025-01-02,AAPL,Buy,10,100,1\n2025-02-03,AAPL,Sell,4,120,1\n');
    assert.deepEqual(transactions.map((t) => [t.kind, t.qty, t.price, t.cash]), [
      ['buy', 10, 100, -1001],
      ['sell', 4, 120, 479],
    ]);
  });

  test('a total column is trusted as the cash that moved', () => {
    const { transactions } = read('Date,Symbol,Type,Quantity,Price,Amount\n2025-01-02,AAPL,Buy,10,100,-1003.50\n');
    assert.equal(transactions[0].cash, -1003.5);
  });

  test('a total with the fee already in it is not charged the fee twice', () => {
    // 10 at 100 is 1,000; a total of 1,001 already includes the dollar fee.
    const { transactions } = read('Date,Symbol,Type,Quantity,Price,Amount,Fees\n2025-01-02,AAPL,Buy,10,100,-1001,1\n2025-01-03,AAPL,Sell,10,110,1099,1\n');
    assert.deepEqual(transactions.map((t) => t.cash), [-1001, 1099]);
  });

  test('a total of the shares alone still has its fee taken off', () => {
    // A total exactly equal to quantity times price has no fee in it yet.
    const { transactions } = read('Date,Symbol,Type,Quantity,Price,Amount,Fees\n2025-01-02,AAPL,Buy,10,100,-1000,1\n2025-01-03,AAPL,Sell,10,110,1100,1\n');
    assert.deepEqual(transactions.map((t) => t.cash), [-1001, 1099]);
  });

  test('with no action column a negative quantity is a sale', () => {
    const { transactions } = read('Date,Ticker,Quantity,Price\n2025-01-02,MSFT,5,300\n2025-03-02,MSFT,-2,310\n');
    assert.deepEqual(transactions.map((t) => t.kind), ['buy', 'sell']);
    assert.equal(transactions[1].qty, 2);
  });

  test('a price can be worked out from the total when it is missing', () => {
    const { transactions } = read('Date,Symbol,Action,Quantity,Amount\n2025-01-02,AAPL,Buy,4,-400\n');
    assert.equal(transactions[0].price, 100);
  });

  test('deposits, withdrawals, dividends and fees', () => {
    const { transactions } = read([
      'Date,Symbol,Action,Quantity,Price,Amount',
      '2025-01-01,,Deposit,,,5000',
      '2025-02-01,AAPL,Dividend,,,12.40',
      '2025-03-01,,Monthly fee,,,-2',
      '2025-04-01,,Withdrawal,,,1000',
    ].join('\n'));
    assert.deepEqual(transactions.map((t) => [t.kind, t.cash]), [
      ['deposit', 5000], ['dividend', 12.4], ['fee', -2], ['withdrawal', -1000],
    ]);
  });

  test('a European export: semicolons, decimal commas, day-first dates', () => {
    const { transactions } = read('Datum;Symbol;Type;Quantity;Price\n05.03.2025;ASML;Kauf;2;"612,30"\n');
    assert.deepEqual(
      transactions.map((t) => [t.date, t.kind, t.ticker, t.qty, t.price]),
      [['2025-03-05', 'buy', 'ASML', 2, 612.3]],
    );
  });

  test('rows that are not transactions are listed with the reason, not silently dropped', () => {
    const { transactions, skipped } = read([
      'Date,Symbol,Action,Quantity,Price',
      'Total,,,,',
      '2025-01-02,AAPL,Buy,,100',
      '2025-01-03,AAPL,Stock split,2,',
    ].join('\n'));
    assert.equal(transactions.length, 0);
    assert.deepEqual(skipped.map((s) => s.line), [1, 2, 3]);
    assert.match(skipped[0].reason, /no date/);
    assert.match(skipped[1].reason, /no quantity/);
    assert.match(skipped[2].reason, /split/);
  });
});

/* ───────────────────────── the book ───────────────────────── */

/** Transactions for a test, dated and ordered the way readTransactions writes them. */
const tx = (date, kind, fields = {}) => ({ date, at: `${date} ${fields.time ?? '00:00:00'}`, order: 0, kind, ...fields });

describe('one record per year', () => {
  const all = [
    tx('2024-06-01', 'deposit', { cash: 5000 }),
    tx('2024-06-03', 'buy', { ticker: 'AAPL', qty: 10, price: 100, cash: -1000 }),
    tx('2025-02-01', 'sell', { ticker: 'AAPL', qty: 5, price: 130, cash: 650 }),
  ];

  test('a history covering several years is split into its years', () => {
    const records = transactionRecords(all, { source: 'history.csv' });
    assert.deepEqual(records.map((r) => [r.year, r.from, r.to, r.transactions.length]), [
      [2024, '2024-06-01', '2024-06-03', 2],
      [2025, '2025-02-01', '2025-02-01', 1],
    ]);
    assert.equal(records[0].kind, 'transactions');
    assert.equal(records[0].source, 'history.csv');
  });

  test('a chosen year keeps only that year', () => {
    assert.deepEqual(transactionRecords(all, { year: 2025 }).map((r) => r.year), [2025]);
  });
});

describe('profit, first in first out, across the years', () => {
  /**
   * Two lots bought in 2024 — 10 at 100 with a dollar fee, 10 at 120 — and 15
   * sold in 2025 at 150 with a dollar fee. The sale takes the older lot whole
   * and five of the newer: 1,001 + 600 = 1,601 of cost against 2,249 of
   * proceeds, a profit of 648. Five shares at 120 are left.
   */
  const records = () => withStatements([], [
    ...transactionRecords([
      tx('2024-01-02', 'deposit', { cash: 5000 }),
      tx('2024-03-01', 'buy', { ticker: 'AAPL', qty: 10, price: 100, cash: -1001 }),
      tx('2024-09-01', 'buy', { ticker: 'AAPL', qty: 10, price: 120, cash: -1200 }),
    ]),
    ...transactionRecords([
      tx('2025-05-01', 'sell', { ticker: 'AAPL', qty: 15, price: 150, cash: 2249 }),
      tx('2025-06-01', 'dividend', { ticker: 'AAPL', cash: 10 }),
      tx('2025-07-01', 'buy', { ticker: 'BTC', qty: 0.1, price: 60000, cash: -6000 }),
    ]),
  ]);

  test('a sale is costed against the oldest shares, even ones bought the year before', () => {
    const j = journalFromStatements(records(), {});
    const sold = j.positions.find((p) => p.status === 'Closed');
    assert.ok(near(sold.entry, 1601), `cost ${sold.entry}`);
    assert.ok(near(sold.exits[0].pnl, 648), `profit ${sold.exits[0].pnl}`);
    assert.equal(sold.open, '2024-03-01', 'dated to when the holding began');
  });

  test('what is left is held at the cost of the lots left', () => {
    const j = journalFromStatements(records(), {});
    const aapl = j.positions.find((p) => p.status === 'Open' && p.ticker === 'AAPL');
    assert.equal(aapl.qty, 5);
    assert.equal(aapl.entry, 120);
    assert.equal(aapl.cur, 150, 'marked at the last price the files show');
  });

  test('a crypto ticker is filed as crypto, so its price can be fetched', () => {
    const j = journalFromStatements(records(), {});
    assert.equal(j.positions.find((p) => p.ticker === 'BTC').cls, 'Crypto');
  });

  test('cash, deposits and income add up from every year', () => {
    const j = journalFromStatements(records(), {});
    assert.ok(near(j.cash, 5000 - 1001 - 1200 + 2249 + 10 - 6000));
    assert.deepEqual(j.cashFlows.map((f) => [f.date, f.amount]), [['2024-01-02', 5000]]);
    assert.equal(j.income.dividends, 10);
  });

  test('the ledger walks from the first year, so past days can be valued', () => {
    const { ledger } = journalFromStatements(records(), {});
    assert.equal(ledger.from, '2024-01-01');
    assert.equal(ledger.openingCash, 0);
    assert.deepEqual(ledger.holdings, { AAPL: 5, BTC: 0.1 });
  });

  test('a year added later changes the cost of a sale in the year after it', () => {
    // Without 2024 the 2025 sale has no purchase to cost against, so it is
    // booked at no profit and says so.
    const only2025 = records().filter((r) => r.year === 2025);
    assert.match(transactionWarnings(only2025).join(' '), /AAPL: more shares were sold/);
    const sold = replayTransactions(only2025.flatMap((r) => r.transactions)).closed[0];
    assert.ok(near(sold.pnl, 0));
    assert.equal(sold.uncovered, true);
    assert.deepEqual(transactionWarnings(records()).filter((w) => /more shares/.test(w)), []);
  });

  test('a day trade with no times buys before it sells', () => {
    const book = replayTransactions([
      tx('2025-01-02', 'sell', { ticker: 'X', qty: 1, price: 11, cash: 11 }),
      tx('2025-01-02', 'buy', { ticker: 'X', qty: 1, price: 10, cash: -10 }),
    ]);
    assert.equal(book.uncovered.size, 0);
    assert.equal(book.closed[0].pnl, 1);
  });

  test('cash going negative is warned about, with the date', () => {
    const warnings = transactionWarnings(transactionRecords([
      tx('2025-01-02', 'buy', { ticker: 'X', qty: 1, price: 100, cash: -100 }),
    ]));
    assert.match(warnings.join(' '), /Cash goes negative \(-\$100\.00 on 2025-01-02\)/);
  });
});

describe('years from other brokers alongside the rest', () => {
  test('a missing year is named gently, since there may have been no trades', () => {
    const records = withStatements([], [
      ...transactionRecords([tx('2023-01-02', 'deposit', { cash: 1 })]),
      ...transactionRecords([tx('2025-01-02', 'deposit', { cash: 1 })]),
    ]);
    const [link] = chainReport(records);
    assert.equal(link.ok, false);
    assert.match(link.reason, /No file for 2024 — fine if there were no trades that year/);
  });

  test('consecutive years join', () => {
    const records = transactionRecords([tx('2024-12-30', 'deposit', { cash: 1 }), tx('2025-01-02', 'deposit', { cash: 1 })]);
    assert.deepEqual(chainReport(records).map((l) => l.ok), [true]);
  });

  test('an IBKR statement and another broker cannot be combined in one journal', () => {
    const ibkr = statementRecord({
      periodStart: '2025-01-01', periodEnd: '2025-12-31', positions: [], closed: [], flows: [], navChange: {},
    });
    const other = transactionRecords([tx('2024-05-01', 'deposit', { cash: 1 })]);
    const records = withStatements([], [ibkr, ...other]);
    assert.throws(() => journalFromStatements(records, {}), /cannot be combined/);
    assert.match(chainReport(records)[0].reason, /cannot be joined/);
  });

  test('the transactions survive being stored and reloaded', () => {
    const [record] = transactionRecords([tx('2025-01-02', 'buy', { ticker: 'X', qty: 1, price: 1, cash: -1 })]);
    const j = journalFromTransactions([record], {});
    loadState(j);
    assert.equal(state.statements.length, 1);
    assert.equal(state.statements[0].transactions.length, 1);
    assert.equal(state.statements[0].kind, 'transactions');
  });
});

/* ───────────────────────── the phantom money people reported ───────────────────────── */

describe('money that was never in the account', () => {
  /**
   * Reported after release: an import showing thousands the person never had.
   * Each case below is a layout that produced exactly that, run straight
   * through as someone accepting every guess would. The truth in each is a
   * 10,000 deposit and 20 AAPL bought at 200 — an account of 10,000 — with
   * whatever the case adds on top.
   */
  const account = (text) => {
    const { transactions, repriced } = read(text);
    const records = transactionRecords(transactions);
    const j = journalFromTransactions(records, {});
    return { records, transactions, repriced, value: accountTotals(j.positions, j.cash).account };
  };

  test('a transfer to the bank written as a positive amount is money out, not in', () => {
    // Read by the sign alone this was a second deposit: 12,000 where 8,000 is true.
    const { value, transactions } = account([
      'Date,Description,Symbol,Quantity,Price,Amount',
      '2025-01-02,ACH Deposit,,,,10000',
      '2025-01-03,Buy,AAPL,20,200,-4000',
      '2025-03-01,Transfer to bank,,,,2000',
    ].join('\n'));
    assert.deepEqual(transactions.map((t) => t.kind), ['deposit', 'buy', 'withdrawal']);
    assert.ok(near(value, 8000), `account ${value}`);
  });

  test('the direction is found in the description even when a type column exists', () => {
    const { value } = account([
      'Date,Type,Description,Symbol,Quantity,Price,Amount',
      '2025-01-02,Transfer,Incoming wire,,,,10000',
      '2025-01-03,Buy,Apple,AAPL,20,200,-4000',
      '2025-03-01,Transfer,Wire out to checking,,,,2000',
    ].join('\n'));
    assert.ok(near(value, 8000), `account ${value}`);
  });

  test('a price in pence against a total in pounds is not a hundred times the holding', () => {
    // 4,000 shares at 100p is £4,000. Read as £100 a share it was £400,000.
    const { value, repriced } = account([
      'Time,Action,Ticker,No. of shares,Price / share,Currency (Price / share),Total',
      '2025-01-02,Deposit,,,,,10000',
      '2025-01-03,Market buy,VOD,4000,100,GBX,4000',
    ].join('\n'));
    assert.equal(repriced, 1);
    assert.ok(near(value, 10000), `account ${value}`);
  });

  test('and the foreign currency is said, since prices are fetched in dollars', () => {
    const { records } = account([
      'Time,Action,Ticker,No. of shares,Price / share,Currency (Price / share),Total',
      '2025-01-02,Deposit,,,,,10000',
      '2025-01-03,Market buy,VOD,4000,100,GBX,4000',
    ].join('\n'));
    assert.match(transactionWarnings(records).join(' '), /Amounts in GBX/);
  });

  test('a deposit listed twice is pointed out, with the amount and the day', () => {
    const { records, value } = account([
      'Date,Type,Symbol,Quantity,Price,Amount',
      '2025-01-02,Deposit,,,,10000',
      '2025-01-02,Cash In,,,,10000',
      '2025-01-03,Buy,AAPL,20,200,-4000',
    ].join('\n'));
    assert.ok(near(value, 20000), 'both rows are real rows in the file, so both are read');
    assert.match(transactionWarnings(records).join(' '), /2 deposits of \$10,000\.00 on 2025-01-02/);
  });

  test('a dividend reinvested in shares adds the shares', () => {
    const { value, transactions } = account([
      'Date,Action,Symbol,Quantity,Price,Amount',
      '2025-01-02,Deposit,,,,10000',
      '2025-01-03,Buy,AAPL,20,200,-4000',
      '2025-02-01,Dividend,AAPL,,,50',
      '2025-02-01,Dividend Reinvestment,AAPL,0.25,200,-50',
    ].join('\n'));
    assert.deepEqual(transactions.map((t) => t.kind), ['deposit', 'buy', 'dividend', 'buy']);
    assert.ok(near(value, 10050), `account ${value}`);
  });

  test('a price that matches its total is left alone, fee or no fee', () => {
    const { repriced } = account('Date,Symbol,Action,Quantity,Price,Amount,Fees\n2025-01-02,AAPL,Buy,10,100,-1001,1\n2025-01-03,AAPL,Buy,3,20,-61,1\n');
    assert.equal(repriced, 0);
  });

  test('the preview can show how the account adds up, line by line', () => {
    const { records } = account([
      'Date,Description,Symbol,Quantity,Price,Amount',
      '2025-01-02,ACH Deposit,,,,10000',
      '2025-01-03,Buy,AAPL,20,200,-4000',
      '2025-02-01,Dividend,AAPL,,,50',
      '2025-03-01,Transfer to bank,,,,2000',
    ].join('\n'));
    const s = transactionSummary(records);
    assert.deepEqual(
      [s.deposits, s.withdrawals, s.bought, s.sold, s.income, s.fees, s.cash, s.holdings, s.account],
      [10000, 2000, 4000, 0, 50, 0, 4050, 4000, 8050],
    );
  });

  test('a description column is matched on its own and does not take the place of a type column', () => {
    const mapping = guessMapping(['Date', 'Trans Code', 'Description', 'Symbol', 'Quantity', 'Price', 'Amount']);
    assert.equal(mapping.action, 'Trans Code');
    assert.equal(mapping.description, 'Description');
  });
});

describe('any broker file, read with no questions', () => {
  /** Read the way the import does: columns recognised by the app alone. */
  function auto(text) {
    const table = parseCsvTable(text);
    const mapping = readableMapping(table);
    return { mapping, missing: missingFields(mapping), ...readTransactions(table, mapping, detectFormats(table, mapping)) };
  }

  /**
   * An Israeli bank's report, saved as CSV: Hebrew headers under a title line,
   * Hebrew actions, and an amount column that leaves out the $1.50 commission
   * its own cash balance shows was paid.
   */
  const hebrew = [
    'פירוט תנועות לתקופה 04.03.2025 - 13.09.2026 (במטבע דולר ארה״ב)',
    'תאריך,סוג פעולה,שם הנייר,כמות,מחיר ממוצע,סכום הפעולה,עמלה,יתרת מזומן',
    '06/03/2025,הפקדה,,,,500,0,500',
    '06/03/2025,קנייה,IVV,0.4323,578.25,-249.98,0,250.02',
    '21/03/2025,דיבידנד,IVV,,,0.56,0,250.58',
    '21/03/2025,ביטול דיבידנד,IVV,,,-0.01,0,250.57',
    '05/04/2026,חיוב מס מרץ,,,,-6.61,0,243.96',
    '03/05/2026,זיכוי מס אפריל,,,,17.8,0,261.76',
    '14/05/2026,קנייה,OILD,3.1742,47.26,-150,0,110.26',
    '15/05/2026,מכירה,IVV,0.4323,670.18,289.72,0,398.48',
    '16/05/2026,משיכה,,,,-100,0,298.48',
  ].join('\n');

  test('Hebrew headers and actions are recognised', () => {
    const r = auto(hebrew);
    assert.deepEqual(r.missing, []);
    assert.deepEqual(
      [r.mapping.date, r.mapping.action, r.mapping.ticker, r.mapping.quantity, r.mapping.price, r.mapping.amount, r.mapping.balance],
      ['תאריך', 'סוג פעולה', 'שם הנייר', 'כמות', 'מחיר ממוצע', 'סכום הפעולה', 'יתרת מזומן'],
    );
    assert.deepEqual(r.transactions.map((t) => t.kind),
      ['deposit', 'buy', 'dividend', 'dividend', 'fee', 'fee', 'buy', 'sell', 'withdrawal']);
    assert.equal(r.skipped.length, 0);
    assert.equal(r.transactions[0].date, '2025-03-06');
  });

  test('the cash balance puts back the commission the amount column left out', () => {
    const r = auto(hebrew);
    const oild = r.transactions.find((t) => t.ticker === 'OILD');
    assert.equal(oild.cash, -151.5);
    // The sale paid its commission too: 289.72 written, 288.22 received.
    assert.equal(r.transactions.find((t) => t.kind === 'sell').cash, 288.22);
    assert.equal(r.rebalanced, 2);
    assert.equal(r.transactions.find((t) => t.kind === 'fee' && t.cash > 0).cash, 17.8);
    const cash = r.transactions.reduce((s, t) => s + t.cash, 0);
    assert.ok(near(cash, 298.48), `${cash}`);
  });

  test('a file listed newest first is balanced the other way round', () => {
    const lines = hebrew.split('\n');
    const r = auto([lines[1], ...lines.slice(2).reverse()].join('\n'));
    assert.equal(r.transactions.find((t) => t.ticker === 'OILD').cash, -151.5);
    // The same day's rows keep the file's order in time: the deposit before the purchase it paid for.
    const book = replayTransactions(r.transactions);
    assert.ok(book.lowest.value >= 0, `cash went to ${book.lowest.value}`);
  });

  test('a balance that does not follow the amounts is left alone', () => {
    const r = auto([
      'Date,Symbol,Action,Quantity,Price,Amount,Balance',
      '2026-01-02,AAPL,Buy,1,100,-100,9000',
      '2026-01-03,MSFT,Buy,1,200,-200,12000',
      '2026-01-04,AAPL,Sell,1,110,110,8000',
    ].join('\n'));
    assert.equal(r.rebalanced, 0);
    assert.deepEqual(r.transactions.map((t) => t.cash), [-100, -200, 110]);
  });

  test('headers in words no hint knows are read from what the columns hold', () => {
    const r = auto([
      'When,Code,What,Shares,Cash',
      '02/01/2026,AAPL,Buy,1,-100',
      '05/01/2026,MSFT,Buy,1,-200',
      '09/01/2026,AAPL,Sell,1,120',
    ].join('\n'));
    assert.deepEqual(r.missing, []);
    assert.deepEqual([r.mapping.date, r.mapping.ticker, r.mapping.action, r.mapping.amount], ['When', 'Code', 'What', 'Cash']);
    assert.deepEqual(r.transactions.map((t) => [t.kind, t.ticker]), [['buy', 'AAPL'], ['buy', 'MSFT'], ['sell', 'AAPL']]);
  });

  test('a column of one repeated code is not taken for the ticker', () => {
    const table = parseCsvTable('When,Ccy,Stock name,Cash\n2026-01-02,USD,Apple Inc,-100\n2026-01-03,USD,Microsoft,-200\n2026-01-04,USD,Apple Inc,50\n');
    assert.notEqual(readableMapping(table).ticker, 'Ccy');
  });
});
