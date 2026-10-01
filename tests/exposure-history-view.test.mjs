/**
 * The DEX & GEX history block, laid out after the reference Romy chose.
 *
 * Its own block under the strike profile with a 7D / 30D / 90D switch, delta
 * above gamma, one point a day, four dashed levels from the lowest reading to
 * the highest, day/month dates along the bottom, and a readout giving the date
 * and the value to the hundredth of a million. The day-by-day averaging is
 * covered in exposure-rollup.test.mjs; this is everything drawn around it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  FRAMES, axisMoney, tipMoney, yRange, xTickIndices, dayMonth, historyChart,
} from '../src/ui/views/exposureHistory.js';

describe('the switch', () => {
  test('offers 7D, 30D and 90D — the windows in the reference, and only those', () => {
    assert.deepEqual(FRAMES.map((f) => [f.label, f.days]), [['7D', 7], ['30D', 30], ['90D', 90]]);
  });

  test('opens on 90D, as the reference does', () => {
    const src = readFileSync(new URL('../src/ui/views/exposureHistory.js', import.meta.url), 'utf8');
    assert.match(src, /let frame = '90d';/);
  });
});

describe('the numbers as written', () => {
  test('axis levels to one decimal, in the unit that fits', () => {
    assert.equal(axisMoney(5.6e9), '$5.6B');
    assert.equal(axisMoney(302.8e6), '$302.8M');
    assert.equal(axisMoney(-9.5e6), '−$9.5M');
    assert.equal(axisMoney(1.25e12), '$1.3T');
    assert.equal(axisMoney(0), '$0');
  });

  test('the readout is signed and to the hundredth, as "+$326.07M"', () => {
    assert.equal(tipMoney(326.07e6), '+$326.07M');
    assert.equal(tipMoney(-129.5e6), '−$129.50M');
    assert.equal(tipMoney(5.612e9), '+$5.61B');
  });

  test('dates along the bottom are day/month', () => {
    assert.equal(dayMonth('2026-09-27'), '27/09');
    assert.equal(dayMonth('2026-08-02'), '02/08');
  });
});

describe('the levels', () => {
  test('four of them, from the lowest reading to the highest', () => {
    const r = yRange([-9.5e6, 5.6e9, 2e9]);
    assert.equal(r.ticks.length, 4);
    assert.equal(r.ticks[0], -9.5e6);
    assert.equal(r.ticks[3], 5.6e9);
  });

  test('not dragged to zero when the series lives far from it', () => {
    // Net delta in the billions moving by a fraction: an axis down to zero
    // would flatten it into a line along the top.
    const r = yRange([2.1e12, 2.2e12]);
    assert.ok(r.lo > 1e12, 'the axis should start near the data');
  });

  test('a flat series still gets a range rather than dividing by nothing', () => {
    const r = yRange([5, 5, 5]);
    assert.ok(r.hi > r.lo);
  });
});

describe('the dates shown', () => {
  test('about eight, and always the last', () => {
    const xs = Array.from({ length: 90 }, (_, i) => i * 10);
    const picked = xTickIndices(xs);
    assert.ok(picked.length >= 7 && picked.length <= 10, String(picked.length));
    assert.equal(picked[picked.length - 1], 89);
  });

  test('a week shows every day', () => {
    assert.deepEqual(xTickIndices([0, 100, 200, 300, 400, 500, 600]), [0, 1, 2, 3, 4, 5, 6]);
  });

  test('two dates never crowd each other at the end', () => {
    const xs = Array.from({ length: 10 }, (_, i) => i * 100);
    xs.push(905);
    const picked = xTickIndices(xs);
    for (let i = 1; i < picked.length; i++) {
      assert.ok(xs[picked[i]] - xs[picked[i - 1]] >= 70, `${picked[i - 1]} and ${picked[i]} collide`);
    }
  });
});

describe('one chart', () => {
  const points = [
    { day: '2026-09-25', t: Date.parse('2026-09-25'), dex: 1e9, gex: 2e8, reads: 3 },
    { day: '2026-09-26', t: Date.parse('2026-09-26'), dex: 2e9, gex: 1e8, reads: 3 },
    { day: '2026-09-28', t: Date.parse('2026-09-28'), dex: 1.5e9, gex: 3e8, reads: 3 },
  ];
  const html = historyChart(points, { key: 'dex', title: 'DEX · Delta exposure ($)', colour: '#5b84e8' });

  test('has its title, a dot for every day, and four dashed levels', () => {
    assert.match(html, /DEX · Delta exposure \(\$\)/);
    assert.equal((html.match(/<circle cx=/g) ?? []).length, points.length);
    assert.equal((html.match(/class="xh-grid"/g) ?? []).length, 4);
  });

  test('places days by date, so a missing day leaves a gap rather than closing up', () => {
    const xs = [...html.matchAll(/<circle cx="([\d.]+)"/g)].map((m) => Number(m[1]));
    const step1 = xs[1] - xs[0]; // one day
    const step2 = xs[2] - xs[1]; // two days: the 27th was never recorded
    assert.ok(Math.abs(step2 - 2 * step1) < 0.5, `${step1} then ${step2}`);
  });

  test('carries a drop line and a ringed point for hovering, hidden until used', () => {
    assert.match(html, /class="xh-hair"[^>]*hidden/);
    assert.match(html, /class="xh-hot"[^>]*fill="#fff"[^>]*hidden/);
  });

  test('and the values behind it, newest first', () => {
    const rows = [...html.matchAll(/<tr><td>([\d-]+)<\/td>/g)].map((m) => m[1]);
    assert.deepEqual(rows, ['2026-09-28', '2026-09-26', '2026-09-25']);
  });
});

describe('where it sits', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const card = html.slice(html.indexOf('id="optionsCard"'), html.indexOf('</div><!-- /newsMarket -->'));

  test('inside the options card, under the strike charts', () => {
    assert.ok(card.indexOf('id="optCharts"') < card.indexOf('id="optHistory"'), 'history should follow the strike profile');
    assert.ok(card.indexOf('id="xhDex"') < card.indexOf('id="xhGex"'), 'delta above gamma, as in the reference');
  });

  test('and the old one-or-the-other switch is gone', () => {
    assert.doesNotMatch(html, /id="optGrain"/);
  });
});
