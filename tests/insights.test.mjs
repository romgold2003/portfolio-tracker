/**
 * Insights (November 2026): what a person's own closed trades say about them,
 * only as far as the evidence goes — enough trades on each side, and a
 * difference checked against chance before it is called Strong or Likely.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { insightsFor, tradesOf, chanceOf, confidence, weekReview, MIN_TRADES } = await import('../src/core/insights.js');

let id = 0;
/** A closed long: bought at 100 on `open`, sold at `exit` on `close`. */
const trade = (exit, open, close, extra = {}) => ({
  id: ++id, ticker: extra.ticker ?? 'AAA', cls: 'Stocks', dir: 'Long', status: 'Closed',
  entry: 100, cur: exit, qty: 10, open, close, ...extra,
});

describe('enough evidence, and better than chance', () => {
  test('nothing before ten closed trades, and it says how many more', () => {
    const r = insightsFor([trade(110, '2026-01-05', '2026-01-09')]);
    assert.equal(r.insights.length, 0);
    assert.equal(r.needed, MIN_TRADES - 1);
  });

  test('a clear difference is unlikely to be chance; the same values either side is not', () => {
    assert.ok(chanceOf([5, 6, 7, 5, 6, 7, 6, 5, 7, 6], [-5, -6, -4, -5, -6, -4, -5, -6, -5, -4]) < 0.01);
    assert.ok(chanceOf([1, -1, 2, -2, 1, -1, 2, -2], [1, -1, 2, -2, 1, -1, 2, -2]) > 0.5);
  });

  test('fewer than eight trades on a side is too early, with the count still needed', () => {
    const few = Array.from({ length: 5 }, () => ({ ret: 1 }));
    const many = Array.from({ length: 10 }, () => ({ ret: -1 }));
    assert.deepEqual(confidence(few, many), { level: 'early', needed: 3 });
  });
});

describe('what it reads in the trades', () => {
  // Confident trades win, emotional ones lose; losers held three weeks, winners three days.
  const book = [];
  for (let i = 0; i < 10; i++) {
    const day = String(i + 1).padStart(2, '0');
    book.push(trade(112, `2026-02-${day}`, `2026-02-${String(i + 4).padStart(2, '0')}`, { mind: 9 }));
    book.push(trade(91, `2026-03-${day}`, `2026-03-${String(i + 22).padStart(2, '0')}`, { mind: 2, ticker: 'BAD' }));
  }

  test('emotional against confident, and it is Strong', () => {
    const { insights } = insightsFor(book);
    const e = insights.find((i) => i.id === 'emotion');
    assert.match(e.title, /emotional return −9\.0% on average; confident ones \+12\.0%/);
    assert.equal(e.confidence.level, 'strong');
    assert.equal(e.tone, 'good');
  });

  test('holding losers longer than winners', () => {
    const h = insightsFor(book).insights.find((i) => i.id === 'holding');
    assert.match(h.title, /You keep losing trades 7\.0× longer than winning ones \(21 days against 3\)/);
    assert.equal(h.tone, 'bad');
  });

  test('the costliest stock, the payoff and the losing streak', () => {
    const { insights } = insightsFor(book);
    assert.match(insights.find((i) => i.id === 'ticker').title, /^BAD: 10 trades, 0 wins, −\$900/);
    assert.match(insights.find((i) => i.id === 'payoff').title, /average win is \$120 and your average loss \$90: you need to be right 43%/);
    assert.match(insights.find((i) => i.id === 'streak').title, /10 trades in a row/);
  });

  test('averaging down is read from the adds, the first price worked out from the average', () => {
    // 10 bought at 100, 10 more at 80: average 90.
    const [t] = tradesOf([trade(95, '2026-04-01', '2026-04-20', { entry: 90, qty: 20, adds: [{ d: '2026-04-05', qty: 10, price: 80 }] })]);
    assert.equal(t.averagedDown, true);
    const [u] = tradesOf([trade(125, '2026-04-01', '2026-04-20', { entry: 110, qty: 20, adds: [{ d: '2026-04-05', qty: 10, price: 120 }] })]);
    assert.equal(u.averagedDown, false, 'adding to a winner is not averaging down');
  });

  test('last week: what closed in it, and how the emotional trades did', () => {
    const r = weekReview([trade(110, '2026-11-02', '2026-11-04', { mind: 3 }), trade(95, '2026-11-03', '2026-11-06', { mind: 2 }), trade(130, '2026-10-01', '2026-11-11')], new Date('2026-11-13T12:00:00Z'));
    assert.equal(r.from, '2026-11-02');
    assert.equal(r.to, '2026-11-08');
    assert.equal(r.closed, 2);
    assert.equal(r.won, 1);
    assert.equal(r.emotional, 2);
    assert.equal(r.emotionalLost, 1);
  });
});
