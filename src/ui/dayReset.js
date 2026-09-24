/**
 * When the day's figures start again from nothing.
 *
 * The American session ends at eight in the evening in New York, which is three
 * in the morning in Israel. From that moment the day is finished, and what the
 * app shows is a new one that has not traded yet — so every daily figure reads
 * zero until the market opens again, rather than carrying yesterday's result
 * forward under a heading that says today.
 *
 * Asked for in those words, twice: at three in the morning it should reset, and
 * at ten it was still showing yesterday's daily return.
 *
 * Crypto is the exception, and not as a special case — it simply never stops.
 * There is no moment at which its day is over, so its figures keep running and
 * a book holding it still shows real movement overnight and at weekends.
 *
 * Deliberately here and not in `core`: the figures themselves are arithmetic
 * over prices and must stay the same answer whenever they are computed. What
 * changes with the clock is whether there is a day to show them for, which is a
 * question about the market, not about the position.
 */
import { tradingDayOver } from '../services/extendedHours.js';

/** True while the holding's own market is still inside a trading day. */
export function dayStillRunning(p, now = new Date()) {
  if (p?.cls === 'Crypto') return true;
  return !tradingDayOver(now);
}

/**
 * The holdings whose day is still running, which is what a daily figure may be
 * built from. Everything else starts the new day at nothing.
 */
export function inPlay(positions, now = new Date()) {
  return (positions ?? []).filter((p) => dayStillRunning(p, now));
}
