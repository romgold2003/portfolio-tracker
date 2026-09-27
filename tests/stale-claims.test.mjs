/**
 * Figures that carry a claim they cannot support.
 *
 * One bug was reported — an economic release showing a result three days before
 * it was due — and the shape of it turned out to be a class rather than a case.
 * Every instance is the same thing: a number that is correct in itself, placed
 * under a label that says something untrue about it. Nothing throws, nothing
 * looks broken, and the reader is simply misled.
 *
 *   the right number for the wrong event     GDP's second estimate printed as
 *                                            the final estimate's result
 *   a heading describing a different week    "21 Sep – 27 Sep" over rows dated
 *                                            the 30th
 *   a figure with no date at all             ETF flows two days old, labelled
 *                                            "latest"
 *   a word that overstates freshness         "live" beside Friday's close, all
 *                                            weekend
 *
 * These are the scenarios a reader can actually land in, so each one is pinned
 * here by the case that produced it.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { actualFor } from '../api/_lib/fred.js';

describe('a release that has not happened has no result', () => {
  /** Real GDP: one observation per quarter, revised in place by each estimate. */
  const quarterly = [{ date: '2026-01-01', value: 1.4 }, { date: '2026-04-01', value: 1.5 }];
  const gdp = (date) => ({ id: 'gdp:final', date, forecast: '1.5%', previous: '1.5%' });
  const on = (iso) => new Date(`${iso}T12:00:00Z`);

  test('the reported case: final GDP, due in three days, already showed 1.5%', () => {
    const hit = actualFor(quarterly, gdp('2026-09-30'), 'percent', 'quarter', { now: on('2026-09-27'), shared: true });
    assert.equal(hit, null, 'the second estimate\'s figure was being printed as the final\'s');
  });

  test('and is still withheld on the day itself, because the estimates share one observation', () => {
    const hit = actualFor(quarterly, gdp('2026-09-30'), 'percent', 'quarter', { now: on('2026-09-30'), shared: true });
    assert.equal(hit, null, 'nothing in the value says which of the three estimates produced it');
  });

  test('but appears once the release is properly past', () => {
    const hit = actualFor(quarterly, gdp('2026-09-30'), 'percent', 'quarter', { now: on('2026-10-01'), shared: true });
    assert.equal(hit.actual, '1.5%');
  });

  /**
   * A series with one release per observation is safe on the day itself: if it
   * has not published, there is simply no newer observation to be found.
   */
  const monthly = [{ date: '2026-07-01', value: 4.1 }, { date: '2026-08-01', value: 4.3 }];
  const rate = (date) => ({ id: 'unemployment', date, forecast: '4.1%', previous: '4.1%' });

  test('an ordinary monthly release still shows on its own release day', () => {
    const hit = actualFor(monthly, rate('2026-09-27'), 'percent', 'month', { now: on('2026-09-27') });
    assert.equal(hit.actual, '4.3%');
  });

  test('and one still in the future does not', () => {
    assert.equal(actualFor(monthly, rate('2026-10-02'), 'percent', 'month', { now: on('2026-09-27') }), null);
  });

  test('the older guards still hold: a figure on the wrong scale is refused', () => {
    // The calendar says the previous reading was 4.1%; this series says 240.
    const wrong = [{ date: '2026-07-01', value: 240 }, { date: '2026-08-01', value: 242 }];
    assert.equal(actualFor(wrong, rate('2026-09-05'), 'percent', 'month', { now: on('2026-09-27') }), null);
  });

  test('and one too old to belong to this release is refused', () => {
    const stale = [{ date: '2026-01-01', value: 4.1 }, { date: '2026-02-01', value: 4.3 }];
    assert.equal(actualFor(stale, rate('2026-09-05'), 'percent', 'month', { now: on('2026-09-27') }), null);
  });
});

describe('a figure says which day it is for', () => {
  /** The same helper the ETF card uses, kept in step with it. */
  const flowDay = (date, today) => {
    if (!date) return 'latest';
    if (date === today) return 'today';
    const days = Math.round((Date.parse(today) - Date.parse(date)) / 86400000);
    if (days === 1) return 'yesterday';
    const [, m, d] = date.split('-').map(Number);
    const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
    return days > 1 ? `${d} ${month}` : date;
  };

  test('the reported shape: funds report late, so the newest flow is days old', () => {
    // Measured live while this was written: newest 25 Sep, today 27 Sep.
    assert.equal(flowDay('2026-09-25', '2026-09-27'), '25 Sep');
  });

  test('today and yesterday are said in words, because that is how they are read', () => {
    assert.equal(flowDay('2026-09-27', '2026-09-27'), 'today');
    assert.equal(flowDay('2026-09-26', '2026-09-27'), 'yesterday');
  });

  test('and a missing date falls back rather than inventing one', () => {
    assert.equal(flowDay(null, '2026-09-27'), 'latest');
  });
});
