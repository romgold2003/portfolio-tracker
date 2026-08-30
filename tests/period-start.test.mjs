/**
 * Where a year-to-date window begins.
 *
 * An account opened partway through a year has no year to report. Until it
 * does, "year to date" has to mean "since you started" — and it has to become a
 * true year to date by itself when the calendar turns, with nothing to switch
 * over and no date hardcoded anywhere.
 *
 * The year is taken from local time, because that is what someone means by
 * "the first of January" — so the clocks below are built locally too, or the
 * test would pass or fail depending on the machine's timezone.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { cutoffFor, periodStart, daysForTimeframe } from '../src/core/snapshots.js';

/** The account in question: first recorded 12 August 2026. */
const INCEPTION = '2026-08-12';
const iso = (d) => d.toISOString().slice(0, 10);

describe('year to date, before a full year exists', () => {
  test('starts at inception while still in the opening year', () => {
    const start = periodStart('YTD', INCEPTION, new Date(2026, 7, 30, 12, 0));
    assert.equal(iso(start), INCEPTION, 'should measure from when the account started');
  });

  test('still starts at inception on new year\'s eve', () => {
    const start = periodStart('YTD', INCEPTION, new Date(2026, 11, 31, 23, 0));
    assert.equal(iso(start), INCEPTION);
  });
});

describe('the turn of the year', () => {
  test('becomes a real year to date on 1 January 2027, by itself', () => {
    const start = periodStart('YTD', INCEPTION, new Date(2027, 0, 1, 0, 30));
    assert.equal(iso(start), '2027-01-01', 'the new year must reset the window');
  });

  test('and stays there through the year', () => {
    for (const [y, m, d] of [[2027, 1, 5], [2027, 6, 30], [2027, 12, 31]]) {
      const start = periodStart('YTD', INCEPTION, new Date(y, m - 1, d, 12, 0));
      assert.equal(iso(start), '2027-01-01', `wrong start on ${y}-${m}-${d}`);
    }
  });

  test('and resets again every year after, with nothing hardcoded', () => {
    for (const year of [2028, 2029, 2035]) {
      const start = periodStart('YTD', INCEPTION, new Date(year, 2, 14, 12, 0));
      assert.equal(iso(start), `${year}-01-01`);
    }
  });
});

describe('the boundary itself', () => {
  test('1 January is inside the window, not before it', () => {
    // Snapshot dates are plain YYYY-MM-DD, which parse as UTC midnight. A
    // boundary built in local time would sit hours after that west of
    // Greenwich and silently drop the first day of the year.
    const start = periodStart('YTD', null, new Date(2027, 5, 1, 12, 0));
    assert.ok(new Date('2027-01-01') >= start, '1 January fell outside its own year');
    assert.ok(new Date('2026-12-31') < start, 'the previous year leaked in');
  });

  test('an account with no history yet falls back to the calendar', () => {
    const start = periodStart('YTD', null, new Date(2027, 4, 5, 12, 0));
    assert.equal(iso(start), '2027-01-01');
  });
});

describe('the other timeframes are unaffected', () => {
  test('still count days back from now', () => {
    const now = new Date(2026, 7, 30, 12, 0);
    for (const [tf, days] of [['1W', 7], ['1M', 30], ['3M', 90], ['1Y', 365]]) {
      const cutoff = cutoffFor(tf, now);
      const back = Math.round((now - cutoff) / 86400000);
      assert.equal(back, days, `${tf} should reach ${days} days back`);
      assert.equal(daysForTimeframe(tf), days);
    }
  });

  test('but are still clipped to when the account started', () => {
    // Asking for a year from an account three weeks old must not reach back
    // past its own first day.
    const start = periodStart('1Y', INCEPTION, new Date('2026-08-30T12:00:00Z'));
    assert.equal(iso(start), INCEPTION);
  });
});
