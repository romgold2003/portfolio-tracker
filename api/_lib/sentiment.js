/**
 * Fear and greed, for stocks and for crypto.
 *
 * Both numbers come from one page. feargreedmeter.com renders its data into the
 * `__NEXT_DATA__` payload every Next.js page carries, and that payload holds
 * three indices side by side: the stock-market one, the long-running crypto one,
 * and CoinMarketCap's crypto reading. Reading structured JSON the page already
 * serves is steadier than parsing what it drew, and one request answers for
 * both meters rather than two.
 *
 * Their robots.txt allows it, and this asks twice an hour.
 *
 * Everything here returns null rather than a guess when the shape is not what
 * was expected. A sentiment gauge showing the wrong number confidently is worse
 * than no gauge, because there is nothing on screen to say it is wrong.
 */

/**
 * The published bands: Extreme Fear 0-24, Fear 25-44, Neutral 45-55,
 * Greed 56-75, Extreme Greed 76-100. Written as exclusive upper bounds, so
 * 55 is the last Neutral and 75 the last Greed.
 */
const BANDS = [
  { upto: 25, label: 'Extreme Fear' },
  { upto: 45, label: 'Fear' },
  { upto: 56, label: 'Neutral' },
  { upto: 76, label: 'Greed' },
  { upto: 101, label: 'Extreme Greed' },
];

export function bandFor(value) {
  return BANDS.find((b) => value < b.upto)?.label ?? 'Neutral';
}

/** A reading is a whole number from 0 to 100. Anything else is not one. */
function score(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n);
}

/** The __NEXT_DATA__ payload, or null if the page does not carry one. */
export function extractNextData(html) {
  const match = String(html || '')
    .match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Both readings, from the page's own data.
 *
 * The crypto figure is CoinMarketCap's where the page carries it, since that is
 * the one that was asked for; the older index is the fallback for when it does
 * not. They track each other closely but are not the same number.
 */
export function readSentiment(html) {
  const data = extractNextData(html);
  const payload = data?.props?.pageProps?.data;
  if (!payload) return null;

  const stocksNow = score(payload.fgi?.latest?.now);
  const stocksPrev = score(payload.fgi?.latest?.previous_close);

  const cmc = Array.isArray(payload.fgi_crypto_cmc) ? payload.fgi_crypto_cmc[0] : null;
  const legacy = Array.isArray(payload.fgi_crypto) ? payload.fgi_crypto[0] : null;
  const cryptoNow = score(cmc?.value) ?? score(legacy?.value);
  const cryptoPrev = score(cmc?.previous_close);

  const reading = (value, previous) => (value == null ? null : {
    value,
    label: bandFor(value),
    previous: previous ?? null,
  });

  const stocks = reading(stocksNow, stocksPrev);
  const crypto = reading(cryptoNow, cryptoPrev);
  if (!stocks && !crypto) return null;

  return {
    stocks,
    crypto,
    date: typeof payload.fgi?.latest?.date === 'string' ? payload.fgi.latest.date : null,
  };
}
