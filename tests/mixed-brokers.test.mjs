/**
 * One account across a change of broker.
 *
 * Asked for directly: someone on Robinhood in 2025 who moves to Interactive
 * Brokers in 2026 must be able to import both years. Such files used to be
 * refused as impossible to combine. Now each year is read on its own terms and
 * the years are joined: today's book from the newest, every year's trades and
 * deposits in the history, and a CSV year picking up the holdings and cash the
 * year before it closed with.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseIbkrStatement } from '../src/features/ibkr.js';
import {
  statementRecord, journalFromStatements, chainReport, importPlan,
} from '../src/features/statementLibrary.js';
import { transactionRecords } from '../src/features/transactionBook.js';

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

/** An IBKR activity statement in miniature: 120 AAA held at a cost of 105, cash 5,000. */
const ibkrStatement = (year) => [
  'Statement,Header,Field Name,Field Value',
  `Statement,Data,Period,"January 1, ${year} - September 8, ${year}"`,
  'Net asset value,Header,Asset Class,Prior Total,Current Long,Current Short,Current Total,Change',
  'Net asset value,Data,Cash,2000,5000,0,5000,3000',
  'Net asset value,Data,Total,12000,25000,0,25000,13000',
  'Mark-to-market performance summary,Header,Asset Category,Symbol,Prior Quantity,Current Quantity,'
    + 'Prior Price,Current Price,Mark-to-Market P/L Position,Mark-to-Market P/L Transaction,'
    + 'Mark-to-Market P/L Commissions,Mark-to-Market P/L Other,Mark-to-Market P/L Total,Code',
  'Mark-to-market performance summary,Data,Stocks,AAA,100,120,100,150,5000,0,0,0,5000,',
  'Open positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Quantity,Mult,Cost Price,'
    + 'Cost Basis,Close Price,Value,Unrealized P/L,Code',
  'Open positions,Data,Summary,Stocks,USD,AAA,120,1,105,12600,150,18000,5400,',
  'Trades,Header,DataDiscriminator,Asset Category,Currency,Account,Symbol,Date/Time,Quantity,'
    + 'T. Price,Close Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code',
  `Trades,Data,Order,Stocks,USD,U1,AAA,"${year}-03-02, 10:00:00",20,120,120,-2400,-1,2401,0,0,O`,
  'Deposits & withdrawals,Header,Currency,Account,Settle Date,Description,Amount',
  `Deposits & withdrawals,Data,USD,U1,${year}-02-10,Electronic fund transfer,1500`,
].join('\n');

let order = 0;
const tx = (date, kind, extra) => ({ date, at: `${date} 10:00:00`, order: order++, kind, ...extra });
const openOf = (journal) => journal.positions.filter((p) => p.status === 'Open')
  .map((p) => `${p.ticker}:${+p.qty.toFixed(6)}`).sort();
const closedOf = (journal) => journal.positions.filter((p) => p.status === 'Closed');

describe('a CSV broker, then Interactive Brokers', () => {
  // 2025 at a broker that exports transactions: paid in, bought MSFT, sold half of it.
  const robinhood2025 = () => transactionRecords([
    tx('2025-02-03', 'deposit', { cash: 3000 }),
    tx('2025-02-04', 'buy', { ticker: 'MSFT', qty: 10, price: 100, cash: -1000 }),
    tx('2025-06-02', 'sell', { ticker: 'MSFT', qty: 5, price: 120, cash: 600 }),
  ], { source: 'robinhood_2025.csv' });
  const ibkr2026 = () => statementRecord(parseIbkrStatement(ibkrStatement(2026)));

  test('both years import, joined as a change of broker', () => {
    const plan = importPlan(robinhood2025(), [ibkr2026()]);
    assert.equal(plan.mixed, false);
    assert.deepEqual(plan.records.map((r) => r.year), [2025, 2026]);
    const [link] = chainReport(plan.records);
    assert.equal(link.brokerChange, true);
    assert.equal(link.ok, true);
  });

  test("today's book is the IBKR statement's, and the 2025 trade and deposit stay in the history", () => {
    const records = importPlan(robinhood2025(), [ibkr2026()]).records;
    const journal = journalFromStatements(records, {});
    const ibkrAlone = journalFromStatements([ibkr2026()], {});
    assert.deepEqual(openOf(journal), openOf(ibkrAlone));
    assert.ok(near(journal.cash, ibkrAlone.cash), `${journal.cash} vs ${ibkrAlone.cash}`);
    // MSFT's sale at Robinhood is a closed trade: 5 shares, bought at 100, sold at 120.
    const msft = closedOf(journal).find((p) => p.ticker === 'MSFT');
    assert.ok(msft, 'the 2025 trade is in the history');
    assert.ok(near(msft.cur - msft.entry, 100), `${msft.cur - msft.entry}`);
    const flows = journal.cashFlows.map((f) => `${f.date}:${f.amount}`);
    assert.ok(flows.includes('2025-02-03:3000'), flows.join(' '));
    assert.ok(flows.includes('2026-02-10:1500'), flows.join(' '));
    assert.deepEqual(journal.statements.map((r) => r.year), [2025, 2026]);
  });
});

describe('Interactive Brokers, then a CSV broker', () => {
  const ibkr2025 = () => statementRecord(parseIbkrStatement(ibkrStatement(2025)));
  // 2026 at a broker that exports transactions: sells 20 of the AAA carried over, buys NVDA.
  const csv2026 = () => transactionRecords([
    tx('2026-03-10', 'sell', { ticker: 'AAA', qty: 20, price: 160, cash: 3200 }),
    tx('2026-04-01', 'buy', { ticker: 'NVDA', qty: 5, price: 100, cash: -500 }),
  ], { source: 'new_broker_2026.csv' });

  test('the CSV year starts from what 2025 closed with, not from nothing', () => {
    const closing = journalFromStatements([ibkr2025()], {});
    const journal = journalFromStatements(importPlan([ibkr2025()], csv2026()).records, {});
    const aaaBefore = closing.positions.find((p) => p.status === 'Open' && p.ticker === 'AAA').qty;
    assert.deepEqual(openOf(journal), [`AAA:${aaaBefore - 20}`, 'NVDA:5']);
    assert.ok(near(journal.cash, closing.cash + 3200 - 500), `${journal.cash}`);
  });

  test('a sale of shares carried across is costed at what they cost, not as shares from nowhere', () => {
    const closing = journalFromStatements([ibkr2025()], {});
    const cost = closing.positions.find((p) => p.status === 'Open' && p.ticker === 'AAA').entry;
    const journal = journalFromStatements(importPlan([ibkr2025()], csv2026()).records, {});
    const sale = closedOf(journal).find((p) => p.ticker === 'AAA' && p.close === '2026-03-10');
    assert.ok(sale, 'the 2026 sale is a closed trade');
    assert.ok(near(sale.cur - sale.entry, 20 * (160 - cost)), `${sale.cur - sale.entry}`);
  });

  test('carrying across is not a deposit', () => {
    const journal = journalFromStatements(importPlan([ibkr2025()], csv2026()).records, {});
    const ibkrFlows = journalFromStatements([ibkr2025()], {}).cashFlows.length;
    assert.equal(journal.cashFlows.length, ibkrFlows, "only the statement's own deposits");
  });
});
