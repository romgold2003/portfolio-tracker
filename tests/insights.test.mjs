/**
 * Insights, the personal analyst (November 2026): what a person's trades and
 * account say about them, only as far as the evidence goes, and the "why"
 * measured from each trade's context rather than guessed.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const {
  analyse, tradesOf, chanceOf, chanceVsZero, confidence, whyOf, twinSeries, indexLevels, levelOn, dailyTwin,
  traderTitle, traderBadges, moodOf, MIN_TRADES,
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
 * A market and an account from December 2025: the S&P moves a little every day and
 * falls 1.5% every tenth day; the account moves 1.5× as much, so it falls
 * harder and swings more. $10,000 to start, $5,000 paid in on 1 June.
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

describe('enough evidence, and better than chance', () => {
  test('trade patterns wait for ten closed trades, and say how many more', () => {
    const r = analyse({ positions: [trade(110, '2026-01-05', '2026-01-09')], today: TODAY });
    assert.equal(r.needed, MIN_TRADES - 1);
    assert.equal(r.profile.title, null);
    assert.ok(!r.cards.some((c) => c.id === 'weekday'));
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
    assert.match(why.text, /^5 of 6 came after the S&P had risen 1\.5%\+ in the five days before, against 0% of your other trades\.$/);
  });

  test('and says nothing when nothing stands out', () => {
    const same = Array.from({ length: 8 }, () => ({ spx5: 0.1, days: 5 }));
    assert.equal(whyOf(same, same), null);
  });
});

describe('you against the market', () => {
  const r = analyse({ positions: [], history: HISTORY, index: INDEX, today: TODAY });
  const card = (cardId) => r.cards.find((c) => c.id === cardId);

  test('the whole-account twin gets every deposit on the same day', () => {
    const ix = indexLevels(INDEX);
    const s = twinSeries(HISTORY, ix);
    assert.equal(s[0].twin, s[0].you, 'both start from the same value');
    // A deposit with no market move changes both by the same amount.
    const june = s.findIndex((p) => p.date === '2026-06-01');
    const twinBefore = s[june - 1].twin * (1 + ix.daily.get('2026-06-01') / 100);
    assert.ok(Math.abs(s[june].twin - (twinBefore + 5000)) < 1e-6);
    assert.equal(card('twin'), undefined, 'no trades, no trade twin');
  });

  test('when the S&P falls 1%+, the account falls 150% as much', () => {
    const d = card('down');
    assert.match(d.title, /^When the S&P falls 1% or more, your account falls 2\.\d\d% on average$/);
    assert.match(d.why, /^That is 150% of the market's fall/);
    assert.equal(d.tone, 'bad');
  });

  test('it swings 1.5× as much as the market', () => {
    assert.match(card('swings').title, /^Your account swings 1\.5× as much as the S&P/);
  });

  test('last week and the streak, the months, and the deepest drop', () => {
    assert.match(card('week').title, /^Last week your account [+−]\d\.\d\d%, the S&P [+−]\d\.\d\d%: (ahead|behind) by/);
    assert.match(card('months').title, /^You beat the S&P in \d+ of the last \d+ months$/);
    assert.ok(card('months').table.length >= 2);
    assert.match(card('drawdown').title, /^Your deepest drop: −\d+\.\d%/);
    assert.match(card('drawdown').why, /your book fell further than the market/);
  });

  test('the year beside the S&P\'s, for the headline', () => {
    assert.ok(r.year.you > r.year.spx, 'a 1.5× book in a rising year is ahead');
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

  test('emotional against confident, Strong, with what it cost', () => {
    const e = card('emotion');
    assert.match(e.title, /emotional return −9\.0% on average; confident ones \+12\.0%/);
    assert.equal(e.confidence.level, 'strong');
    assert.match(e.matters, /10 emotional trades \(rated 1–4\), −\$900 in total/);
  });

  test('holding losers longer than winners, and what the long ones lost', () => {
    const h = card('holding');
    assert.match(h.title, /You keep losing trades 7\.0× longer than winning ones \(21 days against 3\)/);
    assert.match(h.matters, /10 losing trades stayed open .* lost \$900/);
  });

  test('each trade against the S&P over the same days', () => {
    const p = card('picks');
    assert.match(p.title, /over the same days by \d+\.\d points; \d+ of 20 beat it/);
  });

  test('the S&P twin: each trade\'s money in the S&P from the day bought to the day sold', () => {
    const ix = indexLevels(INDEX);
    const t = card('twin').twin.year;
    assert.equal(t.decided, 20);
    assert.equal(t.you, 10 * 120 - 10 * 90, 'what the trades made');
    // The twin of each trade: its $1,000 in the S&P over exactly its own days.
    const expected = book.reduce((s, p) => s + 1000 * (levelOn(ix, p.close) / levelOn(ix, p.open) - 1), 0);
    assert.ok(Math.abs(t.twin - expected) < 1e-6);
    assert.ok(Math.abs(t.diff - (t.you - t.twin)) < 1e-9);
    // The curve adds each trade up on the day it closed and ends on both totals.
    const last = t.series[t.series.length - 1];
    assert.equal(t.series[0].you, 0);
    assert.ok(Math.abs(last.you - t.you) < 1e-9 && Math.abs(last.twin - t.twin) < 1e-9);
    assert.ok(t.account && t.account.diffPct > 0, 'the whole-account line rides along');
    assert.match(card('twin').title, /^If every trade had gone into the S&P 500 instead, same money, same days, you'd have made [+−]\$[\d,]+\. You made \+\$300\.$/);
  });

  test('the strengths and weaknesses come from solid findings only', () => {
    const all = [...r.briefing.strengths, ...r.briefing.weaknesses].map((x) => x.id);
    for (const cid of all) {
      const c = card(cid);
      assert.ok(!c.confidence || ['strong', 'likely'].includes(c.confidence.level), `${cid} is solid`);
    }
    assert.ok(r.briefing.weaknesses.some((x) => x.id === 'holding'));
  });

  test('after you sold: the month that followed, from the stock\'s own closes', () => {
    const closes = DAYS.map((date, i) => ({ date, close: 100 + i }));
    const sold = Array.from({ length: 10 }, (_, i) => trade(110, DAYS[10 + i * 5], DAYS[12 + i * 5], { ticker: 'UP' }));
    const a = analyse({ positions: sold, history: HISTORY, index: INDEX, series: new Map([['UP', closes]]), today: TODAY });
    const c = a.cards.find((x) => x.id === 'after');
    assert.match(c.title, /^In the month after you sold, your stocks went up \d+\.\d% on average$/);
    assert.match(c.matters, /left on the table/);
  });
});

describe('the trader card', () => {
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

  test('the mood of the market from its Fear & Greed reading', () => {
    assert.equal(moodOf(12), 'Extreme fear');
    assert.equal(moodOf(50), 'Neutral');
    assert.equal(moodOf(80), 'Extreme greed');
  });
});

describe('the twin, day by day', () => {
  test('a held trade counts its open profit from the stock\'s closes, and its twin the S&P\'s, until it closes', () => {
    const ix = indexLevels(INDEX);
    const prices = new Map([['AAA', DAYS.map((date, i) => ({ date, close: 100 + i }))]]);
    const open = DAYS[100];
    const mid = DAYS[110];
    const close = DAYS[120];
    // 5 bought at $200 ($1,000), sold at $230 (+$150) on a day the stock closed at 220.
    const rows = [{ ticker: 'AAA', dir: 'Long', cost: 1000, qty: 5, price: 230, open, close, you: 150, spx: 40, live: false }];
    const s = dailyTwin(rows, ix, prices, null, TODAY);
    const at = (d) => s.find((p) => p.date === d);
    assert.equal(at(DAYS[99]).you, 0, 'nothing before it was bought');
    assert.ok(Math.abs(at(mid).you - (5 * 210 * (230 / 220) - 1000)) < 1e-9, 'marked at the stock\'s close, in the trade\'s own prices');
    assert.ok(Math.abs(at(mid).twin - 1000 * (levelOn(ix, mid) / levelOn(ix, open) - 1)) < 1e-9);
    assert.deepEqual([at(close).you, at(close).twin], [150, 40], 'its final figures from the day it closed');
    assert.equal(s[s.length - 1].date, TODAY);
  });
});
