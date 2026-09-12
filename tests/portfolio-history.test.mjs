/**
 * The daily portfolio history.
 *
 * Built forward from a stated opening balance, the way a broker's own
 * Change-in-NAV report is: value = holdings at that day's marks, plus cash.
 * Never backwards from today, because a backward walk can only undo the
 * movements it knows about and silently spreads any it does not across every
 * earlier day.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildPortfolioHistory, eachDay, cashFlowMarkers } from '../src/core/portfolioHistory.js';

const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
/** A price book: ticker -> { day -> close }, answered on or before the day. */
const book = (prices) => (ticker, day) => {
  const rows = prices[ticker];
  if (!rows) return null;
  let found = null;
  for (const [d, p] of Object.entries(rows)) { if (d > day) continue; found = p; }
  return found;
};

const opening = { date: '2026-01-01', cash: 1000, holdings: { AAA: 10 } };

describe('the days covered', () => {
  test('are every calendar day, weekends included', () => {
    assert.deepEqual(eachDay('2026-01-01', '2026-01-04'),
      ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
  });

  test('an inverted range is empty rather than endless', () => {
    assert.deepEqual(eachDay('2026-02-01', '2026-01-01'), []);
  });
});

describe('the opening balance is the stated one', () => {
  test('day one is exactly the holdings at their marks plus the cash', () => {
    const h = buildPortfolioHistory({
      opening, events: [], priceOn: book({ AAA: { '2026-01-01': 50 } }), to: '2026-01-01',
    });
    assert.equal(h[0].positionsValue, 500);
    assert.equal(h[0].cashValue, 1000);
    assert.equal(h[0].totalAccountValue, 1500);
  });

  test('an event dated before the opening is ignored, not applied', () => {
    // A statement can carry last year's tax adjustment; it is not this year's.
    const h = buildPortfolioHistory({
      opening,
      events: [{ date: '2025-11-01', kind: 'tax', cash: -500 }],
      priceOn: book({ AAA: { '2026-01-01': 50 } }), to: '2026-01-01',
    });
    assert.equal(h[0].cashValue, 1000);
  });
});

describe('holdings change on the day they changed', () => {
  const priceOn = book({ AAA: { '2026-01-01': 50 }, BBB: { '2026-01-01': 20 } });

  test('a purchase adds shares and removes cash', () => {
    const h = buildPortfolioHistory({
      opening,
      events: [{ date: '2026-01-03', kind: 'trade', ticker: 'BBB', qty: 10, price: 20, cash: -200 }],
      priceOn, to: '2026-01-04',
    });
    const on = (d) => h.find((r) => r.date === d);
    assert.equal(on('2026-01-02').positionsValue, 500);
    assert.equal(on('2026-01-02').cashValue, 1000);
    assert.equal(on('2026-01-03').positionsValue, 700);
    assert.equal(on('2026-01-03').cashValue, 800);
    // Buying at the mark moves the total by nothing.
    assert.equal(on('2026-01-03').totalAccountValue, on('2026-01-02').totalAccountValue);
  });

  test('a sale removes shares and returns cash', () => {
    const h = buildPortfolioHistory({
      opening,
      events: [{ date: '2026-01-03', kind: 'trade', ticker: 'AAA', qty: -4, price: 50, cash: 200 }],
      priceOn, to: '2026-01-03',
    });
    const last = h[h.length - 1];
    assert.equal(last.positionsValue, 300);
    assert.equal(last.cashValue, 1200);
    assert.equal(last.totalAccountValue, 1500);
  });

  test('a holding sold out stops being counted', () => {
    const h = buildPortfolioHistory({
      opening,
      events: [{ date: '2026-01-02', kind: 'trade', ticker: 'AAA', qty: -10, price: 50, cash: 500 }],
      priceOn, to: '2026-01-03',
    });
    assert.equal(h[h.length - 1].positionsValue, 0);
    assert.equal(h[h.length - 1].cashValue, 1500);
  });

  test('shares transferred between accounts move without cash', () => {
    const h = buildPortfolioHistory({
      opening,
      events: [
        { date: '2026-01-02', kind: 'transfer', ticker: 'AAA', qty: -3, cash: 0 },
        { date: '2026-01-02', kind: 'transfer', ticker: 'AAA', qty: 3, cash: 0 },
      ],
      priceOn, to: '2026-01-02',
    });
    // The two legs of one internal move cancel, as they do on the statement.
    assert.equal(h[h.length - 1].positionsValue, 500);
    assert.equal(h[h.length - 1].cashValue, 1000);
  });

  test('the price moving revalues the holding without any event', () => {
    const h = buildPortfolioHistory({
      opening, events: [],
      priceOn: book({ AAA: { '2026-01-01': 50, '2026-01-03': 60 } }), to: '2026-01-03',
    });
    assert.equal(h[0].totalAccountValue, 1500);
    assert.equal(h[2].totalAccountValue, 1600);
  });
});

describe('deposits', () => {
  const priceOn = book({ AAA: { '2026-01-01': 50 } });

  test('raise the account and are recorded separately', () => {
    const h = buildPortfolioHistory({
      opening,
      events: [{ date: '2026-01-02', kind: 'flow', cash: 5000 }],
      priceOn, to: '2026-01-02',
    });
    const day = h[1];
    assert.equal(day.totalAccountValue, 6500, 'the account really is bigger');
    assert.equal(day.deposit, 5000);
    assert.equal(day.withdrawal, 0);
    assert.equal(day.externalCashFlow, 5000);
  });

  test('a withdrawal is its own field and a negative flow', () => {
    const h = buildPortfolioHistory({
      opening,
      events: [{ date: '2026-01-02', kind: 'flow', cash: -400 }],
      priceOn, to: '2026-01-02',
    });
    assert.equal(h[1].withdrawal, -400);
    assert.equal(h[1].deposit, 0);
    assert.equal(h[1].externalCashFlow, -400);
    assert.equal(h[1].totalAccountValue, 1100);
  });

  test('two on one day are one marker with the net amount', () => {
    const h = buildPortfolioHistory({
      opening,
      events: [
        { date: '2026-01-02', kind: 'flow', cash: 3000 },
        { date: '2026-01-02', kind: 'flow', cash: -1000 },
      ],
      priceOn, to: '2026-01-02',
    });
    assert.equal(h[1].deposit, 3000);
    assert.equal(h[1].withdrawal, -1000);
    const markers = cashFlowMarkers(h);
    assert.equal(markers.length, 1);
    assert.equal(markers[0].amount, 2000);
  });

  test('a day with no flow carries no marker', () => {
    const h = buildPortfolioHistory({ opening, events: [], priceOn, to: '2026-01-05' });
    assert.deepEqual(cashFlowMarkers(h), []);
  });

  test('markers know the account value they sit on', () => {
    const h = buildPortfolioHistory({
      opening, events: [{ date: '2026-01-02', kind: 'flow', cash: 5000 }], priceOn, to: '2026-01-02',
    });
    assert.equal(cashFlowMarkers(h)[0].value, 6500);
    assert.equal(cashFlowMarkers(h)[0].deposit, true);
  });
});

describe('dividends, interest and fees move cash only', () => {
  const priceOn = book({ AAA: { '2026-01-01': 50 } });

  test('a dividend raises cash and is not an external flow', () => {
    const h = buildPortfolioHistory({
      opening, events: [{ date: '2026-01-02', kind: 'dividend', cash: 12.5 }], priceOn, to: '2026-01-02',
    });
    assert.equal(h[1].cashValue, 1012.5);
    assert.equal(h[1].externalCashFlow, 0, 'a dividend is earned, not paid in');
  });

  test('interest and tax reduce cash the same way', () => {
    const h = buildPortfolioHistory({
      opening,
      events: [
        { date: '2026-01-02', kind: 'interest', cash: -1.5 },
        { date: '2026-01-02', kind: 'tax', cash: -3.5 },
      ],
      priceOn, to: '2026-01-02',
    });
    assert.equal(h[1].cashValue, 995);
    assert.equal(h[1].externalCashFlow, 0);
  });
});

describe('a holding the price service cannot answer for', () => {
  test('is carried at its last known mark rather than deleting the day', () => {
    // 250 shares of a delisted shell at 0.40 is a hundred dollars; dropping
    // every day it was held removed four months from a real account.
    const h = buildPortfolioHistory({
      opening: { date: '2026-01-01', cash: 1000, holdings: { AAA: 10, DEAD: 250 } },
      events: [],
      priceOn: book({ AAA: { '2026-01-01': 50 } }),
      lastKnown: { DEAD: [{ date: '2026-01-01', price: 0.4 }] },
      to: '2026-01-02',
    });
    assert.equal(h.length, 2);
    assert.ok(near(h[0].positionsValue, 600), `${h[0].positionsValue}`);
    assert.equal(h[0].stalePositions, 100);
  });

  test('uses the mark that applied on that day, not a later one', () => {
    // Marked 0.40 in January and eventually sold at 0.70. Carrying it at 0.70
    // all year put the opening balance seventy-five dollars out.
    const h = buildPortfolioHistory({
      opening: { date: '2026-01-01', cash: 0, holdings: { DEAD: 250 } },
      events: [],
      priceOn: () => null,
      lastKnown: { DEAD: [{ date: '2026-01-01', price: 0.4 }, { date: '2026-04-30', price: 0.7 }] },
      to: '2026-05-01',
    });
    assert.equal(h[0].totalAccountValue, 100);
    assert.equal(h[h.length - 1].totalAccountValue, 175);
  });

  test('with no mark at all it is left out rather than guessed', () => {
    const h = buildPortfolioHistory({
      opening: { date: '2026-01-01', cash: 1000, holdings: { GHOST: 5 } },
      events: [], priceOn: () => null, to: '2026-01-01',
    });
    assert.equal(h[0].positionsValue, 0);
    assert.equal(h[0].totalAccountValue, 1000);
  });
});

describe('the shape of the dataset', () => {
  test('carries every field the later graphs will need', () => {
    const h = buildPortfolioHistory({
      opening, events: [], priceOn: book({ AAA: { '2026-01-01': 50 } }), to: '2026-01-01',
    });
    assert.deepEqual(Object.keys(h[0]).sort(), [
      'cashValue', 'date', 'deposit', 'externalCashFlow',
      'positionsValue', 'stalePositions', 'totalAccountValue', 'withdrawal',
    ]);
  });

  test('every day satisfies positions + cash = total', () => {
    const h = buildPortfolioHistory({
      opening,
      events: [
        { date: '2026-01-02', kind: 'trade', ticker: 'AAA', qty: 5, price: 50, cash: -250 },
        { date: '2026-01-03', kind: 'flow', cash: 700 },
        { date: '2026-01-04', kind: 'dividend', cash: 3 },
      ],
      priceOn: book({ AAA: { '2026-01-01': 50, '2026-01-03': 55 } }), to: '2026-01-05',
    });
    for (const row of h) {
      assert.ok(near(row.positionsValue + row.cashValue, row.totalAccountValue),
        `${row.date}: ${row.positionsValue} + ${row.cashValue} != ${row.totalAccountValue}`);
    }
  });

  test('a window starting after the opening still rolls the state forward', () => {
    const h = buildPortfolioHistory({
      opening,
      events: [{ date: '2026-01-02', kind: 'flow', cash: 500 }],
      priceOn: book({ AAA: { '2026-01-01': 50 } }),
      from: '2026-01-04', to: '2026-01-05',
    });
    assert.equal(h[0].date, '2026-01-04');
    assert.equal(h[0].cashValue, 1500, 'the earlier deposit must still have happened');
  });

  test('no opening or no price source is no history rather than a guess', () => {
    assert.deepEqual(buildPortfolioHistory({ opening: null, priceOn: () => 1, to: '2026-01-02' }), []);
    assert.deepEqual(buildPortfolioHistory({ opening, priceOn: null, to: '2026-01-02' }), []);
  });
});
