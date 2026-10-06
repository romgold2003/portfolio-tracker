/**
 * Catching a split in a holding the day it happens.
 *
 * Statements carry splits, but only up to their closing date; ETHA's 1-for-3
 * on 6 October 2026 came after the last one, and nothing else told the app.
 * Two sources do now, checked against each holding on every price refresh:
 *
 *   - Yahoo's own split records, from the price history the app already loads.
 *     Certain, but Yahoo can take a day or more to write one down — ETHA's was
 *     still missing at eleven in the morning.
 *   - Until then, the price itself: a quote at a whole multiple of yesterday's
 *     close — ×3, ×½ — is a split, not a move (see impliedSplit).
 *
 * Either way it is applied once, written on the holding, and shown on its card.
 */
import { state } from '../core/store.js';
import { impliedSplit, shareFactor, splitRecorded, applySplit, acrossSplit } from '../core/splits.js';
import { dailySeries, splitsOf, historySymbol } from './history.js';
import { tradingDay } from '../config/marketCalendar.js';

/** A split Yahoo dated longer ago than this is not news, whatever the dates say. */
const RECENT_DAYS = 60;

/**
 * The day this holding's share count was last known to be right.
 *
 * A statement states the count after every split up to its closing date, and a
 * holding entered by hand is right on the day it was entered. A split before
 * that is already in the count and must not be applied again.
 */
function knownSince(p) {
  const statementEnd = (state.statements ?? []).reduce((max, r) => (r?.to > max ? r.to : max), '');
  return [p.open ?? '', statementEnd].reduce((a, b) => (b > a ? b : a), '');
}

const daysBefore = (date, n) => new Date(Date.parse(date) - n * 86400000).toISOString().slice(0, 10);

/**
 * Check every open stock for a split, applying any it finds. Returns true if
 * one was. Crypto has no splits; a holding without history is left alone.
 */
export async function catchSplits(open, now = new Date()) {
  const today = tradingDay(now);
  let found = false;

  await Promise.all(open.map(async (p) => {
    if (p.cls === 'Crypto' || !(p.cur > 0)) return;
    const symbol = historySymbol(p.ticker, p.cls);
    const rows = await dailySeries(symbol).catch(() => null);
    if (!rows?.length) return;

    const since = knownSince(p);
    const recent = daysBefore(today, RECENT_DAYS);
    for (const s of splitsOf(symbol)) {
      if (s.date <= since || s.date < recent || splitRecorded(p, s.date)) continue;
      applySplit(p, shareFactor(s), s.date, 'yahoo');
      found = true;
    }

    // Not written down yet: yesterday's close is still the old price.
    const last = rows[rows.length - 1];
    if (last?.date < today && last.date >= since && !splitRecorded(p, today)) {
      const k = impliedSplit(last.close, p.cur);
      if (k) { applySplit(p, k, today, 'price'); found = true; }
    }

    // The feed re-reads its previous close on every refresh, and the one it
    // reads can still be the old price; a week's start nearly always is.
    for (const s of p.splits ?? []) {
      if (s.d !== today) continue;
      if (p.prevClose > 0 && impliedSplit(p.prevClose, p.cur) === s.k) p.prevClose /= s.k;
      p.dailyChg = acrossSplit(p.dailyChg, s.k);
    }
    for (const s of p.splits ?? []) {
      if (daysBefore(today, 7) <= s.d) p.weeklyChg = acrossSplit(p.weeklyChg, s.k);
    }
  }));

  return found;
}
