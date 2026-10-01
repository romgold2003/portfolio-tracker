/**
 * GEX and DEX as they stand now, in the one format the panel uses throughout.
 *
 * Romy asked for a single format (October 2026). The old view drew both as line
 * charts across strikes in a different style from the history; the numbers
 * behind them were already right — checked against Deribit's published greeks
 * on every BTC contract with open interest, net GEX within 0.01% and net DEX
 * within 1.6% — so only the drawing changed, to the reference's: GEX as bars by
 * strike with its regime and 90-day percentile, DEX with the hedging flow.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  headlineMoney, strikeText, percentileOf, labelStride, gexBars, gexSection, dexSection,
} from '../src/ui/views/exposureNow.js';

const NOW = Date.parse('2026-10-01T12:00:00Z');
const DAY = 86_400_000;
/** One reading a day for `n` days, gamma and delta both equal to the day number. */
const history = (n) => Array.from({ length: n }, (_, i) => ({
  at: new Date(NOW - (n - 1 - i) * DAY).toISOString(), netGex: i + 1, netDex: i + 1,
}));

describe('the figures as written', () => {
  test('headlines are signed, to one decimal', () => {
    assert.equal(headlineMoney(271.04e6), '+$271.0M');
    assert.equal(headlineMoney(5.5078e9), '+$5.5B');
    assert.equal(headlineMoney(-9.5e6), '−$9.5M');
  });

  test('strikes: thousands for a coin, plain for an index', () => {
    assert.equal(strikeText(84000), '84k');
    assert.equal(strikeText(82500), '82.5k');
    assert.equal(strikeText(7600), '7,600');
  });
});

describe('the 90-day percentile', () => {
  test('is the share of recorded days at or below today', () => {
    assert.equal(percentileOf(25, history(100), 'gex', NOW), Math.round((25 - 10) / 90 * 100));
    assert.equal(percentileOf(1e12, history(30), 'gex', NOW), 100);
    assert.equal(percentileOf(-1, history(30), 'gex', NOW), 0);
  });

  test('looks back 90 days and no further', () => {
    // 120 days recorded, valued 1…120: only 31…120 are in the window.
    assert.equal(percentileOf(30, history(120), 'dex', NOW), 0);
  });

  test('is withheld with fewer than ten days recorded', () => {
    assert.equal(percentileOf(5, history(9), 'gex', NOW), null);
    assert.equal(percentileOf(5, null, 'gex', NOW), null);
  });
});

describe('GEX by strike', () => {
  const strikes = [
    { strike: 80000, gex: -3e6 }, { strike: 82000, gex: 1e6 },
    { strike: 84000, gex: 12e6 }, { strike: 86000, gex: 0 },
  ];
  const html = gexBars(strikes);

  test('one bar per strike, blue above zero and red below', () => {
    const bars = [...html.matchAll(/<rect class="xn-bar"[^>]*fill="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(bars.length, strikes.length);
    assert.equal(bars[0], '#e05561', 'negative gamma is red');
    assert.equal(bars[2], '#5b84e8', 'positive gamma is blue');
  });

  test('bars stand on zero: a negative one hangs below a positive one', () => {
    const ys = [...html.matchAll(/<rect class="xn-bar"[^>]*y="([\d.]+)"[^>]*height="([\d.]+)"/g)]
      .map((m) => ({ top: Number(m[1]), bottom: Number(m[1]) + Number(m[2]) }));
    assert.ok(ys[0].top >= ys[2].bottom - 0.5, 'the red bar should start where the blue one ends');
  });

  test('four dashed levels and roughly ten strike labels', () => {
    assert.equal((html.match(/class="xh-grid"/g) ?? []).length, 4);
    assert.equal(labelStride(36), 4);
    assert.equal(labelStride(8), 1);
  });

  test('nothing to draw draws nothing', () => {
    assert.equal(gexBars([]), '');
  });
});

describe('the sections', () => {
  const base = { spot: 84659, maxPain: 84000, strikes: [{ strike: 84000, gex: 1e6 }], band: { pct: 20 } };

  test('positive gamma reads as anchoring, with max pain beside it', () => {
    const html = gexSection({ ...base, netGex: 271e6 }, 26);
    assert.match(html, /\+\$271\.0M/);
    assert.match(html, /P26 · 90D/);
    assert.match(html, />Anchoring</);
    assert.match(html, /dampen price moves/);
    assert.match(html, /Max pain: <strong>84k<\/strong> \(-0\.8% from price\)/);
  });

  test('negative gamma reads as accelerating, in red', () => {
    const html = gexSection({ ...base, netGex: -40e6 }, null);
    assert.match(html, /is-red">Accelerating</);
    assert.match(html, /amplify price moves/);
    assert.doesNotMatch(html, /· 90D/, 'no percentile without enough history');
  });

  test('positive DEX leaves dealers buying to hedge; negative, selling', () => {
    const up = dexSection({ netDex: 5.5e9 }, 35);
    assert.match(up, /\+\$5\.5B/);
    assert.match(up, /P35 · 90D/);
    assert.match(up, /Mechanical buying — spot hedging/);
    assert.match(up, /xn-flow-fill is-buy/);
    const down = dexSection({ netDex: -2e8 }, null);
    assert.match(down, /Mechanical selling — spot hedging/);
    assert.match(down, /xn-flow-fill is-sell/);
  });
});

describe('one format only', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../src/ui/views/exposure.js', import.meta.url), 'utf8');

  test('the old strike line charts, headline and stats are gone', () => {
    for (const gone of ['optCharts', 'optHeadline', 'optStats', 'optTip']) {
      assert.doesNotMatch(html, new RegExp(`id="${gone}"`), gone);
    }
    assert.doesNotMatch(view, /function lineChart|function drawByStrike/);
  });

  test('the panel draws now and history, in that order', () => {
    assert.match(view, /renderExposureNow\(profile\);\s*renderExposureHistory\(profile\);/);
  });
});
