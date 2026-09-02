/**
 * Daily ETF flows, read from the published series.
 *
 * The API answers newest first and in whole dollars, and a day that has not
 * reported carries no number at all. Each of those is a way to end up with a
 * plausible wrong chart rather than an obviously broken one.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseFlows, summarise, SERIES } from '../api/_lib/etfflows.js';

const payload = (rows) => ({ code: 0, data: rows });

describe('reading the series', () => {
  const raw = payload([
    { date: '2026-09-01', totalNetInflow: -236463473.45 },
    { date: '2026-08-31', totalNetInflow: 216700000 },
    { date: '2026-08-28', totalNetInflow: -201800000 },
  ]);

  test('carries dollars through as millions', () => {
    const flows = parseFlows(raw);
    assert.deepEqual(flows[flows.length - 1], { date: '2026-09-01', flow: -236.5 });
  });

  test('turns it round so the chart reads left to right', () => {
    // The API answers newest first; a chart wants oldest first.
    const dates = parseFlows(raw).map((f) => f.date);
    assert.deepEqual(dates, [...dates].sort());
  });

  test('a day with no figure is dropped, not counted as zero', () => {
    const flows = parseFlows(payload([
      { date: '2026-09-01', totalNetInflow: null },
      { date: '2026-08-31', totalNetInflow: 100e6 },
    ]));
    assert.equal(flows.length, 1);
    assert.equal(flows[0].flow, 100);
  });

  test('a row that is not a day is ignored', () => {
    const flows = parseFlows(payload([
      { date: 'Total', totalNetInflow: 73580e6 },
      { date: '2026-08-31', totalNetInflow: 100e6 },
    ]));
    assert.equal(flows.length, 1);
    assert.ok(!flows.some((f) => f.flow > 1000), 'a launch-to-date total leaked in');
  });

  test('only the last few weeks are kept', () => {
    const many = payload(Array.from({ length: 300 }, (_, i) => ({
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      totalNetInflow: i * 1e6,
    })));
    assert.ok(parseFlows(many, { days: 60 }).length <= 60);
    assert.ok(parseFlows(many).length > 60, 'the default keeps enough for a monthly roll-up');
  });

  test('an empty or broken answer is null, not an empty chart', () => {
    assert.equal(parseFlows(payload([])), null);
    assert.equal(parseFlows({}), null);
    assert.equal(parseFlows(null), null);
  });

  test('both series are asked for by name', () => {
    assert.equal(SERIES.BTC.type, 'us-btc-spot');
    assert.equal(SERIES.ETH.type, 'us-eth-spot');
  });
});

describe('the totals above the chart', () => {
  const flows = Array.from({ length: 30 }, (_, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, '0')}`, flow: 10,
  }));

  test('the latest day, the week and the month', () => {
    const s = summarise(flows);
    assert.equal(s.latest, 10);
    assert.equal(s.latestDate, '2026-08-30');
    assert.equal(s.week, 50);    // five trading days
    assert.equal(s.month, 210);  // twenty-one
  });

  test('nothing to summarise is null', () => {
    assert.equal(summarise([]), null);
    assert.equal(summarise(null), null);
  });
});
