/**
 * When the New York exchanges are shut, and when they close early.
 *
 * Weekends were modelled from the start and holidays were not, which left the
 * app claiming "Live prices on" at eleven o'clock on Christmas morning — the
 * precise thing the session pill exists to prevent. Someone watching an
 * unchanging number under a label promising live prices cannot tell a shut
 * market from a broken app, and on the ten days a year this got wrong it was
 * telling them the wrong one.
 *
 * Computed from the rules rather than listed year by year, so it does not
 * expire. A hard-coded table is right until the year it runs out, and the way
 * it fails then is silent: the app simply goes back to calling holidays open,
 * with nothing to say it had ever known better.
 *
 * These are the NYSE and Nasdaq rules. Every date here is a New York calendar
 * date — the caller is responsible for having converted, which is what
 * newYorkClock does.
 */

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** Day of week for a New York calendar date, 0 = Sunday. No timezone involved. */
const dowOf = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

/** The nth given weekday of a month, e.g. the third Monday in January. */
function nthWeekday(y, m, weekday, n) {
  const first = dowOf(y, m, 1);
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

/** The last given weekday of a month — Memorial Day is the only one that needs it. */
function lastWeekday(y, m, weekday) {
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return days - ((dowOf(y, m, days) - weekday + 7) % 7);
}

/**
 * Easter Sunday, by the anonymous Gregorian algorithm.
 *
 * Here only because Good Friday is a market holiday and is the one date on the
 * list that cannot be written as "the nth weekday of a month". It is the reason
 * this file computes rather than tabulates: everything else could have been a
 * short list, and this could not.
 */
function easter(y) {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return { month: Math.floor(n / 31), day: (n % 31) + 1 };
}

/** Shift a New York date by whole days, staying in the calendar. */
function shift(y, m, d, days) {
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * A fixed-date holiday, moved to the weekday it is observed on.
 *
 * Saturday is observed on the Friday before and Sunday on the Monday after,
 * with one exception the exchanges make and which is easy to get wrong: a New
 * Year's Day falling on a Saturday is **not** observed on 31 December. The
 * market is open that Friday, and treating it as shut would freeze the year's
 * last session.
 */
function observed(y, m, d, { rollBack = true } = {}) {
  const dow = dowOf(y, m, d);
  if (dow === 6) return rollBack ? shift(y, m, d, -1) : null;
  if (dow === 0) return shift(y, m, d, 1);
  return iso(y, m, d);
}

/** Every day the New York market is closed in a given year. */
export function holidaysIn(year) {
  const e = easter(year);
  const dates = [
    // New Year's Day never rolls back into the previous year.
    observed(year, 1, 1, { rollBack: false }),
    iso(year, 1, nthWeekday(year, 1, 1, 3)),        // Martin Luther King Jr Day
    iso(year, 2, nthWeekday(year, 2, 1, 3)),        // Washington's Birthday
    shift(year, e.month, e.day, -2),                // Good Friday
    iso(year, 5, lastWeekday(year, 5, 1)),          // Memorial Day
    observed(year, 6, 19),                          // Juneteenth
    observed(year, 7, 4),                           // Independence Day
    iso(year, 9, nthWeekday(year, 9, 1, 1)),        // Labor Day
    iso(year, 11, nthWeekday(year, 11, 4, 4)),      // Thanksgiving
    observed(year, 12, 25),                         // Christmas
  ];
  return new Set(dates.filter(Boolean));
}

/**
 * Days the market closes at one o'clock instead of four.
 *
 * Each is defined as "the day next to the holiday", and each is only an early
 * close when it is a trading day in its own right — 3 July is a half day in a
 * year where the fourth is a Monday, and is the holiday itself in a year where
 * the fourth is a Saturday. Deriving them this way rather than listing them is
 * what keeps those two cases from ever being confused.
 */
export function halfDaysIn(year) {
  const shut = holidaysIn(year);
  const thanksgiving = nthWeekday(year, 11, 4, 4);

  return new Set([
    iso(year, 7, 3),                                // the day before the fourth
    shift(year, 11, thanksgiving, 1),               // the Friday after Thanksgiving
    iso(year, 12, 24),                              // Christmas Eve
  ].filter((date) => {
    if (shut.has(date)) return false;
    const [y, m, d] = date.split('-').map(Number);
    const dow = dowOf(y, m, d);
    return dow !== 0 && dow !== 6;
  }));
}

/**
 * Cached per year, because this is asked on every render and the answer for a
 * year cannot change. Two entries is enough — the only time two years are in
 * play at once is the turn of one.
 */
const cache = new Map();
function calendarFor(year) {
  let entry = cache.get(year);
  if (!entry) {
    entry = { holidays: holidaysIn(year), halfDays: halfDaysIn(year) };
    if (cache.size > 3) cache.clear();
    cache.set(year, entry);
  }
  return entry;
}

/** Is this New York date one the market is closed for? Weekends included. */
export function marketHoliday(date) {
  const [y, m, d] = String(date ?? '').split('-').map(Number);
  if (!Number.isFinite(y)) return false;
  const dow = dowOf(y, m, d);
  if (dow === 0 || dow === 6) return true;
  return calendarFor(y).holidays.has(date);
}

/** Does the market close early on this New York date? */
export function marketHalfDay(date) {
  const [y] = String(date ?? '').split('-').map(Number);
  if (!Number.isFinite(y)) return false;
  return calendarFor(y).halfDays.has(date);
}

/**
 * The two boundaries of a New York trading date, in minutes past midnight.
 *
 * `close` is when the regular session ends. `settled` is when everything
 * finishes trading, after-hours included, and is the point past which the day's
 * figures should be held rather than refreshed. A one o'clock close takes the
 * after-hours session down with it: it runs to five, not to eight.
 */
export const REGULAR_OPEN = 9 * 60 + 30;
export const PRE_MARKET_OPEN = 4 * 60;

export function sessionBounds(date) {
  return marketHalfDay(date)
    ? { close: 13 * 60, settled: 17 * 60 }
    : { close: 16 * 60, settled: 20 * 60 };
}
