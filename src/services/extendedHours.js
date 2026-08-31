/**
 * Keeping stock prices moving when the market is shut.
 *
 * The regular quote feed reports the regular session, so from the close until
 * the next open every holding sits at its closing price. Pre-market and
 * after-hours trading is real and sometimes large — an earnings print lands at
 * five past four — and an account that cannot see it is stale for sixteen hours
 * of every day.
 *
 * Only stocks and ETFs need this. Crypto never closes, so its prices are
 * already current around the clock and asking for an extended quote would be
 * meaningless.
 *
 * Needs the server, which is the only thing here that can reach a source
 * carrying extended data. The static builds keep the regular close, which is
 * correct for them rather than broken.
 */
import { cloudEnabled } from './cloud.js';

/**
 * How stale an extended print may be before it is ignored.
 *
 * Overnight there is no trading at all, and the last after-hours bar can be
 * many hours old. Showing it as though it were live would be worse than showing
 * the close, so anything older than this is left alone.
 */
const FRESH_FOR_MS = 30 * 60 * 1000;

/** Extended sessions move slowly; this is polled far more often than it changes. */
const CACHE_MS = 45 * 1000;

let cache = { at: 0, bySymbol: new Map() };

/**
 * Test seam. Without it each test inherits the previous one's cached quotes and
 * the one checking what happens when the feed fails never reaches the feed.
 */
export function resetExtendedCache() {
  cache = { at: 0, bySymbol: new Map() };
}

/**
 * Is the US regular session open right now?
 *
 * Weekdays, half past nine to four, New York time — read from the browser's own
 * timezone database rather than by juggling offsets, so it is right on both
 * sides of a daylight-saving change without knowing when those are.
 *
 * Public holidays are not modelled. On Thanksgiving this says open when the
 * market is shut, and the only consequence is a label; nothing is priced off it.
 */
export function regularSessionOpen(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const get = (type) => parts.find((p) => p.type === type)?.value;
  const day = get('weekday');
  if (day === 'Sat' || day === 'Sun') return false;

  // Midnight comes back as 24 from some engines.
  const minutes = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

/**
 * Whether this build can show prices outside the regular session at all.
 *
 * It needs the server, so the static site and the double-clickable file cannot,
 * and on those the honest thing is to say the market is closed rather than to
 * present Friday's close as though it were live.
 */
export function extendedPricingAvailable() {
  return cloudEnabled();
}

/**
 * Latest extended-hours prices for the symbols given.
 *
 * Returns a map of ticker to `{ price, phase, previousClose }` holding only the
 * symbols genuinely trading outside regular hours right now. A symbol whose
 * last print was the regular close is absent, because there is nothing to add.
 */
export async function extendedQuotes(tickers) {
  if (!cloudEnabled()) return new Map();

  const wanted = [...new Set(tickers)].filter(Boolean);
  if (!wanted.length) return new Map();

  if (Date.now() - cache.at < CACHE_MS) return cache.bySymbol;

  let quotes = [];
  try {
    const res = await fetch(`/api/quote?symbols=${encodeURIComponent(wanted.join(','))}`, {
      credentials: 'same-origin',
    });
    if (!res.ok) return cache.bySymbol;
    const json = await res.json();
    quotes = Array.isArray(json?.quotes) ? json.quotes : [];
  } catch {
    // Off-hours pricing is an improvement, not a requirement. A failure here
    // leaves the regular close in place, which is what the app showed before.
    return cache.bySymbol;
  }

  const now = Date.now();
  const bySymbol = new Map();
  for (const q of quotes) {
    if (q.phase !== 'pre' && q.phase !== 'post') continue;
    if (!(q.price > 0)) continue;
    if (now - q.at * 1000 > FRESH_FOR_MS) continue;
    bySymbol.set(q.symbol.toUpperCase(), {
      price: q.price,
      phase: q.phase,
      previousClose: q.previousClose,
      regularClose: q.regularClose,
    });
  }

  cache = { at: now, bySymbol };
  return bySymbol;
}

/**
 * Apply extended prices to the positions they belong to.
 *
 * The daily percentage is recomputed rather than left alone, and that matters:
 * the day's move is reconstructed elsewhere as `cur / (1 + dailyChg/100)` to
 * recover the previous close. Moving the price without moving the percentage
 * would make that reconstruction produce a previous close that never existed,
 * and every daily figure derived from it would be wrong.
 *
 * Returns true when anything changed, so the caller knows whether to redraw.
 */
export function applyExtendedQuotes(positions, bySymbol) {
  if (!bySymbol.size) {
    let cleared = false;
    for (const p of positions) {
      if (p.extPhase) { delete p.extPhase; cleared = true; }
    }
    return cleared;
  }

  let changed = false;
  for (const p of positions) {
    if (p.status !== 'Open') continue;
    const quote = bySymbol.get((p.ticker || '').toUpperCase());
    if (!quote) {
      if (p.extPhase) { delete p.extPhase; changed = true; }
      continue;
    }

    if (p.cur !== quote.price || p.extPhase !== quote.phase) changed = true;
    p.cur = quote.price;
    p.extPhase = quote.phase;

    const base = dayBaseline(quote);
    if (base > 0) p.dailyChg = ((quote.price - base) / base) * 100;
  }
  return changed;
}

/**
 * The price today's move is measured from, which is not the same field in both
 * sessions — and getting this wrong is not a rounding error.
 *
 * The feed gives two closes. `regularClose` is the most recent regular session
 * to have finished or be running; `previousClose` is the one before it. Which
 * of them is "yesterday" depends on where in the day you are standing:
 *
 *   Monday pre-market   regularClose = Friday    previousClose = Thursday
 *   Monday after hours  regularClose = Monday    previousClose = Friday
 *
 * Both times the answer wanted is Friday. So pre-market measures from
 * `regularClose` and after-hours from `previousClose`.
 *
 * Using `previousClose` for both — which this did — measured Monday's
 * pre-market against Thursday, and quietly folded Friday's entire session into
 * "today". On a real quote that turned NVDA up 0.53% into down 4.07%, and every
 * figure derived from it: the position's day change in dollars and percent, the
 * account's move for the day, and the reconstructed previous close underneath
 * them all.
 */
function dayBaseline({ phase, regularClose, previousClose }) {
  const first = phase === 'pre' ? regularClose : previousClose;
  const second = phase === 'pre' ? previousClose : regularClose;
  return first > 0 ? first : second;
}
