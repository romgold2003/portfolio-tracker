/**
 * Share splits that happen while a holding is open.
 *
 * A split changes the share count and the price together and the value not at
 * all. The quote feed only sees the price: on 6 October 2026 ETHA went through
 * a 1-for-3 reverse split, its price went from $20.43 to $61.59, and the app
 * went on holding the 66 shares of the last statement instead of IBKR's 22 —
 * a $2,717 gain that never happened, overnight, on a $47,848 account.
 *
 * A share factor `k` is the shares after over the shares before: 10 for a
 * 10-for-1, 1/3 for a 1-for-3. Prices divide by it.
 */

/**
 * How far off a whole ratio a price may be and still read as a split.
 *
 * The two prices are a close and a later quote, so the stock also moved in
 * between: ETHA came out at 3.015 against yesterday's close. A real move of
 * exactly ×2 or ×3, to within this, is far rarer than a split.
 */
const TOLERANCE = 0.025;

/** A split counts once: one found within this many days of a recorded one is that one. */
export const SAME_SPLIT_DAYS = 5;

/**
 * The share factor a price jump implies, or null when it is a move.
 *
 * `before` is the last close, `after` the price now. ×3 in price is k = 1/3.
 */
export function impliedSplit(before, after) {
  if (!(before > 0 && after > 0)) return null;
  const k = before / after;
  const n = k >= 1 ? k : 1 / k;
  const whole = Math.round(n);
  if (whole < 2 || Math.abs(n / whole - 1) > TOLERANCE) return null;
  return k >= 1 ? whole : 1 / whole;
}

/** The shares-after over shares-before of a split written as Yahoo writes it. */
export const shareFactor = (split) => split.numerator / split.denominator;

const daysApart = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

/** Whether this holding already has a split recorded near `date`. */
export function splitRecorded(p, date) {
  return (p.splits ?? []).some((s) => daysApart(s.d, date) <= SAME_SPLIT_DAYS);
}

/**
 * Restate a holding in the shares that exist after a split.
 *
 * The cost and the money from earlier sales do not change; the counts and the
 * prices they are expressed in do — the way IBKR restates them. Earlier sales
 * are rescaled too, or "% closed" would read the 44 shares that vanished in a
 * reverse split as 67% sold.
 */
export function applySplit(p, k, date, source) {
  p.qty *= k;
  p.entry /= k;
  if (p.origQty != null) p.origQty *= k;
  if (p.prevClose > 0) p.prevClose /= k;
  for (const e of p.exits ?? []) { e.qty *= k; e.price /= k; if (e.prevClose > 0) e.prevClose /= k; }
  for (const a of p.adds ?? []) { a.qty *= k; a.price /= k; }
  (p.splits ??= []).push({ d: date, k, source });
}

/**
 * A percentage measured across a split, measured as though it had not been.
 *
 * The feed's previous close, and the close a week's change starts from, can
 * still be the old price: ETHA's day read +201%. Only a change that spans the
 * whole split is corrected, so one already measured in new shares is left alone.
 */
export function acrossSplit(changePct, k) {
  if (!Number.isFinite(changePct)) return changePct;
  const ratio = 1 + changePct / 100;
  if (impliedSplit(1, ratio) !== k) return changePct;
  return (ratio * k - 1) * 100;
}
