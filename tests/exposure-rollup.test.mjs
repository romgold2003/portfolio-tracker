/**
 * Rolling readings up into points.
 *
 * The two panels share nothing but the idea. ETF flow arrives as whole days and
 * a week of it adds up, because it is money that moved. Exposure arrives every
 * few minutes and a day of it averages, because it is a standing position —
 * summing a day of five-minute readings would report a gamma wall a hundred
 * times taller than any that ever stood.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { rollUp } from '../src/ui/views/exposure.js';
import { dailyPoints } from '../src/ui/views/exposureHistory.js';

const NOW = Date.parse('2026-09-03T18:00:00Z');
const reading = (at, gex, dex = gex) => ({ at, netGex: gex, netDex: dex });

describe('exposure is a level, so a day averages', () => {
  test('a day of readings becomes their mean, not their total', () => {
    const [day] = dailyPoints([
      reading('2026-09-03T09:00:00Z', 100, 10),
      reading('2026-09-03T12:00:00Z', 200, 20),
      reading('2026-09-03T15:00:00Z', 300, 30),
    ], 7, NOW);
    assert.equal(day.gex, 200);
    assert.equal(day.dex, 20);
    assert.equal(day.reads, 3);
    assert.equal(day.day, '2026-09-03');
  });

  test('readings are cut at UTC midnight', () => {
    const days = dailyPoints([
      reading('2026-09-02T23:59:00Z', 100),
      reading('2026-09-03T00:01:00Z', 300),
    ], 7, NOW);
    assert.deepEqual(days.map((d) => [d.day, d.gex]), [['2026-09-02', 100], ['2026-09-03', 300]]);
  });

  test('points come back oldest first whatever order they arrived in', () => {
    const days = dailyPoints([
      reading('2026-09-03T10:00:00Z', 3),
      reading('2026-09-01T10:00:00Z', 1),
      reading('2026-09-02T10:00:00Z', 2),
    ], 7, NOW);
    assert.deepEqual(days.map((d) => d.gex), [1, 2, 3]);
  });

  test('a day nobody recorded is missing, not drawn at zero', () => {
    const days = dailyPoints([
      reading('2026-09-01T10:00:00Z', 5),
      reading('2026-09-03T10:00:00Z', 7),
    ], 7, NOW);
    assert.deepEqual(days.map((d) => d.day), ['2026-09-01', '2026-09-03']);
  });

  test('a reading with an unreadable stamp or value is dropped, not charted at zero', () => {
    const days = dailyPoints([
      reading('not a date', 999),
      { at: '2026-09-03T10:00:00Z', netGex: 'x', netDex: 1 },
      reading('2026-09-03T11:00:00Z', 4),
    ], 7, NOW);
    assert.equal(days.length, 1);
    assert.equal(days[0].gex, 4);
  });

  test('the window counts today and the days before it, and nothing earlier', () => {
    const rows = [
      reading('2026-08-27T10:00:00Z', 1), // eight days before: outside 7D
      reading('2026-08-28T10:00:00Z', 2), // the first of the seven
      reading('2026-09-03T10:00:00Z', 3), // today
    ];
    assert.deepEqual(dailyPoints(rows, 7, NOW).map((d) => d.gex), [2, 3]);
    assert.deepEqual(dailyPoints(rows, 30, NOW).map((d) => d.gex), [1, 2, 3]);
  });

  test('nothing recorded rolls up to nothing', () => {
    assert.deepEqual(dailyPoints([], 90, NOW), []);
    assert.deepEqual(dailyPoints(null, 90, NOW), []);
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
