/**
 * Insights, the personal analyst (November 2026): what a person's trades and
 * account say about them, only as far as the evidence goes, in plain words,
 * with every formula checked here against numbers worked out by hand.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const {
  analyse, tradesOf, chanceOf, chanceVsZero, confidence, whyOf, twinSeries, indexLevels, levelOn,
  twinDaily, tradeLife, twinOfLife, accountDays, pairDays, traderTitle, traderBadges, moodOf, MIN_TRADES,
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
    const w = r.cards.find((c) => c.id === 'weekday');
    assert.equal(w.confidence.level, 'early');
    assert.equal(w.headline, undefined, 'no conclusion is drawn');
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

  test('last week, the months and the biggest drop', () => {
    assert.match(card('week').data, /^You [+−]\d\.\d\d%, S&P 500 [+−]\d\.\d\d%\./);
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
    assert.equal(e.headline, 'Your calm, confident trades do clearly better');
    assert.equal(e.confidence.level, 'strong');
    assert.equal(e.data, 'Emotional (rated 1–4): −9.0% per trade. Confident (7–10): +12.0% per trade. Based on 20 rated trades.');
    assert.match(e.more, /^10 emotional trades, −\$900 in total; 10 confident trades, \+\$1,200\.$/);
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
  test('a day trader who wins most is the Day Sniper; most of them on Fridays earns the badge', () => {
    const fridays = weekdays('2026-03-02', '2026-06-30').filter((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 5);
    const trades = tradesOf(fridays.slice(0, 12).map((d, i) => trade(i % 3 ? 104 : 98, d, d)));
    assert.equal(traderTitle(trades).name, 'The Day Sniper');
    assert.ok(traderBadges(trades).some((b) => b.name === 'Friday Gambler'));
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
