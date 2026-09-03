/**
 * A daily record of net gamma and delta exposure, so the panel can show a
 * curve through time as well as one across strikes.
 *
 * This has to be recorded rather than fetched. The strike profile is built from
 * a live chain — Deribit's book summary, CBOE's delayed quotes — and both
 * sources answer for right now and only for right now. Neither publishes the
 * chain as it stood last Tuesday, and the vendors that do sell history sell it;
 * there is no free series of past net GEX to backfill from. So the number is
 * kept each day it is computed, and the history grows forwards from the first
 * time the panel was opened.
 *
 * The consequence worth knowing: a day nobody opened the app is a day with no
 * reading. The chart is a record of what was observed, not a complete calendar,
 * which is why the roll-ups carry the count of days behind each point.
 */
import { query, databaseAvailable } from './db.js';
import { newYorkDay } from './week.js';

/**
 * Exposure is carried as text, not as a number column.
 *
 * Net GEX on the S&P runs to eleven figures, and Postgres INTEGER stops at ten.
 * The alternative — BIGINT — is not a type SQLite and Postgres agree on closely
 * enough for the test suite to stay evidence about production, which is the
 * rule the rest of this schema is written to. Text costs a parse on read and
 * cannot overflow.
 */
const SCHEMA = `CREATE TABLE IF NOT EXISTS exposure_history (
  market  TEXT NOT NULL,
  day     TEXT NOT NULL,
  spot    TEXT NOT NULL,
  net_gex TEXT NOT NULL,
  net_dex TEXT NOT NULL,
  flip    TEXT,
  PRIMARY KEY (market, day)
)`;

let ready = false;

async function ensureTable() {
  if (ready) return;
  await query(SCHEMA, []);
  ready = true;
}

/** Only for the test suite, which swaps the driver between cases. */
export function resetTableCache() {
  ready = false;
}

/**
 * Which calendar day a reading belongs to.
 *
 * New York for all three, including Bitcoin, which trades through the weekend
 * and has no close of its own. One calendar across the markets means a week
 * bucket holds the same seven days whichever is selected, so switching between
 * them compares like with like.
 */
export const readingDay = newYorkDay;

/**
 * Write today's reading, replacing an earlier one for the same day.
 *
 * Replacing rather than keeping the first is deliberate: the later reading was
 * taken with more of the session's open interest settled into it, so it is the
 * better single answer for the day.
 */
export async function recordReading(market, profile, now = new Date()) {
  await ensureTable();
  const day = readingDay(now);
  const values = [
    String(profile.spot),
    String(profile.netGex),
    String(profile.netDex),
    profile.gammaFlip == null ? null : String(profile.gammaFlip),
  ];

  // UPDATE-then-INSERT rather than ON CONFLICT, which is how the rest of this
  // schema writes a row that may already be there.
  const { rows } = await query(
    `UPDATE exposure_history SET spot = $1, net_gex = $2, net_dex = $3, flip = $4
     WHERE market = $5 AND day = $6 RETURNING day`,
    [...values, market, day],
  );
  if (!rows.length) {
    await query(
      `INSERT INTO exposure_history (spot, net_gex, net_dex, flip, market, day)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [...values, market, day],
    );
  }
  return day;
}

/** The recorded readings for one market, oldest first. */
export async function readHistory(market, { days = 400 } = {}) {
  await ensureTable();
  const { rows } = await query(
    `SELECT day, spot, net_gex, net_dex, flip FROM exposure_history
     WHERE market = $1 ORDER BY day DESC LIMIT $2`,
    [market, days],
  );

  return rows
    .map((r) => ({
      day: String(r.day),
      spot: Number(r.spot),
      netGex: Number(r.net_gex),
      netDex: Number(r.net_dex),
      gammaFlip: r.flip == null ? null : Number(r.flip),
    }))
    .filter((r) => Number.isFinite(r.spot) && Number.isFinite(r.netGex) && Number.isFinite(r.netDex))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Record today and hand back everything recorded so far.
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
    return await readHistory(market);
  } catch (err) {
    console.error('Exposure history unavailable:', err);
    return null;
  }
}
