/**
 * Insights, the personal analyst (November 2026): what a person's trades and
 * account say about them, only as far as the evidence goes, in plain words,
 * with every formula checked here against numbers worked out by hand.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const {
  analyse, tradesOf, chanceOf, chanceVsZero, confidence, whyOf, twinSeries, indexLevels, levelOn,
  twinDaily, tradeLife, twinOfLife, accountDays, pairDays, traderTitle, moodOf, MIN_TRADES, LEVELS, RARITY,
} = await import('../src/core/insights.js');

let id = 0;
/** A closed long: bought at 100 on `open`, sold at `exit` on `close`. */
const trade = (exit, open, close, extra = {}) => ({
  id: ++id, ticker: extra.ticker ?? 'AAA', cls: 'Stocks', dir: 'Long', status: 'Closed',
  entry: 100, cur: exit, qty: 10, open, close, ...extra,
});

/** Weekdays from `from` to `to`. */
function weekdays(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86400000) {
    const d = new Date(t);
    if (d.getUTCDay() % 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * A market and an account from December 2025: the S&P moves a little every
 * day and falls 1.5% every tenth day; the account moves 1.5× as much, so it
 * falls harder and swings more. $10,000 to start, $5,000 paid in on 1 June.
 */
const DAYS = weekdays('2025-12-01', '2026-11-13');
const spxMove = (i) => (i % 10 === 9 ? -1.5 : 0.25 + 0.4 * Math.sin(i));
const INDEX = [];
const HISTORY = [];
{
  let close = 500;
  let value = 10000;
  DAYS.forEach((date, i) => {
    if (i) close *= 1 + spxMove(i) / 100;
    const flow = date === '2026-06-01' ? 5000 : 0;
    if (i) value = value * (1 + (1.5 * spxMove(i)) / 100) + flow;
    INDEX.push({ date, close });
    HISTORY.push({ date, totalAccountValue: value, externalCashFlow: flow });
  });
}
const TODAY = '2026-11-13';
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} ≠ ${b}`);

describe('enough evidence, and better than chance', () => {
  test('trade patterns wait for data, and say how much more they need', () => {
    const r = analyse({ positions: [trade(110, '2026-01-05', '2026-01-09')], today: TODAY });
    assert.equal(r.needed, MIN_TRADES - 1);
    assert.equal(r.profile.title, null);
    const h = r.cards.find((c) => c.id === 'holding');
    assert.equal(h.confidence.level, 'early');
    assert.equal(h.headline, undefined, 'no conclusion is drawn');
    assert.equal(r.cards.find((c) => c.id === 'weekday'), undefined, 'no best-day-to-open card');
    assert.equal(r.standOut.length, 0);
  });

  test('a clear difference is unlikely to be chance; the same values either side is not', () => {
    assert.ok(chanceOf([5, 6, 7, 5, 6, 7, 6, 5, 7, 6], [-5, -6, -4, -5, -6, -4, -5, -6, -5, -4]) < 0.01);
    assert.ok(chanceOf([1, -1, 2, -2, 1, -1, 2, -2], [1, -1, 2, -2, 1, -1, 2, -2]) > 0.5);
    assert.ok(chanceVsZero([3, 4, 2, 5, 3, 4, 2, 3, 4, 5]) < 0.01, 'beating the S&P on every trade is not luck');
    assert.ok(chanceVsZero([3, -3, 2, -2, 4, -4, 1, -1]) > 0.5);
  });

  test('fewer than eight on a side is too early, with the count still needed', () => {
    const few = Array.from({ length: 5 }, () => ({ ret: 1 }));
    const many = Array.from({ length: 10 }, () => ({ ret: -1 }));
    assert.deepEqual(confidence(few, many), { level: 'early', needed: 3 });
  });
});

describe('the measured why', () => {
  test('names the context a group shares far more than the rest', () => {
    const group = Array.from({ length: 6 }, (_, i) => ({ spx5: i < 5 ? 2 : 0, days: 5 }));
    const rest = Array.from({ length: 10 }, () => ({ spx5: 0.2, days: 5 }));
    const why = whyOf(group, rest);
    assert.equal(why.id, 'spxUp');
    assert.match(why.text, /^5 of 6 came after the S&P 500 had risen 1\.5% or more in the five days before, against 0% of your other trades\.$/);
  });

  test('and says nothing when nothing stands out', () => {
    const same = Array.from({ length: 8 }, () => ({ spx5: 0.1, days: 5 }));
    assert.equal(whyOf(same, same), null);
  });
});

describe('the account against the market', () => {
  const r = analyse({ positions: [], history: HISTORY, index: INDEX, today: TODAY, year: { you: 20, spx: 12 } });
  const card = (cardId) => r.cards.find((c) => c.id === cardId);

  test('a day after a gap in the history is not compared with one market day', () => {
    const ix = indexLevels(INDEX);
    const gappy = HISTORY.filter((row) => row.date < '2026-03-02' || row.date > '2026-03-13');
    const paired = pairDays(accountDays(gappy), ix);
    assert.ok(!paired.some((d) => d.date === '2026-03-16'), 'the day after the gap spans two weeks');
    assert.ok(paired.some((d) => d.date === '2026-03-17'));
  });

  test('the whole-account twin gets every deposit on the same day', () => {
    const ix = indexLevels(INDEX);
    const s = twinSeries(HISTORY, ix);
    assert.equal(s[0].twin, s[0].you, 'both start from the same value');
    const june = s.findIndex((p) => p.date === '2026-06-01');
    const twinBefore = s[june - 1].twin * (1 + ix.daily.get('2026-06-01') / 100);
    near(s[june].twin, twinBefore + 5000);
    assert.equal(card('twin'), undefined, 'no trades, no trade twin');
  });

  test('when the market falls 1%+, the account falls 150% as much, in plain words', () => {
    const d = card('down');
    assert.equal(d.headline, 'When the market falls, your account usually falls harder');
    assert.match(d.more, /^That is 150% of the market's move\./);
    assert.equal(d.tone, 'bad');
  });

  test('it moves 1.5× as much as the market', () => {
    assert.match(card('swings').headline, /^Your account moves more than the market, /);
    assert.match(card('swings').data, /moves 1\.5× as much as the S&P 500/);
  });

  test('the months and the biggest drop, and no last-week card', () => {
    assert.equal(card('week'), undefined, 'no last-week card');
    assert.match(card('months').headline, /^You beat the market in \d+ of the last \d+ months$/);
    assert.match(card('drawdown').headline, /^Your biggest drop from a high was \d+\.\d%$/);
    assert.match(card('drawdown').matters, /deeper than the market's biggest drop/);
  });

  test('the year is Home\'s own figure, passed through, and opens the summary', () => {
    assert.deepEqual(r.year, { you: 20, spx: 12 });
    assert.match(r.summary, /^This year your account is up 20\.0%, while the S&P 500 is up 12\.0%\. You are ahead of the market\./);
  });
});

describe('a trade\'s life and its S&P twin', () => {
  test('the first purchase is worked out from the average once the top-ups are out', () => {
    // 10 at 100, then 10 more at 80: average 90. Sold 5 at 95, then 15 at 110.
    const life = tradeLife({
      dir: 'Long', status: 'Closed', open: '2026-03-02', close: '2026-04-01', entry: 90, qty: 20, cur: 106.25,
      adds: [{ d: '2026-03-09', qty: 10, price: 80 }],
      exits: [{ d: '2026-03-16', qty: 5, price: 95 }, { d: '2026-04-01', qty: 15, price: 110 }],
    });
    assert.deepEqual(life.buys, [{ d: '2026-03-02', qty: 10, price: 100 }, { d: '2026-03-09', qty: 10, price: 80 }]);
    assert.equal(life.sells.length, 2);
  });

  test('a closed trade with no recorded sales sells everything on its close date', () => {
    const life = tradeLife({ dir: 'Long', status: 'Closed', open: '2026-03-02', close: '2026-03-20', entry: 50, qty: 4, cur: 60 });
    assert.deepEqual(life.sells, [{ d: '2026-03-20', qty: 4, price: 60 }]);
  });

  test('the twin buys with each purchase and sells the same share with each sale', () => {
    const ix = indexLevels(INDEX);
    const L = (d) => levelOn(ix, d);
    const life = {
      dir: 1,
      buys: [{ d: '2026-03-02', qty: 10, price: 100 }, { d: '2026-03-09', qty: 10, price: 80 }],
      sells: [{ d: '2026-03-16', qty: 5, price: 95 }, { d: '2026-04-01', qty: 15, price: 110 }],
    };
    const units = 1000 / L('2026-03-02') + 800 / L('2026-03-09');
    const back = units * 0.25 * L('2026-03-16') + units * 0.75 * L('2026-04-01');
    const t = twinOfLife(life, ix, TODAY);
    near(t.pnl, back - 1800);
    near(t.paid, 1800);
  });

  test('day by day: a held trade is marked at the stock\'s close in its own prices, then its final figure', () => {
    const ix = indexLevels(INDEX);
    const prices = new Map([['AAA', DAYS.map((date, i) => ({ date, close: 100 + i }))]]);
    const open = DAYS[100];
    const mid = DAYS[110];
    const close = DAYS[120];
    // 5 bought at $200 ($1,000), sold at $230 (+$150) on a day the stock closed at 220.
    const life = { dir: 1, buys: [{ d: open, qty: 5, price: 200 }], sells: [{ d: close, qty: 5, price: 230 }], price: 230 };
    const s = twinDaily([{ ticker: 'AAA', life, close, you: 150, spx: 40, live: false }], ix, prices, null, TODAY);
    const at = (d) => s.find((p) => p.date === d);
    assert.equal(at(DAYS[99]).you, 0, 'nothing before it was bought');
    near(at(mid).you, 5 * 210 * (230 / 220) - 1000);
    near(at(mid).twin, 1000 * (levelOn(ix, mid) / levelOn(ix, open) - 1));
    assert.deepEqual([at(close).you, at(close).twin], [150, 40]);
    assert.equal(s[s.length - 1].date, TODAY);
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
  const r = analyse({ positions: book, history: HISTORY, index: INDEX, today: TODAY });
  const card = (cardId) => r.cards.find((c) => c.id === cardId);

  test('emotional against confident, a clear pattern, with what it cost', () => {
    const e = card('emotion');
    assert.equal(e.headline, 'Your calm, confident trades win more often');
    assert.equal(e.confidence.level, 'strong');
    assert.equal(e.data, 'Confident (rated 7–10): 10 of 10 won (100%). Emotional (rated 1–4): 0 of 10 won (0%).');
    assert.equal(e.unit, 'rate');
    assert.match(e.more, /^Your emotional trades added up to −\$900; your confident trades \+\$1,200\.$/);
  });

  test('holding losers longer than winners, and what the long ones lost', () => {
    const h = card('holding');
    assert.equal(h.headline, 'You tend to hold losing trades longer than winning ones');
    assert.equal(h.data, 'Winners: 3 days on average. Losers: 21 days. Based on 20 trades.');
    assert.match(h.more, /^10 losing trades stayed open .* lost \$900 together\.$/);
  });

  test('the S&P twin: each trade\'s money in the S&P from the day bought to the day sold', () => {
    const ix = indexLevels(INDEX);
    const t = card('twin').twin.year;
    assert.equal(t.decided, 20);
    assert.equal(t.you, 10 * 120 - 10 * 90);
    const expected = book.reduce((s, p) => s + 1000 * (levelOn(ix, p.close) / levelOn(ix, p.open) - 1), 0);
    near(t.twin, expected);
    const last = t.series[t.series.length - 1];
    near(last.you, t.you);
    near(last.twin, t.twin);
    assert.ok(t.account && t.account.diffPct > 0, 'the whole-account line rides along');
  });

  test('what stands out is only ever a fact or a pattern unlikely to be chance', () => {
    assert.ok(r.standOut.length >= 2);
    for (const s of r.standOut) {
      const c = card(s.id);
      assert.ok(!c.confidence || ['strong', 'likely'].includes(c.confidence.level), `${s.id} is solid`);
    }
    const improve = r.standOut.find((s) => s.kind === 'improve');
    assert.ok(improve, 'there is an area to improve');
    const head = card(improve.id).headline;
    assert.ok(r.summary.includes(`Worth watching: ${head[0].toLowerCase()}${head.slice(1)}.`));
  });

  test('no card uses judging words', () => {
    const text = r.cards.map((c) => [c.headline, c.matters, c.data].join(' ')).join(' ') + r.summary;
    for (const word of [/bad trader/i, /terrible/i, /you are losing money/i, /high-risk behaviou?r/i]) assert.doesNotMatch(text, word);
  });

  test('after you sold: the 30 days that followed, from the stock\'s own closes', () => {
    const closes = [];
    for (let t = Date.parse('2026-01-01T00:00:00Z'); t <= Date.parse('2026-11-13T00:00:00Z'); t += 86400000) {
      const date = new Date(t).toISOString().slice(0, 10);
      closes.push({ date, close: 100 + closes.length * 0.5 });
    }
    const sold = Array.from({ length: 10 }, (_, i) => trade(110, closes[20 + i * 10].date, closes[25 + i * 10].date, { ticker: 'UP' }));
    const a = analyse({ positions: sold, history: HISTORY, index: INDEX, series: new Map([['UP', closes]]), today: TODAY });
    const c = a.cards.find((x) => x.id === 'after');
    assert.equal(c.headline, 'You tend to sell winners too early');
    // 30 calendar days of +0.5 a day from wherever each was sold, averaged over the ten.
    const moves = Array.from({ length: 10 }, (_, i) => (15 / (100 + (25 + i * 10) * 0.5)) * 100);
    const avg = moves.reduce((x, y) => x + y, 0) / moves.length;
    assert.match(c.data, new RegExp(`rose a further ${avg.toFixed(1)}%`));
  });
});

describe('the investing style', () => {
  test('a day trader who wins most is the Day Sniper', () => {
    const fridays = weekdays('2026-03-02', '2026-06-30').filter((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 5);
    const trades = tradesOf(fridays.slice(0, 12).map((d, i) => trade(i % 3 ? 104 : 98, d, d)));
    assert.equal(traderTitle(trades).name, 'The Day Sniper');
  });

  test('few wins but big ones is the Home-Run Hitter', () => {
    const t = tradesOf(Array.from({ length: 10 }, (_, i) => trade(i < 3 ? 150 : 95, '2026-02-02', '2026-03-20')));
    assert.equal(traderTitle(t).name, 'The Home-Run Hitter');
  });

  test('the market\'s mood in CNN\'s own bands', () => {
    assert.equal(moodOf(24), 'Extreme fear');
    assert.equal(moodOf(25), 'Fear');
    assert.equal(moodOf(55), 'Neutral');
    assert.equal(moodOf(75), 'Greed');
    assert.equal(moodOf(76), 'Extreme greed');
  });
});

describe('the trader card: one title, and a collection', () => {
  // The same 1.5× market and account as above, and a book that earns a known set of cards.
  const book = [
    trade(250, '2026-01-05', '2026-02-02', { ticker: 'BIG' }), // +150%: Doubler, +$1,500: Four Figures
    ...Array.from({ length: 5 }, (_, i) => trade(110, `2026-02-0${i + 2}`, `2026-02-1${i}`, { ticker: `W${i}` })), // five wins in a row
    trade(90, '2025-01-02', '2026-03-02', { ticker: 'OLD' }), // over a year, in the red: Iron Will, One-Year Club
    trade(96, '2026-03-03', '2026-03-06', { ticker: 'CUT', dir: 'Long' }),
  ];
  const r = analyse({ positions: book, history: HISTORY, index: INDEX, today: TODAY });
  const { collection } = r.profile;
  const card = (key) => collection.cards.find((c) => c.key === key);

  test('thirty cards across the four families, each with a rarity worth points', () => {
    assert.equal(collection.total, 30);
    assert.deepEqual([...new Set(collection.cards.map((c) => c.family))], ['survival', 'wins', 'patience', 'milestones']);
    for (const c of collection.cards) assert.equal(c.points, RARITY[c.rarity]);
  });

  test('cards are earned from the trades, with the date they were earned', () => {
    assert.equal(card('doubler').earned, '2026-02-02');
    assert.match(card('doubler').detail, /^BIG, \+150%\.$/);
    assert.equal(card('fourfigures').earned, '2026-02-02');
    assert.ok(card('hotstreak').earned, 'six winners in a row');
    assert.equal(card('ironwill').earned, '2026-01-02', 'a year after it was opened');
    assert.equal(card('oneyear').earned, '2026-01-02');
    assert.equal(card('first').earned, '2026-02-02');
    assert.equal(card('tenbagger').earned, null, 'not +1,000%');
    assert.equal(card('unstoppable').earned, null);
  });

  test('a market fall is survived only by holding through it', () => {
    // The S&P here never falls 10% from its high, so no correction to survive.
    assert.equal(card('correction').earned, null);
  });

  test('the level comes from the points, and the next level is named', () => {
    const points = collection.cards.filter((c) => c.earned).reduce((s, c) => s + c.points, 0);
    assert.equal(collection.points, points);
    const level = [...LEVELS].reverse().find(([, from]) => points >= from)[0];
    assert.equal(r.profile.level, level);
    assert.ok(collection.next && collection.next.points > points);
  });
});

describe('the drawings', () => {
  test('every achievement and every style has its own drawing', async () => {
    const { art } = await import('../src/ui/art/cards.js');
    const { TITLES, TITLE_RULES } = await import('../src/core/insights.js');
    const fallback = art('no-such-card');
    const r = analyse({ positions: [], today: TODAY });
    const keys = [...r.profile.collection.cards.map((c) => c.key), ...Object.keys(TITLES).map((k) => `style:${k}`)];
    assert.equal(keys.length, 42);
    for (const k of keys) {
      const drawing = art(k);
      assert.notEqual(drawing, fallback, `${k} has a drawing`);
      assert.match(drawing, /^<svg class="art" viewBox="0 0 64 64"/);
    }
    assert.deepEqual(Object.keys(TITLE_RULES).sort(), Object.keys(TITLES).sort(), 'every style says who gets it');
  });
});

describe('this year counts what you already held on 31 December', () => {
  // A stock rising a point a day; held since June 2025, one with no opening date, and one with no prices.
  const closes = DAYS.map((date, i) => ({ date, close: 100 + i }));
  const last = closes[closes.length - 1].close;
  const dec31 = closes.find((r) => r.date === '2025-12-31').close;
  const positions = [
    { id: 'h1', ticker: 'HOLD', cls: 'Stocks', dir: 'Long', status: 'Open', entry: 50, qty: 10, cur: last, open: '2025-06-02' },
    { id: 'h2', ticker: 'OLD', cls: 'Stocks', dir: 'Long', status: 'Open', entry: 40, qty: 5, cur: last, open: null },
    { id: 'h3', ticker: 'NOPRICE', cls: 'Stocks', dir: 'Long', status: 'Open', entry: 20, qty: 5, cur: 30, open: '2025-03-03' },
  ];
  const series = new Map([['HOLD', closes], ['OLD', closes]]);
  const r = analyse({ positions, history: HISTORY, index: INDEX, series, today: TODAY, year: { you: 25, spx: 11 } });
  const year = r.cards.find((c) => c.id === 'twin').twin.year;
  const ix = indexLevels(INDEX);

  test('a holding carried into the year counts from its close on 31 December, not from what was paid', () => {
    const hold = year.rows.find((x) => x.ticker === 'HOLD');
    near(hold.you, 10 * (last - dec31));
    near(hold.spx, 10 * dec31 * (levelOn(ix, TODAY) / levelOn(ix, '2025-12-31') - 1));
  });

  test('a holding with no opening date counts too', () => {
    assert.ok(year.rows.some((x) => x.ticker === 'OLD'));
  });

  test('one whose prices did not load is counted apart, not guessed', () => {
    assert.deepEqual(year.unmeasured, [{ ticker: 'NOPRICE', why: 'its price history has not loaded' }]);
    assert.ok(!year.rows.some((x) => x.ticker === 'NOPRICE'));
  });

  test('the summary puts the year in money with the whole account, the same comparison as the percentages', () => {
    const acc = year.account;
    assert.ok(acc);
    assert.ok(r.summary.includes(Math.abs(Math.round(acc.diff)).toLocaleString('en-US')), r.summary);
    assert.match(r.summary, /^This year your account is up 25\.0%, while the S&P 500 is up 11\.0%\. You are ahead of the market\. In money, /);
  });
});

describe('the year from the broker\'s ledger', () => {
  /**
   * Romy's ETHA in 2026, as IBKR's ledger has it (in pre-split shares, which
   * is how this ledger is written): 138 held on 31 December at $22.43, five
   * purchases through the year at $12–17, all sold near $20. IBKR: about +$430
   * before commissions. The position alone, with the year's purchases folded
   * into its average, read every share as held on 31 December: −$856.
   */
  const ledger = {
    from: '2026-01-01', to: '2026-11-06',
    openingHoldings: { ETHA: 138 }, openingMarks: { ETHA: 22.43 },
    events: [
      { date: '2026-02-03', kind: 'trade', ticker: 'ETHA', qty: 34, price: 16.9 },
      { date: '2026-02-05', kind: 'trade', ticker: 'ETHA', qty: 60, price: 15 },
      { date: '2026-02-17', kind: 'trade', ticker: 'ETHA', qty: 4, price: 14.68 },
      { date: '2026-05-28', kind: 'trade', ticker: 'ETHA', qty: 20, price: 14.97 },
      { date: '2026-06-05', kind: 'trade', ticker: 'ETHA', qty: 35, price: 12.2 },
      { date: '2026-09-18', kind: 'trade', ticker: 'ETHA', qty: -140, price: 19.93 },
      { date: '2026-09-21', kind: 'trade', ticker: 'ETHA', qty: -85, price: 20.8 },
      { date: '2026-10-30', kind: 'trade', ticker: 'ETHA', qty: -66, price: 16.83 },
      { date: '2026-03-02', kind: 'flow', cash: 1000 },
    ],
  };
  const positions = [{ id: 'e1', ticker: 'ETHA', cls: 'Stocks', dir: 'Long', status: 'Closed', entry: 18.2, qty: 291, cur: 19.6, open: null, close: '2026-10-30' }];
  const r = analyse({ positions, history: HISTORY, index: INDEX, ledger, today: TODAY });
  const year = r.cards.find((c) => c.id === 'twin').twin.year;

  test('each purchase counts at its own price, and the holding on 31 December at the broker\'s', () => {
    const bought = 34 * 16.9 + 60 * 15 + 4 * 14.68 + 20 * 14.97 + 35 * 12.2;
    const sold = 140 * 19.93 + 85 * 20.8 + 66 * 16.83;
    const etha = year.rows.find((x) => x.ticker === 'ETHA');
    near(etha.you, sold - bought - 138 * 22.43);
    assert.ok(etha.you > 0, 'a gain, as IBKR has it');
    assert.equal(etha.live, false);
  });

  test('the S&P side gets the same money on the same days', () => {
    const ix = indexLevels(INDEX);
    const L = (d) => levelOn(ix, d);
    let units = (138 * 22.43) / L('2025-12-31');
    let paid = 138 * 22.43;
    for (const [d, q, p] of [['2026-02-03', 34, 16.9], ['2026-02-05', 60, 15], ['2026-02-17', 4, 14.68], ['2026-05-28', 20, 14.97], ['2026-06-05', 35, 12.2]]) { units += (q * p) / L(d); paid += q * p; }
    let held = 291;
    let back = 0;
    for (const [d, q] of [['2026-09-18', 140], ['2026-09-21', 85], ['2026-10-30', 66]]) { const part = q / held; back += units * part * L(d); units -= units * part; held -= q; }
    near(year.rows.find((x) => x.ticker === 'ETHA').spx, back - paid);
  });

  test('without a ledger or prices, nothing is guessed', () => {
    const alone = analyse({ positions, history: HISTORY, index: INDEX, today: TODAY });
    assert.equal(alone.cards.find((c) => c.id === 'twin'), undefined, 'no year drawn from a holding it cannot price');
  });
});

describe('after you sell: every sale since the beginning, averaged', () => {
  // One calendar close a day for each stock: UP rises 1 a day from 100, DOWN falls 0.5 a day from 200.
  const days = [];
  for (let t = Date.parse('2025-01-01T00:00:00Z'); t <= Date.parse('2026-11-13T00:00:00Z'); t += 86400000) days.push(new Date(t).toISOString().slice(0, 10));
  const up = days.map((date, i) => ({ date, close: 100 + i }));
  const down = days.map((date, i) => ({ date, close: 200 - i * 0.5 }));
  const closeOf = (rows, d) => rows.find((r) => r.date === d).close;
  const sold = (ticker, close, extra = {}) => ({ id: `${ticker}${close}${extra.lot ?? ''}`, ticker, cls: 'Stocks', dir: 'Long', status: 'Closed', entry: 50, cur: 120, qty: 10, open: '2025-01-02', close, ...extra });
  // Eight UP sales, one of them split into two tax lots; two DOWN sales, one a short; one with no opening date.
  const positions = [
    ...['2025-03-03', '2025-05-05', '2025-07-07', '2025-09-08', '2026-01-05', '2026-03-02', '2026-05-04'].map((d) => sold('UP', d)),
    sold('UP', '2026-07-06', { lot: 'a', qty: 4 }), sold('UP', '2026-07-06', { lot: 'b', qty: 6 }),
    sold('DOWN', '2025-04-01', { open: null }),
    sold('DOWN', '2026-02-02', { dir: 'Short', entry: 300 }),
    sold('UP', '2026-11-10'), // too recent for a week
  ];
  const r = analyse({ positions, series: new Map([['UP', up], ['DOWN', down]]), today: TODAY });
  const c = r.cards.find((x) => x.id === 'after');

  test('each move is the stock 7 and 30 days on, over its close the day sold; the average is their sum over the count', () => {
    const ups = ['2025-03-03', '2025-05-05', '2025-07-07', '2025-09-08', '2026-01-05', '2026-03-02', '2026-05-04', '2026-07-06'];
    const move = (rows, d, n, sign = 1) => {
      const later = new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
      return (closeOf(rows, later) / closeOf(rows, d) - 1) * 100 * sign;
    };
    const moves = (n) => [
      ...ups.map((d) => move(up, d, n)),
      move(down, '2025-04-01', n),
      move(down, '2026-02-02', n, -1), // a short: the fall is the stock moving its way
    ];
    const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const fmt = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
    assert.equal(c.data.split('\n')[0], `1 week after you sold: ${fmt(avg(moves(7)))} on average, over 10 sales.`);
    assert.equal(c.data.split('\n')[1], `1 month after you sold: ${fmt(avg(moves(30)))} on average, over 10 sales.`);
    assert.equal(c.data.split('\n')[2], `3 months after you sold: ${fmt(avg(moves(90)))} on average, over 10 sales.`);
  });

  test('two tax lots of one stock sold on one day are one sale; a position with no opening date counts', () => {
    assert.match(c.data, /over 10 sales/);
    assert.ok(c.trades.includes('UP2026-07-06a') && c.trades.includes('UP2026-07-06b') ? true : c.trades.length <= 9);
  });

  test('the lines sit in the one card: the week, the month, three months', () => {
    assert.equal(r.cards.filter((x) => x.id === 'after').length, 1);
    assert.deepEqual(c.bars.map(([label]) => label), ['A week later', 'A month later', '3 months later']);
  });
});

describe('you against the market, this year, in Home\'s own dollars', () => {
  const book = Array.from({ length: 3 }, (_, i) => trade(120, `2026-02-0${i + 2}`, `2026-03-0${i + 2}`));
  const r = analyse({ positions: book, history: HISTORY, index: INDEX, today: TODAY, year: { you: 25, spx: 11, pnl: 4321.5 } });
  const year = r.cards.find((c) => c.id === 'twin').twin.year;

  test('"You made" is exactly what Home shows under YTD', () => {
    assert.equal(year.whole.you, 4321.5);
  });

  test('the S&P side is the account on 31 December and every deposit since, in the S&P 500, as a gain', () => {
    const s = twinSeries(HISTORY, indexLevels(INDEX), '2026-01-01');
    const deposits = HISTORY.filter((row) => row.date > s[0].date).reduce((t, row) => t + row.externalCashFlow, 0);
    near(year.whole.twin, s[s.length - 1].twin - s[0].twin - deposits);
    assert.equal(year.whole.series[0].you, 0);
    assert.equal(year.whole.series[0].twin, 0);
  });

  test('the positions stay in the table below', () => {
    assert.equal(year.rows.length, 3);
  });
});

describe('what stands out', () => {
  test('"when the market falls" is never repeated at the top; it stays in Your habits', () => {
    // The 1.5× account falls harder than the market: a solid finding, and the largest in money.
    const r = analyse({ positions: [], history: HISTORY, index: INDEX, today: TODAY });
    assert.equal(r.cards.find((c) => c.id === 'down').tone, 'bad');
    assert.ok(!r.standOut.some((s) => s.id === 'down'));
  });
});
