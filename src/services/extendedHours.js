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
    if (quote.previousClose > 0) {
      p.dailyChg = ((quote.price - quote.previousClose) / quote.previousClose) * 100;
    }
  }
  return changed;
}
