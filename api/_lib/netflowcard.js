/**
 * Exchange netflow for the whole market, in dollars, independent of everything.
 *
 * One question: across every asset the app can read, is crypto capital moving
 * **onto** exchanges or **off** them? Nothing here filters by coin, and that is
 * deliberate — the coin picker elsewhere answers "what is happening to BTC",
 * and this answers "what is happening to the market", which is a different
 * question and a worse one to accidentally slice.
 *
 * ── The sign, which inverts ──────────────────────────────────────────────
 *
 *   inflow  = external wallet → exchange   = supply arriving where it can be
 *                                            sold                → bearish
 *   outflow = exchange → external wallet   = supply leaving into
 *                                            self-custody        → bullish
 *
 *   netflow = inflow − outflow
 *
 * So a **negative** netflow is the bullish one. This is the single easiest
 * thing in the file to get backwards and it is stated at every layer.
 *
 * Nothing here claims a sale or a purchase. Coins arriving on an exchange have
 * not been sold and may never be; they have only been placed where selling is
 * possible. The card says "signal", never "buy" or "sell".
 *
 * ── What is deliberately not counted ─────────────────────────────────────
 *
 * **A venue moving its own money.** Binance hot to Binance cold is not capital
 * entering or leaving the market, it is an exchange tidying up, and it happens
 * constantly and in enormous size. Counted, it would swamp every real signal.
 *
 * A transfer between *different* venues is counted on both sides — outflow for
 * the sender, inflow for the receiver — so it nets to zero for the market total
 * while still showing up correctly in each venue's own row, which is where it
 * actually means something.
 */
import { query, databaseAvailable } from './db.js';
import { exchangeOf } from './exchanges.js';

/**
 * The five periods the card shows.
 *
 * `rollup: true` marks the ones answered from the daily aggregate rather than
 * by rescanning every raw transfer. Six months of rows is not something to walk
 * on a thirty-second refresh, and a day-level total is exact for a period
 * measured in months.
 */
export const PERIODS = [
  { id: '24h', label: '24H', hours: 24, rollup: false },
  { id: '7d', label: '7D', hours: 24 * 7, rollup: false },
  { id: '1m', label: '1M', hours: 24 * 31, rollup: false },
  { id: '6m', label: '6M', hours: 24 * 183, rollup: true },
  { id: '1y', label: '1Y', hours: 24 * 366, rollup: true },
];

/**
 * Below this the two sides are close enough that the direction is noise.
 *
 * Three percent of the gross. A market that moved ten billion dollars and
 * netted eighty is not leaning either way, and calling that bullish because the
 * sign happened to land there would be the panel inventing conviction.
 */
const NEUTRAL_BAND = 0.03;

export function signalOf(netUsd, grossUsd) {
  if (!(grossUsd > 0)) return 'Neutral';
  if (Math.abs(netUsd) / grossUsd < NEUTRAL_BAND) return 'Neutral';
  // Negative is outflow, which is the bullish one.
  return netUsd < 0 ? 'Bullish' : 'Bearish';
}

/**
 * Split one transfer into what it means for each venue.
 *
 * Returns nothing at all when both ends are the same exchange, which is the
 * rule that keeps housekeeping out of the totals.
 */
export function classifyTransfer(row, byAddress) {
  const to = exchangeOf(row.to?.address ?? row.to_addr, byAddress);
  const from = exchangeOf(row.from?.address ?? row.from_addr, byAddress);
  if (!to && !from) return [];

  // A venue moving its own float. Not capital entering or leaving anything.
  if (to && from && to.venue === from.venue) return [];

  const usd = Number(row.usd);
  if (!(usd > 0)) return [];

  const legs = [];
  if (to) legs.push({ venue: to.venue, inUsd: usd, outUsd: 0 });
  if (from) legs.push({ venue: from.venue, inUsd: 0, outUsd: usd });
  return legs;
}

/**
 * Add up a set of transfers into venue totals.
 *
 * Every asset together, in dollars. The transfers arrive already deduplicated —
 * the store keys them by chain, hash and symbol, so the same movement seen from
 * two providers or two networks is one row before it ever reaches here.
 */
export function aggregate(rows, { byAddress, hours = 24, now = Date.now() } = {}) {
  const cutoff = Number.isFinite(hours) ? Math.floor(now / 1000) - hours * 3600 : -Infinity;
  const venues = new Map();
  let inUsd = 0;
  let outUsd = 0;
  let transfers = 0;

  for (const r of rows ?? []) {
    if (Number(r.at) < cutoff) continue;
    if (r.kind !== 'transfer') continue;

    const legs = classifyTransfer(r, byAddress);
    if (!legs.length) continue;
    transfers += 1;

    for (const leg of legs) {
      let v = venues.get(leg.venue);
      if (!v) { v = { venue: leg.venue, inUsd: 0, outUsd: 0 }; venues.set(leg.venue, v); }
      v.inUsd += leg.inUsd;
      v.outUsd += leg.outUsd;
      inUsd += leg.inUsd;
      outUsd += leg.outUsd;
    }
  }

  return { inUsd, outUsd, transfers, venues: [...venues.values()] };
}

/** Wrap raw totals into the shape the card draws. */
export function summarise({ inUsd, outUsd, transfers = 0, venues = [] }) {
  const netUsd = inUsd - outUsd;
  const grossUsd = inUsd + outUsd;
  return {
    inUsd,
    outUsd,
    netUsd,
    grossUsd,
    transfers,
    signal: signalOf(netUsd, grossUsd),
    venues: venues
      .map((v) => ({
        venue: v.venue,
        inUsd: v.inUsd,
        outUsd: v.outUsd,
        netUsd: v.inUsd - v.outUsd,
        grossUsd: v.inUsd + v.outUsd,
        signal: signalOf(v.inUsd - v.outUsd, v.inUsd + v.outUsd),
      }))
      .sort((a, b) => b.grossUsd - a.grossUsd),
  };
}

/* ── the daily rollup ──────────────────────────────────────────────────── */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS netflow_daily (
     day     TEXT NOT NULL,
     venue   TEXT NOT NULL,
     in_usd  TEXT NOT NULL,
     out_usd TEXT NOT NULL,
     txs     INTEGER NOT NULL,
     at      INTEGER NOT NULL,
     PRIMARY KEY (day, venue)
   )`,
  `CREATE INDEX IF NOT EXISTS netflow_daily_day ON netflow_daily (day)`,
];

let ready = false;
export function resetTableCache() { ready = false; }

async function ensureTable() {
  if (ready) return;
  for (const statement of SCHEMA) await query(statement, []);
  ready = true;
}

export const dayOf = (secs) => new Date(secs * 1000).toISOString().slice(0, 10);

/**
 * Roll the raw transfers up into one row per day per venue.
 *
 * Rewritten wholesale for the days it covers rather than appended to, because a
 * poll sees the same day repeatedly and adding each time would multiply it. The
 * raw rows are the source of truth; this is a cache of them, and a cache that
 * can drift from its source is worse than no cache.
 */
export async function roll(rows, { byAddress, days = 2, now = Date.now() } = {}) {
  if (!databaseAvailable()) return 0;
  await ensureTable();

  const from = Math.floor(now / 1000) - days * 86400;
  const byDay = new Map();

  for (const r of rows ?? []) {
    const at = Number(r.at);
    if (at < from) continue;
    if (r.kind !== 'transfer') continue;

    const legs = classifyTransfer(r, byAddress);
    if (!legs.length) continue;

    const day = dayOf(at);
    for (const leg of legs) {
      const key = `${day}|${leg.venue}`;
      let e = byDay.get(key);
      if (!e) { e = { day, venue: leg.venue, inUsd: 0, outUsd: 0, txs: 0 }; byDay.set(key, e); }
      e.inUsd += leg.inUsd;
      e.outUsd += leg.outUsd;
      e.txs += 1;
    }
  }

  const stamp = Math.floor(now / 1000);
  let written = 0;
  for (const e of byDay.values()) {
    await query('DELETE FROM netflow_daily WHERE day = $1 AND venue = $2', [e.day, e.venue]);
    await query(
      'INSERT INTO netflow_daily (day, venue, in_usd, out_usd, txs, at) VALUES ($1,$2,$3,$4,$5,$6)',
      [e.day, e.venue, String(e.inUsd), String(e.outUsd), e.txs, stamp],
    );
    written += 1;
  }
  return written;
}

/** Read a long period back out of the rollup. */
export async function fromRollup({ hours, now = Date.now() } = {}) {
  if (!databaseAvailable()) return null;
  await ensureTable();

  const from = dayOf(Math.floor(now / 1000) - hours * 3600);
  const { rows } = await query('SELECT * FROM netflow_daily WHERE day >= $1', [from]);

  const venues = new Map();
  let transfers = 0;
  for (const r of rows) {
    let v = venues.get(r.venue);
    if (!v) { v = { venue: r.venue, inUsd: 0, outUsd: 0 }; venues.set(r.venue, v); }
    v.inUsd += Number(r.in_usd);
    v.outUsd += Number(r.out_usd);
    transfers += Number(r.txs) || 0;
  }

  const all = [...venues.values()];
  return {
    inUsd: all.reduce((s, v) => s + v.inUsd, 0),
    outUsd: all.reduce((s, v) => s + v.outUsd, 0),
    transfers,
    venues: all,
  };
}

/** Older than the longest period the card offers. */
export async function prune({ now = Date.now() } = {}) {
  if (!databaseAvailable()) return;
  await ensureTable();
  await query('DELETE FROM netflow_daily WHERE day < $1',
    [dayOf(Math.floor(now / 1000) - 400 * 86400)]);
}

/**
 * The whole card: five periods, each with its venue breakdown.
 *
 * The short periods are computed from the raw transfers because they have to be
 * exact to the minute. The long ones come from the rollup, because six months
 * of raw rows is not something to walk on a refresh — and at that length a
 * day-level total is not an approximation, it is the same number.
 */
export async function build({ rows, byAddress, now = Date.now() } = {}) {
  const periods = [];

  for (const p of PERIODS) {
    let totals;
    if (p.rollup) {
      totals = await fromRollup({ hours: p.hours, now }).catch(() => null);
      // No rollup yet is not a reason to show nothing: the raw rows cover it.
      if (!totals) totals = aggregate(rows, { byAddress, hours: p.hours, now });
    } else {
      totals = aggregate(rows, { byAddress, hours: p.hours, now });
    }
    periods.push({ id: p.id, label: p.label, source: p.rollup ? 'daily' : 'live', ...summarise(totals) });
  }

  return periods;
}
