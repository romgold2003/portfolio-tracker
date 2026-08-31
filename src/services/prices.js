/**
 * Live quotes.
 *
 * Crypto comes from CoinGecko and needs no key. Stocks, ETFs and commodity
 * proxies come from Finnhub and need the user's own free key, which is stored
 * on-device and sent nowhere but Finnhub.
 *
 * Every failure path returns null rather than throwing: a missing quote must
 * degrade to the last known price, never break a render.
 */
import { CG_IDS, API } from '../config/constants.js';
import { state, currentApiKey } from '../core/store.js';
import { logPrice, seedPrevClose, get7DChg } from './priceLog.js';
import { extendedQuotes, applyExtendedQuotes, tradingDayOver } from './extendedHours.js';

/** CoinGecko's full symbol list, fetched at most once per session. */
let coinList = null;

async function getCgId(ticker) {
  const symbol = ticker.toUpperCase();
  if (CG_IDS[symbol]) return CG_IDS[symbol];
  try {
    if (!coinList) {
      const res = await fetch(API.coingeckoList);
      if (!res.ok) return null;
      coinList = await res.json();
    }
    const match = coinList.find((c) => c.symbol.toUpperCase() === symbol);
    return match ? match.id : null;
  } catch {
    return null;
  }
}

/**
 * Fetch the current price for a ticker.
 *
 * When `position` is supplied it is also annotated in place with `dailyChg` and
 * `weeklyChg`, and the quote is added to the rolling price log.
 */
export async function fetchPrice(rawTicker, cls, position) {
  const ticker = rawTicker.toUpperCase();
  try {
    return cls === 'Crypto'
      ? await fetchCryptoPrice(ticker, position)
      : await fetchStockPrice(ticker, position);
  } catch {
    return null;
  }
}

async function fetchCryptoPrice(ticker, position) {
  const id = await getCgId(ticker);
  if (!id) return null;
  const url = `${API.coingeckoPrice}?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_7d_change=true`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  const price = json[id]?.usd || null;
  if (position && price) {
    position.dailyChg = json[id]?.usd_24h_change ?? null;
    logPrice(ticker, price);
    // CoinGecko returns a real 7-day figure for crypto — prefer it over our log.
    const cg7 = json[id]?.usd_7d_change;
    position.weeklyChg = cg7 != null && Number.isFinite(cg7) ? cg7 : get7DChg(ticker, price);
  }
  return price;
}

async function fetchStockPrice(ticker, position) {
  const key = currentApiKey();
  if (!key) return null;
  const res = await fetch(`${API.finnhubQuote}?symbol=${ticker}&token=${key}`);
  if (!res.ok) return null;
  const json = await res.json();
  const price = json.c && json.c > 0 ? json.c : null;
  if (position && price) {
    const prevClose = json.pc && json.pc > 0 ? json.pc : null;
    if (prevClose) position.dailyChg = ((json.c - prevClose) / prevClose) * 100;
    seedPrevClose(ticker, prevClose);
    logPrice(ticker, price);
    position.weeklyChg = get7DChg(ticker, price);
  }
  return price;
}

/**
 * Re-quote every open position in place. Returns true if any price changed.
 *
 * `now` is a seam for the tests: what this does depends on where in the trading
 * day it is called, and a test that can only run at the real current time can
 * only check one of those.
 */
export async function refreshOpenPositions(now = new Date()) {
  let changed = false;
  const open = state.positions.filter((p) => p.status === 'Open');

  /**
   * Between eight in the evening and four the next morning in New York, a stock
   * that traded after hours keeps the price it finished on.
   *
   * The regular feed reports the four o'clock close, and letting it write over
   * an after-hours price would undo the evening's move — silently, overnight,
   * while nothing is trading. Crypto is exempt: it never stops, so there is no
   * day for it to be after.
   */
  const dayOver = tradingDayOver(now);

  for (const p of open) {
    if (dayOver && p.cls !== 'Crypto' && p.extPhase) continue;
    const price = await fetchPrice(p.ticker, p.cls, p);
    if (price) { p.cur = price; changed = true; }
  }

  // Crypto is deliberately excluded: it trades around the clock, so its price
  // is already current and there is no "extended session" to ask about.
  const tradable = open.filter((p) => p.cls !== 'Crypto').map((p) => p.ticker);
  if (tradable.length) {
    /**
     * Contained, because of how this failed the first time.
     *
     * The two functions above were used here and never imported, so every
     * refresh threw a ReferenceError on this line. The throw escaped
     * refreshOpenPositions into its caller, which had no catch — so the save
     * and the re-render after it never ran, and the quotes fetched a moment
     * earlier were dropped on the floor. A missing badge was the visible half;
     * a price display that had quietly stopped updating was the other.
     *
     * Off-hours pricing is an improvement on the regular close, never a
     * precondition for showing it.
     */
    try {
      const extended = await extendedQuotes(tradable);
      if (applyExtendedQuotes(state.positions, extended, now)) changed = true;
    } catch (err) {
      console.error('Extended-hours quotes failed; keeping regular prices.', err);
    }
  }

  return changed;
}

/** Whether a position's displayed price is coming from a live feed. */
export function priceIsLive(p) {
  if (p.status !== 'Open') return false;
  if (p.cls === 'Crypto') return true;
  return !!state.apiKey;
}
