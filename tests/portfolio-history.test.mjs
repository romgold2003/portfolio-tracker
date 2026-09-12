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

describe('the flows the chart marks', () => {
  test('come from the daily history when it has them', async () => {
    const { state } = await import('../src/core/store.js');
    const { setBackfill, externalFlows } = await import('../src/core/snapshots.js');
    state.cashFlows = [];
    setBackfill([
      { date: '2026-01-01', totalAccountValue: 100, externalCashFlow: 0 },
      { date: '2026-01-20', totalAccountValue: 2100, externalCashFlow: 2000 },
    ], { authoritative: true });
    assert.deepEqual(externalFlows(), [{ date: '2026-01-20', amount: 2000 }]);
  });

  test('fall back to the recorded cash flows when it does not', async () => {
    // The bug this exists for: a book imported before the ledger existed has no
    // daily history with flow fields, so a real account with five recorded
    // transfers showed no markers — which reads as "I never deposited" rather
    // than "this build cannot see them".
    const { state } = await import('../src/core/store.js');
    const { setBackfill, externalFlows } = await import('../src/core/snapshots.js');
    setBackfill([{ date: '2026-01-01', totalAccountValue: 100 }]);
    state.cashFlows = [
      { date: '2026-01-20', amount: 2000 },
      { date: '2026-06-05', amount: 2000 },
    ];
    assert.deepEqual(externalFlows(), [
      { date: '2026-01-20', amount: 2000 },
      { date: '2026-06-05', amount: 2000 },
    ]);
  });

  test('two transfers on one day net into one marker', async () => {
    const { state } = await import('../src/core/store.js');
    const { setBackfill, externalFlows } = await import('../src/core/snapshots.js');
    setBackfill([]);
    state.cashFlows = [
      { date: '2026-05-18', amount: 3500 },
      { date: '2026-05-18', amount: -3500 },
      { date: '2026-06-05', amount: 2000 },
    ];
    // An internal move between two of your own accounts cancels and is not a
    // deposit; only the real one is marked.
    assert.deepEqual(externalFlows(), [{ date: '2026-06-05', amount: 2000 }]);
  });

  test('they come back in date order', async () => {
    const { state } = await import('../src/core/store.js');
    const { setBackfill, externalFlows } = await import('../src/core/snapshots.js');
    setBackfill([]);
    state.cashFlows = [
      { date: '2026-06-05', amount: 2000 },
      { date: '2026-01-20', amount: 2000 },
    ];
    assert.deepEqual(externalFlows().map((f) => f.date), ['2026-01-20', '2026-06-05']);
  });
});

describe('the curve reports a gain, not a balance change', () => {
  /**
   * The curve steps up on the day money is paid in, and it should — that is
   * what the account was worth. What must not happen is the step being read
   * back out as profit.
   */
  const setup = async (flows) => {
    const { state } = await import('../src/core/store.js');
    const { setBackfill, curveSeries } = await import('../src/core/snapshots.js');
    state.positions = [];
    state.cashFlows = flows;
    setBackfill([
      { date: '2026-09-01', totalAccountValue: 10_000 },
      { date: '2026-09-02', totalAccountValue: 10_500 },
      { date: '2026-09-03', totalAccountValue: 21_000 },
    ], { authoritative: true });
    return curveSeries('All');
  };

  test('a deposit inside the window is not a gain', async () => {
    // 10,000 to 21,000, of which 10,000 was paid in on the last day. The
    // account really did earn 1,000, which is 10% of what it opened with.
    const s = await setup([{ date: '2026-09-03', amount: 10_000 }]);
    assert.equal(s.paidIn, 10_000);
    assert.equal(Math.round(s.gain), 1000);
    assert.ok(Math.abs(s.returnPct - 10) < 1e-9, `${s.returnPct}%`);
  });

  test('and the curve itself still shows the whole balance', async () => {
    const s = await setup([{ date: '2026-09-03', amount: 10_000 }]);
    assert.equal(s.data[s.data.length - 1], 21_000,
      'the account value must not be netted down to hide the deposit');
  });

  test('with no flows it is the plain difference', async () => {
    const s = await setup([]);
    assert.equal(s.paidIn, 0);
    assert.equal(Math.round(s.gain), 11_000);
  });

  test('money already there on the opening day is not subtracted twice', async () => {
    // It is inside the opening balance already; counting it again would report
    // a loss on a window that made money.
    const s = await setup([{ date: '2026-09-01', amount: 5000 }]);
    assert.equal(s.paidIn, 0);
    assert.equal(Math.round(s.gain), 11_000);
  });

  test('a withdrawal does not read as a loss', async () => {
    const { state } = await import('../src/core/store.js');
    const { setBackfill, curveSeries } = await import('../src/core/snapshots.js');
    state.positions = [];
    state.cashFlows = [{ date: '2026-09-03', amount: -4000 }];
    setBackfill([
      { date: '2026-09-01', totalAccountValue: 10_000 },
      { date: '2026-09-02', totalAccountValue: 10_500 },
      { date: '2026-09-03', totalAccountValue: 7000 },
    ], { authoritative: true });
    const s = curveSeries('All');
    assert.ok(s.returnPct > 0, `taking money out read as ${s.returnPct}%`);
  });
});

describe('the same window drawn as a percentage', () => {
  /**
   * The percentage curve is a chained daily return. The property that matters
   * is that a deposit puts a step in the value line and no step at all in this
   * one — which is the entire reason the two charts are worth having.
   */
  const build = async (rows, flows = []) => {
    const { state } = await import('../src/core/store.js');
    const { setBackfill, curveSeries } = await import('../src/core/snapshots.js');
    state.positions = [];
    state.cashFlows = flows;
    setBackfill(rows.map(([date, totalAccountValue]) => ({ date, totalAccountValue })),
      { authoritative: true });
    return curveSeries('All');
  };

  test('starts at zero, because nothing has happened yet', async () => {
    const s = await build([['2026-09-01', 10_000], ['2026-09-02', 10_500]]);
    assert.equal(s.percent[0], 0);
  });

  test('a day with no flow is just the day', async () => {
    const s = await build([['2026-09-01', 10_000], ['2026-09-02', 10_500]]);
    assert.ok(Math.abs(s.percent[1] - 5) < 1e-6, `${s.percent[1]}%`);
  });

  test('the days compound rather than adding', async () => {
    // +5% then +5% is 10.25%, not 10%.
    const s = await build([
      ['2026-09-01', 10_000], ['2026-09-02', 10_500], ['2026-09-03', 11_025],
    ]);
    assert.ok(Math.abs(s.percent[2] - 10.25) < 1e-6, `${s.percent[2]}%`);
  });

  test('a deposit puts no step in the line', async () => {
    // Day 2 is a $10,000 deposit and nothing else: the account doubles and the
    // return for the day is zero.
    const s = await build(
      [['2026-09-01', 10_000], ['2026-09-02', 20_000], ['2026-09-03', 21_000]],
      [{ date: '2026-09-02', amount: 10_000 }],
    );
    assert.equal(s.percent[1], 0, 'the deposit was drawn as a gain');
    assert.ok(Math.abs(s.percent[2] - 5) < 1e-6, `${s.percent[2]}%`);
  });

  test('and the value line still shows it, which is the difference', async () => {
    const s = await build(
      [['2026-09-01', 10_000], ['2026-09-02', 20_000], ['2026-09-03', 21_000]],
      [{ date: '2026-09-02', amount: 10_000 }],
    );
    assert.equal(s.data[1], 20_000);
  });

  test('a withdrawal is not a loss either', async () => {
    const s = await build(
      [['2026-09-01', 10_000], ['2026-09-02', 6000]],
      [{ date: '2026-09-02', amount: -4000 }],
    );
    assert.equal(s.percent[1], 0, 'taking money out was drawn as a fall');
  });

  test('a deposit on a day that also moved keeps only the move', async () => {
    // $10,000 in and the market added 2% on top: 10,000 -> 20,200.
    const s = await build(
      [['2026-09-01', 10_000], ['2026-09-02', 20_200]],
      [{ date: '2026-09-02', amount: 10_000 }],
    );
    assert.ok(Math.abs(s.percent[1] - 2) < 1e-6, `${s.percent[1]}%`);
  });

  test('the whole line is unchanged by funding the account further', async () => {
    const days = [['2026-09-01', 10_000], ['2026-09-02', 10_500], ['2026-09-03', 11_025]];
    const bare = await build(days);
    const funded = await build(
      [['2026-09-01', 10_000], ['2026-09-02', 35_500], ['2026-09-03', 37_275]],
      [{ date: '2026-09-02', amount: 25_000 }],
    );
    assert.deepEqual(funded.percent, bare.percent);
  });

  test('the day an account is founded earns nothing on the way in', async () => {
    // Opened from nothing: there is no base for that day and no return.
    const s = await build(
      [['2026-09-01', 0], ['2026-09-02', 20_000], ['2026-09-03', 21_000]],
      [{ date: '2026-09-02', amount: 20_000 }],
    );
    assert.equal(s.percent[1], 0);
    assert.ok(Math.abs(s.percent[2] - 5) < 1e-6, `${s.percent[2]}%`);
  });

  test('it is the same length and the same days as the value curve', async () => {
    const s = await build([
      ['2026-09-01', 10_000], ['2026-09-02', 10_500], ['2026-09-03', 11_025],
    ]);
    assert.equal(s.percent.length, s.data.length);
    assert.equal(s.percent.length, s.labels.length);
  });
});

describe('one bad day must not flatten the rest of the line', () => {
  const build = async (rows, flows = []) => {
    const { state } = await import('../src/core/store.js');
    const { setBackfill, curveSeries } = await import('../src/core/snapshots.js');
    state.positions = [];
    state.cashFlows = flows;
    setBackfill(rows.map(([date, totalAccountValue]) => ({ date, totalAccountValue })),
      { authoritative: true });
    return curveSeries('All');
  };

  test('an account founded onto a residue does not read as −100%', async () => {
    /**
     * Exactly what the demo book does: $287 sitting there, then a $42,000
     * transfer that restates the balance rather than adding to it. The day came
     * out at −100%, and multiplying the chain by zero flattened every day after
     * it — the whole year read −100%.
     */
    const s = await build(
      [['2026-01-04', 287.07], ['2026-01-05', 42_000], ['2026-01-06', 44_100]],
      [{ date: '2026-01-05', amount: 42_000 }],
    );
    assert.equal(s.percent[1], 0, 'the founding day earned nothing');
    assert.ok(Math.abs(s.percent[2] - 5) < 1e-6, `the day after should be +5%, got ${s.percent[2]}%`);
  });

  test('a real deposit into a real balance is still measured', async () => {
    // $50,000 into a $5,000 account is a large deposit, not a founding: that
    // day's return is perfectly well defined and must not be thrown away.
    const s = await build(
      [['2026-03-01', 5000], ['2026-03-02', 55_100]],
      [{ date: '2026-03-02', amount: 50_000 }],
    );
    assert.ok(Math.abs(s.percent[1] - 2) < 1e-6, `${s.percent[1]}%`);
  });

  test('and the whole year survives it', async () => {
    const s = await build(
      [['2026-01-04', 287.07], ['2026-01-05', 42_000], ['2026-01-06', 44_100], ['2026-01-07', 46_305]],
      [{ date: '2026-01-05', amount: 42_000 }],
    );
    assert.ok(Math.abs(s.percent[3] - 10.25) < 1e-6, `${s.percent[3]}%`);
    assert.ok(Math.abs(s.returnPct - 10.25) < 1e-6, 'the reported figure tracks the line');
  });
});

describe('money that moved on a day the curve does not carry', () => {
  /**
   * The bug this exists for, and it was worth up to thirty points.
   *
   * Flows were matched to the curve by exact date. A recorded curve only has
   * the days the app was open and a reconstructed one only trading days, so a
   * deposit on a Saturday matched nothing at all — it was never subtracted, and
   * the whole transfer was drawn as a day of extraordinary performance. On a
   * book with $8,497 paid into $26,366 the year read far above the broker's
   * own figure.
   */
  const build = async (rows, flows) => {
    const { state } = await import('../src/core/store.js');
    const { setBackfill, curveSeries } = await import('../src/core/snapshots.js');
    state.positions = [];
    state.cashFlows = flows;
    setBackfill(rows.map(([date, totalAccountValue]) => ({ date, totalAccountValue })),
      { authoritative: true });
    return curveSeries('All');
  };

  test('a weekend deposit is still not a gain', async () => {
    // Friday 10,000; Monday 20,000, of which 10,000 arrived on the Saturday.
    const s = await build(
      [['2026-01-02', 10_000], ['2026-01-05', 20_000]],
      [{ date: '2026-01-03', amount: 10_000 }],
    );
    assert.equal(s.percent[1], 0, 'the weekend deposit was drawn as a gain');
  });

  test('it lands in the step it actually happened in', async () => {
    // Saturday deposit plus a real 2% on the Monday.
    const s = await build(
      [['2026-01-02', 10_000], ['2026-01-05', 20_200]],
      [{ date: '2026-01-03', amount: 10_000 }],
    );
    assert.ok(Math.abs(s.percent[1] - 2) < 1e-6, `${s.percent[1]}%`);
  });

  test('several flows inside one step are all removed', async () => {
    const s = await build(
      [['2026-01-02', 10_000], ['2026-01-09', 15_000]],
      [{ date: '2026-01-05', amount: 3000 }, { date: '2026-01-07', amount: 2000 }],
    );
    assert.equal(s.percent[1], 0);
  });

  test('a flow before the window is left alone', async () => {
    // It is already inside the opening balance; subtracting it again would
    // invent a loss.
    const s = await build(
      [['2026-02-02', 10_000], ['2026-02-03', 10_500]],
      [{ date: '2026-01-10', amount: 5000 }],
    );
    assert.ok(Math.abs(s.percent[1] - 5) < 1e-6, `${s.percent[1]}%`);
  });

  test('a flow on the very first day is already in the opening balance', async () => {
    const s = await build(
      [['2026-02-02', 10_000], ['2026-02-03', 10_500]],
      [{ date: '2026-02-02', amount: 5000 }],
    );
    assert.ok(Math.abs(s.percent[1] - 5) < 1e-6, `${s.percent[1]}%`);
  });

  test('a long gap between drawn days still nets its deposits out', async () => {
    // Monthly snapshots with a deposit in between: the gain is the market's,
    // not the transfer's.
    const s = await build(
      [['2026-01-31', 20_000], ['2026-02-28', 32_000]],
      [{ date: '2026-02-14', amount: 10_000 }],
    );
    assert.ok(Math.abs(s.percent[1] - 10) < 1e-6, `${s.percent[1]}%`);
  });
});

describe("the chart's own figure against the broker's", () => {
  /**
   * The complaint this exists for: the benchmark chart read 47% for a year the
   * broker reports as 30.83%.
   *
   * The real statement, to the cent. Interactive Brokers, 1 January to 8
   * September 2026: opening NAV $26,365.95, five deposits totalling $8,497, and
   * their own time-weighted return of 30.825899%.
   *
   * Fed a true daily series carrying those deposits, the chained curve must
   * come back with the broker's number and not a point more. The deposits are
   * a third of the opening capital, so any that fail to be netted out show up
   * immediately and enormously — which is exactly how the 47% happened.
   */
  const OPENING = 26_365.94901;
  const IBKR_TWR = 30.825899;
  const FLOWS = [
    { date: '2026-01-20', amount: 2000 },
    { date: '2026-02-06', amount: 1997 },
    { date: '2026-03-23', amount: 1500 },
    { date: '2026-03-31', amount: 1000 },
    { date: '2026-06-05', amount: 2000 },
  ];

  /** Every date from 1 January to 8 September, or only the weekdays. */
  const days = (weekdaysOnly) => {
    const out = [];
    for (let t = Date.UTC(2026, 0, 1); t <= Date.UTC(2026, 8, 8); t += 86_400_000) {
      const d = new Date(t);
      if (weekdaysOnly && (d.getUTCDay() === 0 || d.getUTCDay() === 6)) continue;
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  };

  /**
   * A daily account value that genuinely compounds to the broker's return, with
   * the deposits landing on their real dates on top of it.
   */
  const navs = (dates) => {
    const growth = (1 + IBKR_TWR / 100) ** (1 / (dates.length - 1));
    let nav = OPENING;
    return dates.map((date, i) => {
      if (i > 0) {
        nav *= growth;
        // Anything that moved since the previous drawn day.
        for (const f of FLOWS) {
          if (f.date > dates[i - 1] && f.date <= date) nav += f.amount;
        }
      }
      return +nav.toFixed(2);
    });
  };

  const run = async (weekdaysOnly) => {
    const { state } = await import('../src/core/store.js');
    const { setBackfill, curveSeries } = await import('../src/core/snapshots.js');
    state.positions = [];
    state.cashFlows = FLOWS;
    const dates = days(weekdaysOnly);
    const values = navs(dates);
    setBackfill(dates.map((date, i) => ({ date, totalAccountValue: values[i] })),
      { authoritative: true });
    return curveSeries('All');
  };

  test('every calendar day: the broker\'s figure, to two decimals', async () => {
    const s = await run(false);
    assert.ok(Math.abs(s.percent.at(-1) - IBKR_TWR) < 0.01,
      `chart says ${s.percent.at(-1)}%, broker says ${IBKR_TWR}%`);
  });

  test('trading days only, deposits falling on weekends: the same figure', async () => {
    /**
     * The case that was wrong. Two of these five deposits land on days a
     * weekday-only series does not carry, so matching flows by exact date
     * dropped them — and a dropped deposit is drawn as pure profit.
     */
    const s = await run(true);
    assert.ok(Math.abs(s.percent.at(-1) - IBKR_TWR) < 0.01,
      `chart says ${s.percent.at(-1)}%, broker says ${IBKR_TWR}%`);
  });

  test('and it is nowhere near the figure that ignores the deposits', async () => {
    // Counting the $8,497 as performance is worth roughly sixteen points, which
    // is the gap that was reported.
    const s = await run(true);
    const ignoringFlows = ((s.data.at(-1) - s.data[0]) / s.data[0]) * 100;
    assert.ok(ignoringFlows > IBKR_TWR + 15,
      `the naive figure should be far higher: ${ignoringFlows}%`);
    assert.ok(s.percent.at(-1) < IBKR_TWR + 0.01);
  });
});
