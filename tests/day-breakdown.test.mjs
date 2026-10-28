/**
 * A day in the daily log, holding by holding, and the day it belongs to.
 *
 * Holding by holding: checked on Romy's real statement to 14 October 2026 —
 * the holdings add up to the day to the cent on 14 Oct (ORCL −8.11%, AMD
 * −5.73%), 21 Sep and 2 Jan.
 *
 * The right day: Yahoo leaves a close blank for hours after the bell, and a
 * series fetched in that window was cached for a day. 14 October was then
 * priced at the 13th's closes for half the book and its −3.5% landed on the
 * 15th, which was up +0.82%.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { dayBreakdown } from '../src/core/dayBreakdown.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const closes = {
  AAA: { '2026-10-13': 100, '2026-10-14': 110 },
  BBB: { '2026-10-13': 50, '2026-10-14': 45 },
  ETHA: { '2026-10-05': 20.43, '2026-10-06': 61.59 },
};
const priceOn = (t, day) => closes[t]?.[day] ?? null;
const opening = { date: '2026-10-01', cash: 1000, holdings: { AAA: 10, BBB: 20 } };

describe('one day, holding by holding', () => {
  test('best first, each with its percentage and dollars, adding up to the day', () => {
    const { holdings, rest } = dayBreakdown({
      walks: [{ opening, events: [] }], priceOn, prev: '2026-10-13', day: '2026-10-14', dayPnl: 0,
    });
    assert.deepEqual(holdings.map((h) => [h.ticker, Math.round(h.pct), h.pnl]), [['AAA', 10, 100], ['BBB', -10, -100]]);
    assert.equal(rest, 0);
  });

  test('shares bought that day count from the price paid, and the money is part of the base', () => {
    const events = [{ date: '2026-10-14', ticker: 'AAA', qty: 10, price: 105, cash: -1050, kind: 'trade' }];
    const [aaa] = dayBreakdown({ walks: [{ opening, events }], priceOn, prev: '2026-10-13', day: '2026-10-14' }).holdings;
    // 10 held from 100 to 110 (+100) and 10 bought at 105 (+50).
    assert.equal(aaa.pnl, 150);
    assert.ok(Math.abs(aaa.pct - (150 / 2050) * 100) < 1e-9);
  });

  test('a holding sold out that day is still there, with what the sale made', () => {
    const events = [{ date: '2026-10-14', ticker: 'BBB', qty: -20, price: 48, cash: 960, kind: 'trade' }];
    const bbb = dayBreakdown({ walks: [{ opening, events }], priceOn, prev: '2026-10-13', day: '2026-10-14' })
      .holdings.find((h) => h.ticker === 'BBB');
    assert.equal(bbb.pnl, -40);
    assert.equal(bbb.pct, -4);
  });

  describe("the stock's own move beside the position's (October 2026: two accounts, one stock, two percentages)", () => {
    test('held all day: the two are the same', () => {
      const [aaa] = dayBreakdown({ walks: [{ opening, events: [] }], priceOn, prev: '2026-10-13', day: '2026-10-14' }).holdings;
      assert.ok(Math.abs(aaa.move - 10) < 1e-9);
      assert.ok(Math.abs(aaa.pct - aaa.move) < 1e-9);
      assert.equal(aaa.traded, false);
    });

    test('sold in the day: the position made +2%, the stock +5%, and it says the trade is why', async () => {
      const closes5 = { XYZ: { '2026-10-13': 100, '2026-10-14': 105 } };
      const walk = { opening: { date: '2026-10-01', cash: 0, holdings: { XYZ: 10 } },
        events: [{ date: '2026-10-14', ticker: 'XYZ', qty: -10, price: 102, cash: 1020, kind: 'trade' }] };
      const [xyz] = dayBreakdown({ walks: [walk], priceOn: (t, d) => closes5[t]?.[d] ?? null, prev: '2026-10-13', day: '2026-10-14' }).holdings;
      assert.ok(Math.abs(xyz.pct - 2) < 1e-9);
      assert.ok(Math.abs(xyz.move - 5) < 1e-9);
      assert.equal(xyz.traded, true);
      globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
      const { dayDetailHtml } = await import('../src/ui/views/dailyLog.js');
      const html = dayDetailHtml({ date: '2026-10-14', prev: '2026-10-13', pct: 2, pnl: 20 }, { holdings: [xyz], rest: 0 });
      // "If a stock goes up 4%, we both should see 4%": the stock's move is the figure, the trade the footnote.
      assert.match(html, /class="dl-pct">\+5\.00%<\/span>/);
      assert.match(html, /class="dl-note">Your position \+2\.00% · you traded it that day/);
    });

    test('short: the stock up 10% reads +10%, the dollars lost in red, and the note says why', async () => {
      const walk = { opening: { date: '2026-10-01', cash: 0, holdings: { AAA: -10 } }, events: [] };
      const [aaa] = dayBreakdown({ walks: [walk], priceOn, prev: '2026-10-13', day: '2026-10-14' }).holdings;
      assert.ok(Math.abs(aaa.pct - -10) < 1e-9);
      assert.ok(Math.abs(aaa.move - 10) < 1e-9);
      assert.equal(aaa.short, true);
      globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
      const { dayDetailHtml } = await import('../src/ui/views/dailyLog.js');
      const html = dayDetailHtml({ date: '2026-10-14', prev: '2026-10-13', pct: -1, pnl: -100 }, { holdings: [aaa], rest: 0 });
      assert.match(html, /class="dl-pct">\+10\.00%<\/span>\s*<span class="dl-usd" style="color:var\(--red\)">/);
      assert.match(html, /Your position −10\.00% · short: you gain when it falls/);
    });

    test('two accounts, one stock, one day: the same figure for both', async () => {
      const { dayDetailHtml } = await import('../src/ui/views/dailyLog.js');
      const mine = dayBreakdown({ walks: [{ opening, events: [] }], priceOn, prev: '2026-10-13', day: '2026-10-14' }).holdings;
      // A friend who bought more AAA that morning at 105.
      const theirs = dayBreakdown({ walks: [{ opening, events: [{ date: '2026-10-14', ticker: 'AAA', qty: 10, price: 105, cash: -1050, kind: 'trade' }] }],
        priceOn, prev: '2026-10-13', day: '2026-10-14' }).holdings;
      const figure = (holdings) => /<span class="dl-tick">AAA<\/span>[\s\S]*?class="dl-pct">([^<]+)</.exec(
        dayDetailHtml({ date: '2026-10-14', prev: '2026-10-13', pct: 0, pnl: 0 }, { holdings, rest: 0 }))[1];
      assert.equal(figure(mine), '+10.00%');
      assert.equal(figure(theirs), '+10.00%');
    });

    test("a split between the closes is undone in the stock's move", () => {
      const walk = { opening: { date: '2026-10-01', cash: 0, holdings: { ETHA: 66 } },
        events: [{ kind: 'split', date: '2026-10-06', ticker: 'ETHA', k: 1 / 3 }] };
      const [etha] = dayBreakdown({ walks: [walk, walk], priceOn, prev: '2026-10-05', day: '2026-10-06' }).holdings;
      assert.ok(Math.abs(etha.move - ((61.59 / 3) / 20.43 - 1) * 100) < 1e-9, `${etha.move}`);
    });
  });

  test('a split that day changes the count, not the result', () => {
    const walk = { opening: { date: '2026-10-01', cash: 0, holdings: { ETHA: 66 } },
      events: [{ kind: 'split', date: '2026-10-06', ticker: 'ETHA', k: 1 / 3 }] };
    const [etha] = dayBreakdown({ walks: [walk], priceOn, prev: '2026-10-05', day: '2026-10-06' }).holdings;
    assert.ok(Math.abs(etha.pnl - (22 * 61.59 - 66 * 20.43)) < 1e-9);
    assert.ok(Math.abs(etha.pct) < 1, `${etha.pct}`);
  });

  test('what the holdings do not explain is left as the remainder', () => {
    const { rest } = dayBreakdown({ walks: [{ opening, events: [] }], priceOn, prev: '2026-10-13', day: '2026-10-14', dayPnl: 12.5 });
    assert.equal(rest, 12.5);
  });
});

describe('the window', () => {
  test('a day opens into its holdings, green and red, with a way back', async () => {
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    const { dayDetailHtml } = await import('../src/ui/views/dailyLog.js');
    const html = dayDetailHtml(
      { date: '2026-10-14', prev: '2026-10-13', pct: -3.51, pnl: -1639.61 },
      { holdings: [{ ticker: 'BRK.B', pct: 1.11, pnl: 40 }, { ticker: 'ORCL', pct: -8.11, pnl: -507 }], rest: 0 },
    );
    assert.match(html, /Wednesday 14 October 2026/);
    assert.match(html, /data-back/);
    assert.ok(html.indexOf('BRK.B') < html.indexOf('ORCL'), 'best first');
    assert.match(html, /dl-hold is-up[\s\S]*?BRK\.B[\s\S]*?\+1\.11%/);
    assert.match(html, /dl-hold is-down[\s\S]*?ORCL[\s\S]*?−8\.11%/);
    assert.match(html, /from the close of Tue 13 Oct · 2 holdings/);
  });

  test('every day in the list can be opened', async () => {
    const { dailyLogHtml } = await import('../src/ui/views/dailyLog.js');
    const html = dailyLogHtml([{ date: '2026-10-14', prev: '2026-10-13', pct: 1, pnl: 10, flow: 0 }], 2026);
    assert.match(html, /data-day="2026-10-14" role="button" tabindex="0"/);
  });
});

describe('a day is shown on the day it happened', () => {
  let realFetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  test('the server caches a closed day for a day only once its close is in it', () => {
    const api = read('api/history.js');
    assert.match(api, /const complete = rows\[rows\.length - 1\]\.date === cutAt;/);
    assert.match(api, /: 'public, s-maxage=300'/);
  });

  test('the app asks again for a series that is missing its last closed day', async () => {
    realFetch = globalThis.fetch;
    const { dailySeries } = await import('../src/services/history.js');
    const { lastClosedSession } = await import('../src/config/marketCalendar.js');
    const through = lastClosedSession();
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      const rows = [{ date: '2020-01-02', close: 1 }, { date: calls === 1 ? '2020-01-03' : through, close: 2 }];
      return { ok: true, status: 200, json: async () => ({ rows, splits: [] }) };
    };
    const realNow = Date.now;
    try {
      await dailySeries('ZZINC');
      await dailySeries('ZZINC');
      assert.equal(calls, 1, 'not again straight away');
      Date.now = () => realNow() + 6 * 60_000;
      const rows = await dailySeries('ZZINC');
      assert.equal(calls, 2, 'again after five minutes');
      assert.equal(rows.at(-1).date, through);
      await dailySeries('ZZINC');
      assert.equal(calls, 2, 'and not again once whole');
    } finally {
      Date.now = realNow;
    }
  });

  test('the log stops at the last day every holding has a close for, and rebuilds at each close', () => {
    assert.match(read('src/ui/views/dailyLog.js'), /through: priced && priced < closed \? priced : closed/);
    assert.match(read('src/ui/views/home.js'), /\(state\.ledger\?\.events \?\? \[\]\)\.length\}\|\$\{through\}`/);
  });
});
