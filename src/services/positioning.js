/**
 * Who is positioned which way, and what that reads as.
 *
 * ── The thing this is not ────────────────────────────────────────────────
 *
 * Open interest cannot be split into longs and shorts. Every contract has a
 * long and a short, so the two are equal by definition and always will be —
 * "94,623 BTC of open interest" is one number, not two, and no formula
 * decomposes it. Anyone quoting a long/short split *of open interest* is
 * quoting something else and calling it that.
 *
 * ── What can actually be known ───────────────────────────────────────────
 *
 * Three real measurements, each answering a different question:
 *
 *   how open interest MOVED, against how price moved. Contracts are opened and
 *   closed, and which of those happened is readable: price up on rising open
 *   interest is new money going long, while price up on falling open interest
 *   is shorts buying their way out — a squeeze, which is a rally with nobody
 *   left to fuel it.
 *
 *   the funding rate, which is not a survey but a payment. Whichever side is
 *   crowded pays the other to stay in. It is the only one of these that costs
 *   real money to be wrong about, which is what makes it worth the most.
 *
 *   how many ACCOUNTS are long, and how much of the top traders' SIZE is. Not
 *   contracts — people, and then money. These can be lopsided precisely
 *   because they do not count contracts: more than half of accounts can be
 *   long while the shorts are fewer and larger, and the gap between the two
 *   rows is the retail-against-whales reading.
 *
 * ── What this is worth, stated honestly ──────────────────────────────────
 *
 * Less than the volume figures it sits beside, and for a reason that cannot be
 * fixed here: Binance keeps thirty-one days of this data and no more. The
 * volume tiers were calibrated on 16,700 coin-days and cross-validated on a
 * coin set they had never seen. Nothing here could be. A look across those
 * thirty-one days put "price up, open interest up" at +5.57% over three days
 * against +1.22% for a squeeze, which is the textbook answer and is exactly
 * why it should not be trusted — 246 observations falling on 27 dates, in a
 * market where everything moves together, is 27 observations wearing a
 * disguise.
 *
 * So this is read as context, written out in words, and labelled as
 * interpretation. The thresholds come from the literature and were checked
 * against the live board: funding past 0.05% per eight hours is the 98th
 * percentile of 861 perpetuals, which is what "extreme" ought to mean.
 */

const FAPI = 'https://fapi.binance.com';

/**
 * Funding past this, either way, is a crowded trade paying to stay on.
 * The 98th and 2nd percentiles of the live board; the median sits at +0.005%.
 */
export const FUNDING_EXTREME = 0.05;
/** Above this, funding is leaning without being extreme. The 95th percentile. */
export const FUNDING_LEAN = 0.02;
/** A crowd this lopsided is worth naming. */
export const CROWD = 0.6;

/* ── reading it ───────────────────────────────────────────────────────── */

/**
 * What the movement in open interest says, given where price went.
 *
 * The four readings are the standard ones and they are not symmetrical: two of
 * them describe money arriving and two describe money leaving, and a market
 * getting smaller is a weaker statement than one getting larger.
 */
export function openInterestReading(oiChange, priceChange) {
  if (!Number.isFinite(oiChange) || !Number.isFinite(priceChange)) return null;
  const up = priceChange >= 0;
  const growing = oiChange >= 0;
  if (up && growing) {
    return { id: 'new-longs', score: 1, text: 'new longs opening — fresh money behind the move' };
  }
  if (!up && growing) {
    return { id: 'new-shorts', score: -1, text: 'new shorts opening — fresh money betting against it' };
  }
  if (up && !growing) {
    return { id: 'squeeze', score: 0, text: 'shorts buying their way out — a squeeze, with nobody left to fuel it' };
  }
  return { id: 'unwind', score: 0, text: 'longs closing out — selling from exits rather than conviction' };
}

/**
 * What the funding rate says. Contrarian at the extremes, and only there.
 *
 * A crowded side pays the other to stay in, and at 0.05% per eight hours that
 * is fifty-five per cent a year — a cost that forces the position out unless
 * the move keeps paying for it. Below that it is ordinary and says little, so
 * it is reported without being scored.
 */
export function fundingReading(ratePct) {
  if (!Number.isFinite(ratePct)) return null;
  if (ratePct > FUNDING_EXTREME) {
    return { id: 'crowded-long', score: -1, text: `longs crowded and paying ${ratePct.toFixed(3)}% every 8h to stay in` };
  }
  if (ratePct < -FUNDING_EXTREME) {
    return { id: 'crowded-short', score: 1, text: `shorts crowded and paying ${Math.abs(ratePct).toFixed(3)}% every 8h — squeeze fuel` };
  }
  if (ratePct > FUNDING_LEAN) return { id: 'leaning-long', score: 0, text: 'funding leans long, but not enough to hurt' };
  if (ratePct < -FUNDING_LEAN) return { id: 'leaning-short', score: 0, text: 'funding leans short, but not enough to hurt' };
  return { id: 'funding-flat', score: 0, text: 'funding is ordinary — nobody is paying much to hold on' };
}

/**
 * What the crowd is doing, which is read against them.
 *
 * The share of ACCOUNTS long, so it counts people rather than money and is
 * therefore mostly retail. It is taken as a contrarian reading, which is the
 * conventional treatment and is not something this can demonstrate.
 */
export function crowdReading(longAccountShare) {
  if (!Number.isFinite(longAccountShare)) return null;
  const pct = Math.round(longAccountShare * 100);
  if (longAccountShare >= CROWD) {
    return { id: 'crowd-long', score: -1, text: `${pct}% of accounts are long — the crowd is already there` };
  }
  if (longAccountShare <= 1 - CROWD) {
    return { id: 'crowd-short', score: 1, text: `${100 - pct}% of accounts are short — the crowd is already there` };
  }
  return { id: 'crowd-split', score: 0, text: `accounts are ${pct}/${100 - pct} long — no crowd either way` };
}

/**
 * Where the largest positions sit relative to the crowd — the gap, not the level.
 *
 * Reading the level directly was wrong, and wrongly in a way that hid itself:
 * "the crowd is long" scored against and "the largest positions are long"
 * scored for, so on every coin where both were long — which is most of them —
 * the two cancelled exactly and the pair contributed nothing at all.
 *
 * The gap is the part that carries information. Measured over 308 coin-days
 * the two correlate at only 0.217, so they genuinely disagree; but the largest
 * positions sit about seven points more long than the crowd as a matter of
 * course, so the gap has to be read against that and not against zero. Past the
 * upper quartile the big money is leaning further in than usual, and below the
 * lower quartile it is leaning out while the crowd is not.
 *
 * Which way that ought to be read is convention rather than evidence: nothing
 * here demonstrates that following the larger accounts pays.
 */
export const GAP_TYPICAL = 7;
const GAP_WIDE = 12;
const GAP_NARROW = 1;

export function whaleReading(topLongShare, crowdShare) {
  if (!Number.isFinite(topLongShare)) return null;
  const pct = Math.round(topLongShare * 100);
  if (!Number.isFinite(crowdShare)) {
    return { id: 'whales-level', score: 0, text: `the largest positions are ${pct}/${100 - pct} long` };
  }
  const gap = (topLongShare - crowdShare) * 100;
  if (gap >= GAP_WIDE) {
    return {
      id: 'whales-leaning-in',
      score: 1,
      text: `the largest positions are ${Math.round(gap)} points more long than the crowd, against a usual ${GAP_TYPICAL}`,
    };
  }
  if (gap <= GAP_NARROW) {
    return {
      id: 'whales-leaning-out',
      score: -1,
      text: gap >= 0
        ? `the largest positions barely lean longer than the crowd — usually they lean ${GAP_TYPICAL} points further`
        : `the largest positions are ${Math.round(-gap)} points less long than the crowd, which is the wrong way round`,
    };
  }
  return { id: 'whales-usual', score: 0, text: `the largest positions lean long about as far as they normally do` };
}

/**
 * The four readings as one verdict.
 *
 * Summed rather than weighted, because there is no evidence here on which to
 * weight them and a weighting invented to look rigorous is worse than an
 * obvious one. Two agreeing readings make a verdict; anything less is mixed,
 * and mixed is said out loud rather than rounded to the nearest opinion.
 */
export function verdictOf(readings) {
  const parts = readings.filter(Boolean);
  if (!parts.length) return { id: 'unknown', label: 'No futures market', score: 0, parts };
  const score = parts.reduce((sum, r) => sum + r.score, 0);
  const label = score >= 2 ? 'Bullish'
    : score <= -2 ? 'Bearish'
    : score === 1 ? 'Leaning bullish'
    : score === -1 ? 'Leaning bearish'
    : 'Mixed';
  return { id: label.toLowerCase().replace(' ', '-'), label, score, parts };
}

/** Everything known about one coin's positioning, read. */
export function readPositioning({ oiChange, priceChange, funding, longAccounts, topLong }) {
  const readings = [
    openInterestReading(oiChange, priceChange),
    fundingReading(funding),
    crowdReading(longAccounts),
    whaleReading(topLong, longAccounts),
  ];
  return { ...verdictOf(readings), oiChange, funding, longAccounts, topLong };
}

/* ── fetching ─────────────────────────────────────────────────────────── */

let fundingCache = { at: 0, map: null };
const perCoin = new Map();
const TTL = 5 * 60 * 1000;

export function resetPositioning() {
  fundingCache = { at: 0, map: null };
  perCoin.clear();
}

/**
 * Funding for every perpetual at once.
 *
 * The one part of this that batches: nine hundred symbols in a single answer,
 * which is why it is fetched for everything and the rest only for what is on
 * screen.
 */
export async function fundingBoard({ signal } = {}) {
  if (fundingCache.map && Date.now() - fundingCache.at < TTL) return fundingCache.map;
  const res = await fetch(`${FAPI}/fapi/v1/premiumIndex`, { signal });
  if (!res.ok) throw new Error(`Binance futures answered ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('Binance futures sent something else');
  const map = new Map();
  for (const r of rows) {
    const rate = Number(r?.lastFundingRate);
    if (r?.symbol && Number.isFinite(rate)) map.set(r.symbol, rate * 100);
  }
  fundingCache = { at: Date.now(), map };
  return map;
}

const json = async (path, { signal }) => {
  const res = await fetch(FAPI + path, { signal });
  if (!res.ok) return null;
  const body = await res.json();
  return Array.isArray(body) && body.length ? body : null;
};

/**
 * The three per-symbol measurements, for one coin.
 *
 * Null when the coin has no futures market at all, which is common — a spot
 * listing does not imply a perpetual, and saying nothing is the right answer
 * rather than showing a verdict built from a third of the evidence.
 */
export async function positioningFor(symbol, { signal, funding = null } = {}) {
  const held = perCoin.get(symbol);
  if (held && Date.now() - held.at < TTL) return held.value;

  const [oi, crowd, whales] = await Promise.all([
    json(`/futures/data/openInterestHist?symbol=${symbol}&period=1d&limit=2`, { signal }),
    json(`/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1d&limit=1`, { signal }),
    json(`/futures/data/topLongShortPositionRatio?symbol=${symbol}&period=1d&limit=1`, { signal }),
  ]);

  if (!oi && !crowd && !whales) {
    perCoin.set(symbol, { at: Date.now(), value: null });
    return null;
  }

  /** Open interest in dollars, so a coin's own price move does not read as growth. */
  let oiChange = null;
  let oiValue = null;
  if (oi && oi.length >= 2) {
    const now = Number(oi[1].sumOpenInterestValue);
    const before = Number(oi[0].sumOpenInterestValue);
    if (now > 0 && before > 0) {
      oiChange = ((now - before) / before) * 100;
      oiValue = now;
    }
  }

  const value = {
    oiChange,
    oiValue,
    funding,
    longAccounts: crowd ? Number(crowd[0].longAccount) : null,
    topLong: whales ? Number(whales[0].longAccount) : null,
  };
  perCoin.set(symbol, { at: Date.now(), value });
  return value;
}
