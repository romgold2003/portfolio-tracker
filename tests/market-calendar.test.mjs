/**
 * The market calendar, checked against the exchanges' own published dates.
 *
 * Three years are spelled out in full rather than spot-checked, because the
 * rules only differ from each other in the years where something lands on a
 * weekend — and those are exactly the years a rule-based calendar gets wrong.
 * 2026, 2027 and 2028 between them cover every case: a Juneteenth on a
 * Saturday, an Independence Day on a Sunday, a Christmas on a Saturday, and a
 * New Year's Day on a Saturday, which is the one the exchanges do *not* move.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  holidaysIn, halfDaysIn, marketHoliday, marketHalfDay, sessionBounds,
} from '../src/config/marketCalendar.js';
import { regularSessionOpen, tradingDayOver } from '../src/services/extendedHours.js';

/** A moment expressed in UTC, which is how the session functions are fed. */
const at = (isoUtc) => new Date(isoUtc);

describe('the published holidays', () => {
  test('2026', () => {
    assert.deepEqual([...holidaysIn(2026)].sort(), [
      '2026-01-01', // New Year's Day, Thursday
      '2026-01-19', // Martin Luther King Jr Day
      '2026-02-16', // Washington's Birthday
      '2026-04-03', // Good Friday
      '2026-05-25', // Memorial Day
      '2026-06-19', // Juneteenth, Friday
      '2026-07-03', // Independence Day falls Saturday, observed Friday
      '2026-09-07', // Labor Day
      '2026-11-26', // Thanksgiving
      '2026-12-25', // Christmas, Friday
    ]);
  });

  test('2027', () => {
    assert.deepEqual([...holidaysIn(2027)].sort(), [
      '2027-01-01',
      '2027-01-18',
      '2027-02-15',
      '2027-03-26', // Good Friday — Easter is 28 March
      '2027-05-31',
      '2027-06-18', // Juneteenth falls Saturday, observed Friday
      '2027-07-05', // Independence Day falls Sunday, observed Monday
      '2027-09-06',
      '2027-11-25',
      '2027-12-24', // Christmas falls Saturday, observed Friday
    ]);
  });

  test('2028, the year New Year is not observed at all', () => {
    const dates = [...holidaysIn(2028)].sort();
    // 1 January 2028 is a Saturday. The exchanges do not close the Friday
    // before, because that Friday is in the previous year and is a full
    // session — closing it would freeze the year's last trading day.
    assert.ok(!dates.includes('2028-01-01'));
    assert.deepEqual(dates, [
      '2028-01-17',
      '2028-02-21',
      '2028-04-14', // Good Friday — Easter is 16 April
      '2028-05-29',
      '2028-06-19',
      '2028-07-04',
      '2028-09-04',
      '2028-11-23',
      '2028-12-25',
    ]);
  });
});

describe('the one o\'clock closes', () => {
  test('are the days beside a holiday, when they are trading days at all', () => {
    assert.deepEqual([...halfDaysIn(2026)].sort(), ['2026-11-27', '2026-12-24']);
    assert.deepEqual([...halfDaysIn(2027)].sort(), ['2027-11-26']);
    assert.deepEqual([...halfDaysIn(2028)].sort(), ['2028-07-03', '2028-11-24']);
  });

  test('3 July is a half day when the fourth is a weekday, and the holiday when it is not', () => {
    // 2028: the fourth is a Tuesday, so the third is an early close.
    assert.ok(marketHalfDay('2028-07-03'));
    assert.ok(!marketHoliday('2028-07-03'));
    // 2026: the fourth is a Saturday, so the third *is* the holiday.
    assert.ok(marketHoliday('2026-07-03'));
    assert.ok(!marketHalfDay('2026-07-03'));
  });

  test('Christmas Eve is not also called a half day when it is the holiday', () => {
    assert.ok(marketHoliday('2027-12-24'));
    assert.ok(!marketHalfDay('2027-12-24'));
  });

  test('an early close takes the after-hours session down with it', () => {
    assert.deepEqual(sessionBounds('2026-11-27'), { close: 13 * 60, settled: 17 * 60 });
    assert.deepEqual(sessionBounds('2026-11-30'), { close: 16 * 60, settled: 20 * 60 });
  });
});

describe('weekends and bad input', () => {
  test('a weekend is shut without consulting the list', () => {
    assert.ok(marketHoliday('2026-09-05')); // Saturday
    assert.ok(marketHoliday('2026-09-06')); // Sunday
    assert.ok(!marketHoliday('2026-09-04')); // Friday
  });

  test('nonsense is not a holiday, rather than throwing', () => {
    for (const bad of [null, undefined, '', 'today', '2026-13-99x']) {
      assert.equal(marketHoliday(bad), false);
      assert.equal(marketHalfDay(bad), false);
    }
  });
});

describe('what the app asks it', () => {
  test('Christmas morning is not a live session', () => {
    // 11:00 in New York on Christmas Day 2026, a Friday.
    assert.equal(regularSessionOpen(at('2026-12-25T16:00:00Z')), false);
    assert.equal(tradingDayOver(at('2026-12-25T16:00:00Z')), true);
  });

  test('nor is Thanksgiving, nor the observed Fourth', () => {
    assert.equal(regularSessionOpen(at('2026-11-26T16:00:00Z')), false);
    assert.equal(regularSessionOpen(at('2026-07-03T15:00:00Z')), false);
  });

  test('the day after a holiday is an ordinary session again', () => {
    // The Friday after Thanksgiving: open, but only until one o'clock.
    assert.equal(regularSessionOpen(at('2026-11-27T16:00:00Z')), true);  // 11:00
    assert.equal(regularSessionOpen(at('2026-11-27T18:30:00Z')), false); // 13:30
    // And its after-hours ends at five, not eight.
    assert.equal(tradingDayOver(at('2026-11-27T21:00:00Z')), false); // 16:00
    assert.equal(tradingDayOver(at('2026-11-27T22:30:00Z')), true);  // 17:30
  });

  test('Friday after-hours runs to eight in New York, three in Tel Aviv', () => {
    assert.equal(regularSessionOpen(at('2026-09-04T19:30:00Z')), true);  // 15:30 Fri
    assert.equal(regularSessionOpen(at('2026-09-04T20:05:00Z')), false); // 16:05 Fri
    // Still counting: the after-hours session has not finished.
    assert.equal(tradingDayOver(at('2026-09-04T23:59:00Z')), false); // 19:59 Fri
    assert.equal(tradingDayOver(at('2026-09-05T00:01:00Z')), true);  // 20:01 Fri
  });

  test('the weekend holds the figures rather than resetting them', () => {
    assert.equal(tradingDayOver(at('2026-09-05T16:00:00Z')), true);
    assert.equal(tradingDayOver(at('2026-09-06T16:00:00Z')), true);
    // And Monday's pre-market picks it up again at four.
    assert.equal(tradingDayOver(at('2026-09-08T08:30:00Z')), false); // 04:30 Tue
  });

  test('the New York date decides, not the viewer\'s', () => {
    // 02:00 in Tel Aviv on 26 December is still 19:00 on Christmas Day in New
    // York. Reading the local date here would have called it a normal session.
    assert.equal(tradingDayOver(at('2026-12-26T00:00:00Z')), true);
  });
});
