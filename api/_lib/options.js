/**
 * Gamma and delta exposure, by strike.
 *
 * GEX and DEX answer one question: where does the options market force dealers
 * to trade the underlying? A dealer who has sold options hedges by buying as
 * price rises and selling as it falls, or the reverse, and the strikes where
 * that pressure is concentrated are where price tends to stick or to run.
 *
 *   GEX = Γ × open interest × contract size × spot² × 1%
 *   DEX = Δ × open interest × contract size × spot
 *
 * The squared spot in GEX is not decoration: gamma is the rate of change of
 * delta, so turning it into dollars needs the move (spot × 1%) squared once for
 * the delta it creates and once for the value of that delta.
 *
 * One modelling assumption, and it is the usual one: dealers are taken to be
 * long calls and short puts, so call gamma is added and put gamma subtracted.
 * Nobody outside a clearing house knows the real book; every published GEX
 * makes this same assumption, and the shape it produces is what people read.
 * Delta is signed already, so DEX simply sums it.
 */

/** S&P and Nasdaq index options are 100 units of the index. */
const INDEX_MULTIPLIER = 100;

/* ── Black-Scholes, for a source that ships no greeks ──────────────────── */

/** Abramowitz and Stegun 7.1.26 — plenty for a chart. */
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return sign * y;
}

const normalCdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
const normalPdf = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

/**
 * Delta and gamma for one contract.
 *
 * `forward` is what the underlying is priced to change hands at on the expiry
 * date, and supplying it is the difference between a number worth publishing
 * and one that is merely in the right area. Rates were taken as zero here on
 * the grounds that carry moves the greeks less than the spread does, and that
 * is true for a weekly. It is badly untrue for the two- and five-year SPX
 * options that carry a large part of the book: at 5% rates a two-year forward
 * sits nearly a thousand points above spot.
 *
 * Measured against CBOE's own published greeks over 14,813 live contracts,
 * taking the forward from the chain instead of assuming zero carry moved the
 * mean absolute delta error from 0.0340 to 0.0023 — fifteen times closer.
 *
 * Omitting `forward` keeps the old zero-carry behaviour, which is right for a
 * quote already expressed in forward terms.
 */
export function greeks({ spot, strike, years, iv, isCall, forward = null, discount = 1 }) {
  if (!(spot > 0) || !(strike > 0) || !(years > 0) || !(iv > 0)) return null;
  const fwd = forward > 0 ? forward : spot;
  const vol = iv * Math.sqrt(years);
  const d1 = (Math.log(fwd / strike) + (vol * vol) / 2) / vol;

  /**
   * The carry factor, e^(−qT), which converts the forward-measure greeks into
   * the spot greeks a hedger actually trades.
   *
   * It needs the discount factor as well as the forward, and getting that wrong
   * is silent: with F = S·e^((r−q)T) and D = e^(−rT),
   *
   *   e^(−qT) = D · F / S
   *
   * Using F/S alone — the obvious-looking shortcut — leaves the whole discount
   * in, which at 5% over a two-year expiry is a ten per cent error in both
   * greeks, in the direction of making the book look larger than it is.
   */
  const carry = (discount > 0 ? discount : 1) * (fwd / spot);

  return {
    delta: (isCall ? normalCdf(d1) : normalCdf(d1) - 1) * carry,
    // Gamma is the second derivative with respect to *spot*, so the spot is
    // what belongs in the denominator even though d1 was built from the forward.
    gamma: (carry * normalPdf(d1)) / (spot * vol),
  };
}

/**
 * The forward and the discount factor for each expiry, from the chain itself.
 *
 * Put-call parity is a straight line in the strike:
 *
 *   C − P = D·(F − K)
 *
 * so a least-squares fit over the strikes of one expiry gives the discount
 * factor from the slope and the forward from the intercept. No rate curve, no
 * dividend forecast, no third-party data — the market has already priced both
 * and this reads them back out.
 *
 * Restricted to strikes near the money, where both legs are liquid and the two
 * mid prices are meaningful. A deep wing has a one-sided market and its mid is
 * noise that would tilt the line.
 *
 * Returns null for an expiry that cannot be fitted, and the caller then falls
 * back to spot — worse, but never wrong enough to notice on a short maturity.
 */
export function impliedForward(pairs, spot, { window = 0.1, minPairs = 4 } = {}) {
  const xs = [];
  const ys = [];
  for (const { strike, call, put } of pairs) {
    if (!(call > 0) || !(put > 0)) continue;
    if (strike < spot * (1 - window) || strike > spot * (1 + window)) continue;
    xs.push(strike);
    ys.push(call - put);
  }
  if (xs.length < minPairs) return null;

  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (!(den > 0)) return null;

  const slope = num / den;
  const discount = -slope;
  // A discount factor outside this range is a bad fit, not a bond market.
  if (!(discount > 0.5) || !(discount <= 1.02)) return null;
  const forward = (my - slope * mx) / discount;
  if (!(forward > 0)) return null;
  return { forward, discount, pairs: xs.length };
}

/**
 * The strike at which the options outstanding are worth least at expiry.
 *
 * Max pain is folklore with a real definition: for every candidate strike, what
 * every open contract would pay out if the underlying settled there, and the
 * lowest total wins. It is not a forecast and is labelled as such wherever it
 * is shown — but it is a genuine summary of where the open interest is heavy,
 * and it is the one number the reference dashboards all print.
 */
export function maxPain(contracts) {
  const strikes = [...new Set(contracts.map((c) => c.strike))].sort((a, b) => a - b);
  if (strikes.length < 2) return null;

  let best = null;
  for (const settle of strikes) {
    let total = 0;
    for (const c of contracts) {
      if (!(c.openInterest > 0)) continue;
      const intrinsic = c.isCall
        ? Math.max(0, settle - c.strike)
        : Math.max(0, c.strike - settle);
      total += intrinsic * c.openInterest;
    }
    if (best == null || total < best.total) best = { strike: settle, total };
  }
  return best?.strike ?? null;
}

/* ── Symbol parsing ────────────────────────────────────────────────────── */

/**
 * An OCC symbol, read from the right.
 *
 * The root varies in length and in spelling — SPX and SPXW, NDX and NDXP — so
 * the fixed part at the end is what can be relied on: eight digits of strike in
 * thousandths, one letter for the type, six for the date.
 */
export function parseOccSymbol(symbol) {
  const s = String(symbol || '').trim();
  const m = s.match(/^(.*?)(\d{6})([CP])(\d{8})$/);
  if (!m) return null;
  const [, root, date, type, strike] = m;
  return {
    root,
    expiry: `20${date.slice(0, 2)}-${date.slice(2, 4)}-${date.slice(4, 6)}`,
    isCall: type === 'C',
    strike: Number(strike) / 1000,
  };
}

/** `BTC-26MAR27-104000-C`. */
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function parseDeribitName(name) {
  const parts = String(name || '').split('-');
  if (parts.length !== 4) return null;
  const [, date, strike, type] = parts;
  const m = date.match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
  if (!m || !['C', 'P'].includes(type)) return null;
  const month = MONTHS.indexOf(m[2]);
  if (month < 0) return null;
  return {
    // Deribit settles at 08:00 UTC.
    expiryMs: Date.UTC(2000 + Number(m[3]), month, Number(m[1]), 8),
    isCall: type === 'C',
    strike: Number(strike),
  };
}

/* ── Aggregation ───────────────────────────────────────────────────────── */

/**
 * Roll contracts up into one row per strike.
 *
 * Every expiry is summed together. Splitting them apart is a different chart;
 * what is wanted here is the wall the whole book makes at a price.
 *
 * **The band is a drawing decision, not an accounting one**, and conflating the
 * two was the worst bug in this file. The totals below are taken over the whole
 * chain and only the plotted rows are trimmed to the band.
 *
 * It made almost no difference to gamma, which is why it survived so long:
 * gamma lives within a few per cent of spot, and a ±20% band on live SPX caught
 * 102.6% of it. Delta does not. A deep in-the-money call has a delta of one and
 * an enormous notional, and the S&P chain carries six-figure open interest at
 * strikes of 4,000, 5,000 and 6,000 against a spot of 7,675 — one 6,000-strike
 * line alone is $118B of delta. Banding threw away 39% of the real figure and
 * reported the remainder as the total.
 */
export function aggregate(contracts, spot, { multiplier = 1, band = 0.2, buckets = 24 } = {}) {
  if (!(spot > 0)) return null;
  const low = spot * (1 - band);
  const high = spot * (1 + band);

  /**
   * Strikes are rounded into buckets before being drawn.
   *
   * The S&P lists strikes five points apart, which is six hundred bars across
   * this range — a chart nobody can read, showing structure that is really one
   * wall split twenty ways. The step is rounded to something a person would say
   * out loud, so the axis reads 7,600 and 7,700 rather than 7,637.
   */
  const step = niceStep((high - low) / buckets);
  const bucketOf = (strike) => Math.round(strike / step) * step;

  const byStrike = new Map();
  let netGex = 0;
  let netDex = 0;
  let totalOi = 0;
  let bandOi = 0;

  for (const c of contracts) {
    if (!c || !(c.openInterest > 0)) continue;
    if (!Number.isFinite(c.gamma) || !Number.isFinite(c.delta)) continue;

    /**
     * Dealers are taken to be long calls and short puts, so call gamma adds and
     * put gamma subtracts. Nobody outside a clearing house knows the real book;
     * every published GEX makes this same assumption and the shape it produces
     * is what people read.
     *
     * Delta is already signed — a put's delta is negative — so DEX is the plain
     * sum. That is the conventional net delta of the open interest, and it is
     * deliberately not the dealer-signed version, which would count both sides
     * as long and never be negative.
     */
    const sign = c.isCall ? 1 : -1;
    const gex = sign * c.gamma * c.openInterest * multiplier * spot * spot * 0.01;
    const dex = c.delta * c.openInterest * multiplier * spot;

    // The total is the whole chain. Always.
    netGex += gex;
    netDex += dex;
    totalOi += c.openInterest;

    // The picture is the band.
    if (!(c.strike >= low && c.strike <= high)) continue;
    bandOi += c.openInterest;
    const key = bucketOf(c.strike);
    const row = byStrike.get(key) ?? { strike: key, gex: 0, dex: 0, oi: 0 };
    row.gex += gex;
    row.dex += dex;
    row.oi += c.openInterest;
    byStrike.set(key, row);
  }

  const strikes = [...byStrike.values()].sort((a, b) => a.strike - b.strike);
  if (!strikes.length) return null;

  return {
    spot,
    strikes: strikes.map((r) => ({
      strike: r.strike,
      gex: Math.round(r.gex),
      dex: Math.round(r.dex),
      oi: Math.round(r.oi),
    })),
    netGex: Math.round(netGex),
    netDex: Math.round(netDex),
    /**
     * The gamma flip is read off the drawn rows on purpose.
     *
     * It is a price, and a price is only meaningful where there is enough gamma
     * to hedge against. Running the cumulative sum from a 4,000 strike would
     * have it cross somewhere in the empty wing far below anywhere price trades.
     */
    gammaFlip: gammaFlip(strikes),
    maxPain: maxPain(contracts),
    /** What the picture covers, so the card can say so rather than imply all. */
    band: {
      pct: Math.round(band * 100),
      low: Math.round(low),
      high: Math.round(high),
      oiShown: Math.round(bandOi),
      oiTotal: Math.round(totalOi),
    },
  };
}

/** 1, 2 or 5 times a power of ten — the steps an axis is normally labelled in. */
function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const scaled = raw / magnitude;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return nice * magnitude;
}

/**
 * The strike where cumulative gamma crosses zero.
 *
 * Below it dealers are short gamma and hedging amplifies a move; above it they
 * are long and hedging damps one. It is the single most looked-at number on the
 * chart, so it is interpolated between the two strikes that straddle the cross
 * rather than rounded to whichever is nearer.
 */
function gammaFlip(strikes) {
  let running = 0;
  let previous = null;
  for (const row of strikes) {
    const next = running + row.gex;
    if (previous && Math.sign(next) !== Math.sign(running) && running !== 0) {
      const span = next - running;
      const fraction = span === 0 ? 0 : -running / span;
      return Math.round(previous.strike + (row.strike - previous.strike) * fraction);
    }
    running = next;
    previous = row;
  }
  return null;
}

/* ── The two sources ───────────────────────────────────────────────────── */

/**
 * CBOE ships delta and gamma already computed — and they are not good enough.
 *
 * They are published to **four decimal places**, which sounds like plenty until
 * you notice what gamma is worth on an index trading at 7,675. A thirty-day
 * at-the-money S&P gamma is about 0.0012, so four decimals leave twelve ticks
 * of resolution across the entire useful range, and the median contract in a
 * live chain carries a rounding uncertainty of 12.5% of its own value.
 *
 * Worse, it does not round symmetrically into noise that cancels. On the chain
 * measured while writing this, **4,442 contracts holding 6.9 million open
 * interest had a gamma that rounded to exactly zero** and vanished from the
 * total altogether. They were worth −$5.10B of GEX against a reported +$50.14B:
 * the published figure was overstated by ten per cent, always in the same
 * direction, because the wings that round away are mostly puts.
 *
 * So the greeks are recomputed from CBOE's implied volatility, which is
 * published at full precision, using a forward implied from the chain by
 * put-call parity. Checked against CBOE's own greeks over 14,813 live
 * contracts, this agrees to a mean absolute delta error of 0.0023 — and the
 * residual gamma difference is the rounding in their figure, not ours.
 *
 * CBOE's published greeks remain the fallback for any contract whose implied
 * volatility is missing or unusable, because a rounded number beats no number.
 */
export function fromCboe(payload, opts = {}) {
  const spot = Number(payload?.data?.close);
  const options = payload?.data?.options;
  if (!Array.isArray(options) || !(spot > 0)) return null;

  const now = opts.now ?? Date.now();

  /** Mid prices per expiry and strike, which is what parity needs. */
  const chains = new Map();
  const parsedRows = [];
  for (const o of options) {
    const parsed = parseOccSymbol(o?.option);
    if (!parsed) continue;
    parsedRows.push({ parsed, o });

    const chain = chains.get(parsed.expiry) ?? new Map();
    const pair = chain.get(parsed.strike) ?? { strike: parsed.strike, call: 0, put: 0 };
    const mid = (Number(o.bid) + Number(o.ask)) / 2;
    if (mid > 0) {
      if (parsed.isCall) pair.call = mid; else pair.put = mid;
    }
    chain.set(parsed.strike, pair);
    chains.set(parsed.expiry, chain);
  }

  const forwards = new Map();
  for (const [expiry, chain] of chains) {
    forwards.set(expiry, impliedForward([...chain.values()], spot));
  }

  const contracts = [];
  for (const { parsed, o } of parsedRows) {
    const openInterest = Number(o.open_interest) || 0;
    // Expiry is at the close of the stated day; index options settle in the
    // morning but the difference is hours against a horizon of months.
    const years = (Date.parse(`${parsed.expiry}T20:00:00Z`) - now)
      / (365.25 * 24 * 3600 * 1000);
    const fwd = forwards.get(parsed.expiry);
    const iv = Number(o.iv);

    const ours = greeks({
      spot,
      strike: parsed.strike,
      years,
      iv,
      isCall: parsed.isCall,
      forward: fwd?.forward ?? null,
      discount: fwd?.discount ?? 1,
    });

    const delta = ours ? ours.delta : Number(o.delta);
    const gamma = ours ? ours.gamma : Number(o.gamma);

    contracts.push({
      strike: parsed.strike,
      isCall: parsed.isCall,
      openInterest,
      delta,
      gamma,
      modelled: Boolean(ours),
    });
  }

  const profile = aggregate(contracts, spot, { multiplier: INDEX_MULTIPLIER, ...opts });
  if (!profile) return null;
  return {
    ...profile,
    /** How the greeks were arrived at, so the card can say which. */
    greeks: {
      modelled: contracts.filter((c) => c.modelled).length,
      published: contracts.filter((c) => !c.modelled).length,
      forwards: [...forwards.values()].filter(Boolean).length,
    },
  };
}

/**
 * Deribit gives open interest and implied volatility but no greeks, so they are
 * computed. One contract is one coin, so the multiplier is one.
 */
export function fromDeribit(rows, now = Date.now(), opts = {}) {
  if (!Array.isArray(rows) || !rows.length) return null;

  /**
   * Deribit's `underlying_price` is the **forward** for that instrument's own
   * expiry index, not the spot — the field next to it, `estimated_delivery_price`,
   * is the spot. Using the first row's forward as the spot for the whole
   * aggregate, which is what this did, picked whichever expiry happened to sort
   * first and scaled every strike by its basis.
   *
   * The two are now used for what they are: the spot scales the exposure, and
   * each instrument's own forward prices its greeks.
   */
  const spots = rows.map((r) => Number(r?.estimated_delivery_price))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const spot = spots.length
    ? spots[Math.floor(spots.length / 2)]
    : Number(rows.find((r) => Number(r?.underlying_price) > 0)?.underlying_price);

  const contracts = [];

  for (const r of rows) {
    const parsed = parseDeribitName(r?.instrument_name);
    if (!parsed) continue;
    const years = (parsed.expiryMs - now) / (365.25 * 24 * 3600 * 1000);
    const g = greeks({
      spot,
      strike: parsed.strike,
      years,
      iv: Number(r.mark_iv) / 100,
      isCall: parsed.isCall,
      // Deribit publishes the forward per expiry, so parity is not needed here.
      forward: Number(r.underlying_price) || spot,
      // Crypto options are margined in the coin and carry no separate discount.
      discount: 1,
    });
    if (!g) continue;
    contracts.push({
      strike: parsed.strike,
      isCall: parsed.isCall,
      openInterest: Number(r.open_interest) || 0,
      delta: g.delta,
      gamma: g.gamma,
    });
  }
  return aggregate(contracts, spot, { multiplier: 1, ...opts });
}
