/**
 * Rolling readings up into bars.
 *
 * The two panels share nothing but the idea. ETF flow arrives as whole days and
 * a week of it adds up, because it is money that moved. Exposure arrives every
 * few minutes and a bar of it averages, because it is a standing position —
 * summing a day of five-minute readings would report a gamma wall a hundred
 * times taller than any that ever stood.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { rollUp, rollUpExposure, frameStart } from '../src/ui/views/exposure.js';

const HOUR = 3600e3;

/** Readings every fifteen minutes from a starting moment. */
const every15 = (from, values) => values.map((netGex, i) => ({
  at: new Date(Date.parse(from) + i * 15 * 60e3).toISOString().replace('.000', ''),
  netGex, netDex: -netGex, spot: 60000 + i * 10,
}));

describe('where a bar starts', () => {
  const iso = (t) => new Date(t).toISOString();

  test('hours, four-hours and days divide the clock', () => {
    const t = Date.parse('2026-09-03T14:37:12Z');
    assert.equal(iso(frameStart(t, HOUR)), '2026-09-03T14:00:00.000Z');
    assert.equal(iso(frameStart(t, 4 * HOUR)), '2026-09-03T12:00:00.000Z');
    assert.equal(iso(frameStart(t, 24 * HOUR)), '2026-09-03T00:00:00.000Z');
  });

  test('a week starts on Monday, not on the epoch', () => {
    // 1 January 1970 was a Thursday, so a plain division would open every week
    // on one. Everything from Monday to Sunday must land on the same Monday.
    const week = 7 * 24 * HOUR;
    for (const day of ['2026-08-31T00:00:00Z', '2026-09-03T14:37:12Z', '2026-09-06T23:59:59Z']) {
      assert.equal(iso(frameStart(Date.parse(day), week)), '2026-08-31T00:00:00.000Z');
    }
    // And the Monday after opens the next one.
    assert.equal(iso(frameStart(Date.parse('2026-09-07T00:00:00Z'), week)), '2026-09-07T00:00:00.000Z');
  });
});

describe('exposure is a level, so it averages', () => {
  test('an hour of readings becomes their mean, not their total', () => {
    const rows = every15('2026-09-03T14:00:00Z', [100, 200, 300, 400]);
    const [bar] = rollUpExposure(rows, '1h');

    assert.equal(bar.gex, 250, 'four readings averaging 250 must not sum to 1000');
    assert.equal(bar.dex, -250);
    assert.equal(bar.reads, 4);
  });

  test('readings are cut at the hour, not bundled by count', () => {
    // Six readings spanning 14:00 to 15:15 are two bars, four and two.
    const rows = every15('2026-09-03T14:00:00Z', [1, 1, 1, 1, 9, 9]);
    const bars = rollUpExposure(rows, '1h');

    assert.equal(bars.length, 2);
    assert.deepEqual(bars.map((b) => b.reads), [4, 2]);
    assert.deepEqual(bars.map((b) => b.gex), [1, 9]);
    assert.deepEqual(bars.map((b) => b.label), ['14:00', '15:00']);
  });

  test('a four-hour bar gathers the hours inside it', () => {
    const rows = every15('2026-09-03T12:00:00Z', Array.from({ length: 16 }, () => 100));
    const bars = rollUpExposure(rows, '4h');
    assert.equal(bars.length, 1, '12:00 to 15:45 is one four-hour bar');
    assert.equal(bars[0].label, '12:00');
    assert.equal(bars[0].reads, 16);
  });

  test('daily and weekly bars are labelled by their day', () => {
    const rows = every15('2026-09-03T14:00:00Z', [10, 20]);
    assert.equal(rollUpExposure(rows, '1d')[0].label, '3 Sep');
    assert.equal(rollUpExposure(rows, '1w')[0].label, '31 Aug');
  });

  test('a bar carries when it opened and closed', () => {
    const rows = every15('2026-09-03T14:00:00Z', [1, 2, 3, 4]);
    const [bar] = rollUpExposure(rows, '1h');
    assert.equal(bar.from, '2026-09-03T14:00:00Z');
    assert.equal(bar.to, '2026-09-03T14:45:00Z');
    assert.equal(bar.start, Date.parse('2026-09-03T14:00:00Z'));
  });

  test('bars come back oldest first whatever order they arrived in', () => {
    const rows = [
      { at: '2026-09-03T16:00:00Z', netGex: 3, netDex: 0, spot: 1 },
      { at: '2026-09-03T14:00:00Z', netGex: 1, netDex: 0, spot: 1 },
      { at: '2026-09-03T15:00:00Z', netGex: 2, netDex: 0, spot: 1 },
    ];
    assert.deepEqual(rollUpExposure(rows, '1h').map((b) => b.gex), [1, 2, 3]);
  });

  test('a bar still forming says how few readings are behind it', () => {
    // One reading into an hour is not the same claim as twelve, and the readout
    // prints this so a fresh bar cannot be mistaken for a settled one.
    const [bar] = rollUpExposure(every15('2026-09-03T14:00:00Z', [500]), '1h');
    assert.equal(bar.reads, 1);
    assert.equal(bar.gex, 500);
  });

  test('a reading with an unreadable stamp is dropped, not charted at zero', () => {
    const rows = [
      { at: 'not a time', netGex: 999, netDex: 0, spot: 1 },
      { at: '2026-09-03T14:00:00Z', netGex: 10, netDex: 0, spot: 1 },
    ];
    const bars = rollUpExposure(rows, '1h');
    assert.equal(bars.length, 1);
    assert.equal(bars[0].gex, 10);
  });

  test('nothing recorded rolls up to nothing', () => {
    assert.deepEqual(rollUpExposure([], '1h'), []);
  });
});

describe('flow is money moved, so it sums', () => {
  const WEEK = ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'];
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

  test('months are grouped and labelled by their own name', () => {
    const months = rollUp([
      { date: '2026-08-30', flow: 100 },
      { date: '2026-08-31', flow: 300 },
      { date: '2026-09-01', flow: 900 },
    ], 'monthly');
    assert.deepEqual(months.map((m) => m.label), ['Aug 26', 'Sep 26']);
    assert.deepEqual(months.map((m) => m.value), [400, 900]);
  });

  test('daily is left as it came', () => {
    assert.deepEqual(rollUp(flows, 'daily').map((d) => d.value), [10, 20, 30, 40, 50]);
  });
});
