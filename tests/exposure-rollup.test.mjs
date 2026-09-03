/**
 * Rolling daily readings up into weeks and months.
 *
 * The two panels share the bucketing and then disagree about what a bucket
 * means, which is the whole point of these tests. ETF flow is money that moved,
 * so a week of it adds up. Exposure is a standing position, so a week of it
 * averages — summing would report a gamma wall five times taller than any that
 * ever stood.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { rollUp, rollUpExposure } from '../src/ui/views/exposure.js';

/** Mon 31 Aug 2026 through Fri 4 Sep — one whole trading week. */
const WEEK = ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'];

const readings = (days, gex) => days.map((day, i) => ({
  day, netGex: gex[i], netDex: -gex[i], spot: 60000 + i * 100,
}));

describe('exposure is a level, so it averages', () => {
  test('a week of readings becomes their mean, not their total', () => {
    const rows = readings(WEEK, [100, 200, 300, 400, 500]);
    const [week] = rollUpExposure(rows, 'weekly');

    assert.equal(week.gex, 300, 'five readings averaging 300 must not sum to 1500');
    assert.equal(week.dex, -300);
    assert.equal(week.days, 5);
  });

  test('the bucket is named for the Monday and spans to the last reading', () => {
    const [week] = rollUpExposure(readings(WEEK, [1, 1, 1, 1, 1]), 'weekly');
    assert.equal(week.from, '2026-08-31');
    assert.equal(week.to, '2026-09-04');
    assert.equal(week.label, '31 Aug');
  });

  test('a Sunday closes the week that began six days earlier', () => {
    // Sunday is day 0 in JavaScript, which is the trap: it belongs to the week
    // behind it, not the one starting the next morning.
    const rows = readings(['2026-09-04', '2026-09-06'], [10, 20]);
    const weeks = rollUpExposure(rows, 'weekly');
    assert.equal(weeks.length, 1, 'Friday and the Sunday after it are one week');
    assert.equal(weeks[0].from, '2026-09-04');
  });

  test('months are grouped and labelled by their own name', () => {
    const rows = readings(['2026-08-30', '2026-08-31', '2026-09-01'], [100, 300, 900]);
    const months = rollUpExposure(rows, 'monthly');

    assert.deepEqual(months.map((m) => m.label), ['Aug 26', 'Sep 26']);
    assert.equal(months[0].gex, 200);
    assert.equal(months[1].gex, 900);
  });

  test('daily leaves each reading alone', () => {
    const rows = readings(WEEK, [1, 2, 3, 4, 5]);
    const days = rollUpExposure(rows, 'daily');

    assert.equal(days.length, 5);
    assert.equal(days[0].days, 1);
    assert.equal(days[0].from, days[0].to, 'a day spans only itself');
    assert.deepEqual(days.map((d) => d.gex), [1, 2, 3, 4, 5]);
  });

  test('buckets come back oldest first whatever order they arrived in', () => {
    const rows = readings(['2026-09-14', '2026-08-31', '2026-09-07'], [1, 2, 3]);
    const weeks = rollUpExposure(rows, 'weekly');
    assert.deepEqual(weeks.map((w) => w.from), ['2026-08-31', '2026-09-07', '2026-09-14']);
  });

  test('a partial week says how few readings are behind it', () => {
    // A week made of one observation is not the same claim as one made of five,
    // and the readout prints this so it cannot be mistaken.
    const [week] = rollUpExposure(readings(['2026-09-02'], [500]), 'weekly');
    assert.equal(week.days, 1);
    assert.equal(week.gex, 500);
  });

  test('nothing recorded rolls up to nothing', () => {
    assert.deepEqual(rollUpExposure([], 'weekly'), []);
  });
});

describe('flow is money moved, so it sums', () => {
  const flows = WEEK.map((date, i) => ({ date, flow: (i + 1) * 10 }));

  test('a week of flows is their total', () => {
    const [week] = rollUp(flows, 'weekly');
    assert.equal(week.value, 150, '10+20+30+40+50');
    assert.equal(week.label, '31 Aug');
  });

  test('inflow and outflow net off inside the bucket', () => {
    const [week] = rollUp([
      { date: '2026-08-31', flow: 300 },
      { date: '2026-09-01', flow: -500 },
    ], 'weekly');
    assert.equal(week.value, -200);
  });

  test('daily is left as it came', () => {
    assert.deepEqual(rollUp(flows, 'daily').map((d) => d.value), [10, 20, 30, 40, 50]);
  });
});
