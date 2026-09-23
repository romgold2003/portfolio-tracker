/**
 * Money taken out of the account.
 *
 * A withdrawal must lower the account value and nothing else: it is not a loss,
 * so the percentage return has to come out the same as if the money had stayed
 * and simply not been counted.
 *
 * Two ways files hid one. Schwab calls a withdrawal "Client Requested
 * Electronic Funding Disbursement", and reading "funding" in it booked money
 * going out as money coming in. Other exports write every amount positive and
 * put the direction only in a description the classifier could not read, so the
 * sign decided and decided wrongly.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyAction, transferDirection, parseCsvTable, readableMapping, detectFormats, readTransactions,
} from '../src/features/genericCsv.js';
import { journalFromTransactions } from '../src/features/transactionBook.js';

// The book takes one record per year, each holding that year's transactions.
const journalOf = (transactions) => journalFromTransactions([{ year: 2026, transactions }]);

describe('recognising money going out', () => {
  test("Schwab's wording for a withdrawal is not a deposit", () => {
    assert.equal(classifyAction('Client Requested Electronic Funding Disbursement'), 'withdrawal');
    assert.equal(classifyAction('Client Requested Electronic Funding Receipt'), 'deposit');
  });

  test('the other wordings brokers use', () => {
    for (const words of ['CASH DISBURSEMENT', 'ACH Disbursement', 'Remittance', 'Payout', 'Cash out', 'Check Paid']) {
      assert.equal(classifyAction(words), 'withdrawal', words);
    }
  });

  test('deposits still read as deposits', () => {
    for (const words of ['Deposit', 'ACH Deposit', 'Funding', 'Top up', 'Wire Received']) {
      assert.notEqual(classifyAction(words) ?? transferDirection(words), 'withdrawal', words);
    }
  });

  test('a fee is still a fee, not money withdrawn', () => {
    assert.equal(classifyAction('Commission'), 'fee');
    assert.equal(classifyAction('Management fee debit'), 'fee');
  });
});

const read = (csv) => {
  const table = parseCsvTable(csv);
  return readTransactions(table, readableMapping(table), detectFormats(table, readableMapping(table)));
};

describe("the file's balance column settles which way the money went", () => {
  // Every amount positive, the direction nowhere the words can be read, and a
  // balance that falls by 5,000 on the third row: that row is a withdrawal.
  const csv = [
    'Date,Description,Amount,Balance',
    '2026-01-05,Opening funding,10000,10000',
    '2026-02-02,Internal movement,2000,12000',
    '2026-03-09,Internal movement,5000,7000',
  ].join('\n');

  test('a positive amount the balance says went out is a withdrawal', () => {
    const { transactions, flipped } = read(csv);
    assert.equal(flipped, 1);
    const march = transactions.find((t) => t.date === '2026-03-09');
    assert.equal(march.kind, 'withdrawal');
    assert.equal(march.cash, -5000);
  });

  test('the row the balance agrees with is left alone', () => {
    const { transactions } = read(csv);
    const february = transactions.find((t) => t.date === '2026-02-02');
    assert.equal(february.kind, 'deposit');
    assert.equal(february.cash, 2000);
  });

  test('without a balance column the guess stands, and is counted so it can be said', () => {
    const plain = [
      'Date,Description,Amount',
      '2026-01-05,Opening funding,10000',
      '2026-03-09,Internal movement,5000',
    ].join('\n');
    const { guessedCash } = read(plain);
    assert.ok(guessedCash >= 1, 'the unreadable movement is reported as a guess');
  });
});

describe('a withdrawal lowers the account and nothing else', () => {
  const trades = [
    { date: '2026-01-05', at: '2026-01-05 00:00:00', kind: 'deposit', cash: 10000 },
    { date: '2026-01-06', at: '2026-01-06 00:00:00', kind: 'buy', ticker: 'AAA', qty: 100, price: 50, cash: -5000 },
  ];
  const withdrawal = { date: '2026-06-01', at: '2026-06-01 00:00:00', kind: 'withdrawal', cash: -3000 };

  test('it comes out of cash', () => {
    const without = journalOf(trades);
    const with_ = journalOf([...trades, withdrawal]);
    assert.equal(without.cash - with_.cash, 3000);
  });

  test('it is a cash flow, never a fee or a loss', () => {
    const journal = journalOf([...trades, withdrawal]);
    const flow = journal.cashFlows.find((f) => f.date === '2026-06-01');
    assert.equal(flow.amount, -3000);
    assert.equal(flow.description, 'Withdrawal');
    assert.equal(journal.income?.commissions ?? 0, 0, 'not booked as a cost');
  });

  test('it leaves the positions and their P&L untouched', () => {
    const without = journalOf(trades);
    const with_ = journalOf([...trades, withdrawal]);
    assert.deepEqual(
      with_.positions.map((p) => [p.ticker, p.qty, p.entry, p.status]),
      without.positions.map((p) => [p.ticker, p.qty, p.entry, p.status]),
    );
  });

  test('net paid in drops by what was taken out, which is what keeps the return honest', () => {
    const journal = journalOf([...trades, withdrawal]);
    const paidIn = journal.cashFlows.reduce((sum, f) => sum + f.amount, 0);
    assert.equal(paidIn, 7000);
    // $10,000 in, $3,000 back out, account worth $7,500 -> +$500 on $7,000, not a loss.
    const account = 7500;
    assert.ok(Math.abs((account - paidIn) / paidIn * 100 - 7.142857) < 1e-4);
  });
});
