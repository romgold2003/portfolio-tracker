/**
 * A running record of net gamma and delta exposure, kept as the panel is drawn.
 *
 * This has to be recorded rather than fetched, and it is worth being blunt
 * about why, because it is the one thing about this panel that cannot be fixed
 * by writing more code. Deribit's book summary and CBOE's delayed quotes both
 * answer for right now and only for right now. Neither publishes the chain as
 * it stood last Tuesday. The vendors that sell option history sell equities and
 * ETFs, end of day — no Bitcoin, and the S&P and Nasdaq index chains this panel
 * actually draws are not in their coverage either. There is nothing to backfill
 * from at any price we would sensibly pay, so the series begins the first time
 * the panel was opened and grows from there.
 *
 * Readings are stamped to the minute rather than the day so that an hourly bar
 * has something in it. What that hourly bar means differs by market and is
 * worth knowing: Deribit reports open interest as it changes, so intraday
 * movement there is real positioning; the US index chains are struck once a day
 * at the clearing house, so within a session their curve moves because spot
 * moved through a fixed book, not because anyone traded.
 */
import { query, databaseAvailable } from './db.js';

/**
 * Exposure is carried as text, not as a number column.
 *
 * Net GEX on the S&P runs to eleven figures, and Postgres INTEGER stops at ten.
 * The alternative — BIGINT — is not a type SQLite and Postgres agree on closely
 * enough for the test suite to stay evidence about production, which is the
 * rule the rest of this schema is written to. Text costs a parse on read and
 * cannot overflow.
 */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS exposure_readings (
     market  TEXT NOT NULL,
     at      TEXT NOT NULL,
     spot    TEXT NOT NULL,
     net_gex TEXT NOT NULL,
     net_dex TEXT NOT NULL,
     flip    TEXT,
     PRIMARY KEY (market, at)
   )`,
  `CREATE INDEX IF NOT EXISTS exposure_readings_at ON exposure_readings (market, at)`,
];

let ready = false;

async function ensureTable() {
  if (ready) return;
  for (const statement of SCHEMA) await query(statement, []);
  ready = true;
}

/** Only for the test suite, which swaps the driver between cases. */
export function resetTableCache() {
  ready = false;
}

/**
 * Readings land in five-minute slots, and a second one in the same slot
 * replaces the first.
 *
 * Without a slot the row count would follow how often the page happened to be
 * open. With one, a market cannot cost more than 288 rows a day however hard
 * the panel is refreshed, and the newest reading in a slot is the one kept
 * because it is the one with more of the session behind it.
 */
export const SLOT_MS = 5 * 60 * 1000;

export function readingSlot(now = new Date()) {
  const floored = Math.floor(now.getTime() / SLOT_MS) * SLOT_MS;
  return `${new Date(floored).toISOString().slice(0, 19)}Z`;
}

/** How long readings are kept. Enough for a year of weekly bars. */
const KEEP_DAYS = 400;

export async function recordReading(market, profile, now = new Date()) {
  await ensureTable();
  const at = readingSlot(now);
  const values = [
    String(profile.spot),
    String(profile.netGex),
    String(profile.netDex),
    profile.gammaFlip == null ? null : String(profile.gammaFlip),
  ];

  // UPDATE-then-INSERT rather than ON CONFLICT, which is how the rest of this
  // schema writes a row that may already be there.
  const { rows } = await query(
    `UPDATE exposure_readings SET spot = $1, net_gex = $2, net_dex = $3, flip = $4
     WHERE market = $5 AND at = $6 RETURNING at`,
    [...values, market, at],
  );
  if (!rows.length) {
    await query(
      `INSERT INTO exposure_readings (spot, net_gex, net_dex, flip, market, at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [...values, market, at],
    );
  }
  return at;
}

/** Drop what has aged out. Cheap, and only ever removes whole old slots. */
async function prune(market, now = new Date()) {
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86400e3).toISOString();
  await query('DELETE FROM exposure_readings WHERE market = $1 AND at < $2', [market, cutoff]);
}

/**
 * The recorded readings for one market, oldest first.
 *
 * The cap is on rows rather than on time because the browser decides the
 * timeframe: an hourly chart wants the last few days at five-minute resolution
 * and a weekly one wants a year of them, and both are served from the same
 * answer.
 */
export async function readHistory(market, { limit = 6000 } = {}) {
  await ensureTable();
  const { rows } = await query(
    `SELECT at, spot, net_gex, net_dex, flip FROM exposure_readings
     WHERE market = $1 ORDER BY at DESC LIMIT $2`,
    [market, limit],
  );

  return rows
    .map((r) => ({
      at: String(r.at),
      spot: Number(r.spot),
      netGex: Number(r.net_gex),
      netDex: Number(r.net_dex),
      gammaFlip: r.flip == null ? null : Number(r.flip),
    }))
    .filter((r) => Number.isFinite(r.spot) && Number.isFinite(r.netGex) && Number.isFinite(r.netDex))
    .sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * Record this reading and hand back everything recorded so far.
 *
 * Never throws and never blocks the chart. The strike profile is the panel's
 * primary answer and it is already computed by the time this runs; a database
 * that is missing, asleep or refusing writes should cost the time curve, not
 * the picture the request was actually for.
 */
export async function trackExposure(market, profile, now = new Date()) {
  try {
    if (!(await databaseAvailable())) return null;
    await recordReading(market, profile, now);
    // Pruning is best-effort and must not cost the history if it fails.
    await prune(market, now).catch(() => {});
    return await readHistory(market);
  } catch (err) {
    console.error('Exposure history unavailable:', err);
    return null;
  }
}
