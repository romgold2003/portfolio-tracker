/**
 * Statements generated without a mark-to-market summary.
 *
 * Only that section states what the account was holding when the period
 * opened, and plenty of exports are made without it. Read as an empty set
 * rather than as silence, it meant every such year "opened holding nothing" —
 * so the year before it was judged not to join, dropped from the run, and the
 * account began the newer year from zero.
 *
 * Reported on two real IBKR files, 2025 and 2026, of an account that held
 * about $2,668 at the turn of the year: year to date read -454%. With the
 * years joined, 1 January values at what was actually held and the year reads
 * a little over +12%.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseIbkrStatement } from '../src/features/ibkr.js';
import { statementRecord, chainReport, journalFromStatements } from '../src/features/statementLibrary.js';

/** A statement with trades, holdings and deposits — and no Mark-to-Market section. */
const statement = ({ from, to, trades, positions, deposits = [] }) => [
  'Statement,Header,Field Name,Field Value',
  'Statement,Data,BrokerName,Interactive Brokers LLC',
  'Statement,Data,Title,Activity Statement',
  `Statement,Data,Period,"${from} - ${to}"`,
  'Account Information,Header,Field Name,Field Value',
  'Account Information,Data,Base Currency,USD',
  'Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,Realized P/L %,MTM P/L,Code',
  ...trades,
  'Deposits & Withdrawals,Header,Currency,Settle Date,Description,Amount',
  ...deposits,
  'Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code',
  ...positions,
].join('\n');

const year2025 = statement({
  from: 'March 06, 2025', to: 'December 30, 2025',
  trades: ['Trades,Data,Order,Stocks,USD,VOO,"2025-03-06, 10:00:00",2,600,,-1200,0,1200,0.0,,0,O'],
  deposits: ['Deposits & Withdrawals,Data,USD,2025-03-06,Deposit,1200'],
  positions: ['Open Positions,Data,Summary,Stocks,USD,VOO,2,1,600,1200,,,,'],
});

const year2026 = statement({
  from: 'January 01, 2026', to: 'September 21, 2026',
  trades: ['Trades,Data,Order,Stocks,USD,IREN,"2026-02-02, 10:00:00",10,40,,-400,0,400,0.0,,0,O'],
  deposits: ['Deposits & Withdrawals,Data,USD,2026-02-02,Deposit,400'],
  positions: [
    'Open Positions,Data,Summary,Stocks,USD,VOO,2,1,600,1200,700,1400,200,',
    'Open Positions,Data,Summary,Stocks,USD,IREN,10,1,40,400,45,450,50,',
  ],
});

describe('a statement that never says what it opened holding', () => {
  test('the parser reports it as unknown, not as nothing', () => {
    const parsed = parseIbkrStatement(year2026);
    assert.equal(parsed.openingHoldings, null);
    assert.equal(statementRecord(parsed).openingHoldings, null);
  });

  test('the years still join, because there is nothing to disagree with', () => {
    const recs = [year2025, year2026].map((t) => statementRecord(parseIbkrStatement(t)));
    const [link] = chainReport(recs);
    assert.equal(link.ok, true, link.reason);
    assert.equal(link.opensUnstated, true);
  });

  test('so the earlier year is kept, and the account does not start from nothing', () => {
    const recs = [year2025, year2026].map((t) => statementRecord(parseIbkrStatement(t)));
    const journal = journalFromStatements(recs, {});
    // The run reaches back to the first year, so January can be valued at what
    // was actually held rather than at zero.
    assert.equal(journal.ledger.from, '2025-03-06');
    assert.ok(journal.ledger.events.length >= 4, 'both years of events are in the ledger');
    assert.deepEqual(journal.cashFlows.map((f) => f.amount), [1200, 400]);
  });

  test('a statement that does say is still checked, and a real disagreement still breaks', () => {
    const withMtm = year2026.replace(
      'Open Positions,Header',
      [
        'Mark-to-Market Performance Summary,Header,Asset Category,Symbol,Prior Quantity,Current Quantity,Prior Price,Current Price,Mark-to-Market P/L Position,Mark-to-Market P/L Transaction,Mark-to-Market P/L Commissions,Mark-to-Market P/L Other,Mark-to-Market P/L Total,Code',
        'Mark-to-Market Performance Summary,Data,Stocks,AAPL,5,5,100,110,50,0,0,0,50,',
        'Open Positions,Header',
      ].join('\n'),
    );
    const recs = [year2025, withMtm].map((t) => statementRecord(parseIbkrStatement(t)));
    assert.deepEqual(statementRecord(parseIbkrStatement(withMtm)).openingHoldings, { AAPL: 5 });
    const [link] = chainReport(recs);
    assert.equal(link.ok, false, 'VOO held at the end of 2025 is not what 2026 says it opened with');
    assert.match(link.reason, /did not close holding/);
  });
});
