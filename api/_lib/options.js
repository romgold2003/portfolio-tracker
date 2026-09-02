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
 * Delta and gamma for one contract. Rates are taken as zero: at these
 * maturities the carry term moves the greeks less than the bid-ask spread does.
 */
export function greeks({ spot, strike, years, iv, isCall }) {
  if (!(spot > 0) || !(strike > 0) || !(years > 0) || !(iv > 0)) return null;
  const vol = iv * Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (vol * vol) / 2) / vol;
  return {
    delta: isCall ? normalCdf(d1) : normalCdf(d1) - 1,
    gamma: normalPdf(d1) / (spot * vol),
  };
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
  for (const c of contracts) {
    if (!c || !(c.openInterest > 0)) continue;
    if (!(c.strike >= low && c.strike <= high)) continue;
    if (!Number.isFinite(c.gamma) || !Number.isFinite(c.delta)) continue;

    const key = bucketOf(c.strike);
    const row = byStrike.get(key) ?? { strike: key, gex: 0, dex: 0, oi: 0 };
    const sign = c.isCall ? 1 : -1;
    row.gex += sign * c.gamma * c.openInterest * multiplier * spot * spot * 0.01;
    row.dex += c.delta * c.openInterest * multiplier * spot;
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
    netGex: Math.round(strikes.reduce((s, r) => s + r.gex, 0)),
    netDex: Math.round(strikes.reduce((s, r) => s + r.dex, 0)),
    gammaFlip: gammaFlip(strikes),
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

/** CBOE ships delta and gamma already computed, which is most of the work. */
export function fromCboe(payload, opts = {}) {
  const spot = Number(payload?.data?.close);
  const options = payload?.data?.options;
  if (!Array.isArray(options)) return null;

  const contracts = [];
  for (const o of options) {
    const parsed = parseOccSymbol(o?.option);
    if (!parsed) continue;
    contracts.push({
      strike: parsed.strike,
      isCall: parsed.isCall,
      openInterest: Number(o.open_interest) || 0,
      delta: Number(o.delta),
      gamma: Number(o.gamma),
    });
  }
  return aggregate(contracts, spot, { multiplier: INDEX_MULTIPLIER, ...opts });
}

/**
 * Deribit gives open interest and implied volatility but no greeks, so they are
 * computed. One contract is one coin, so the multiplier is one.
 */
export function fromDeribit(rows, now = Date.now(), opts = {}) {
  if (!Array.isArray(rows) || !rows.length) return null;

  const spot = Number(rows.find((r) => Number(r?.underlying_price) > 0)?.underlying_price);
  const contracts = [];

  for (const r of rows) {
    const parsed = parseDeribitName(r?.instrument_name);
    if (!parsed) continue;
    const years = (parsed.expiryMs - now) / (365.25 * 24 * 3600 * 1000);
    const g = greeks({
      spot: Number(r.underlying_price) || spot,
      strike: parsed.strike,
      years,
      iv: Number(r.mark_iv) / 100,
      isCall: parsed.isCall,
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
