/**
 * Whale transfers, kept so the panel has a history rather than a snapshot.
 *
 * This exists because of what the provider's free plan is: a window on the last
 * hour, not an archive. At a twenty-million-dollar floor an hour is very often
 * empty — which is a true answer about the last hour and a useless one about
 * the week — so every poll writes what it saw and the panel reads the store.
 * Left alone for a day, the app knows a day.
 *
 * The same pattern, and the same reasoning, as exposure_readings: a series that
 * cannot be backfilled from anywhere has to be recorded as it happens.
 *
 * Text columns throughout. Amounts run past what INTEGER holds — a hundred
 * billion SHIB is not a ten-digit number — and BIGINT is not a type SQLite and
 * Postgres agree on closely enough for the tests to stay evidence about
 * production. Text costs a parse on read and cannot overflow.
 */
import { query, databaseAvailable } from './db.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS whale_transfers (
     id         TEXT PRIMARY KEY,
     at         INTEGER NOT NULL,
     blockchain TEXT NOT NULL,
     symbol     TEXT NOT NULL,
     kind       TEXT NOT NULL,
     amount     TEXT,
     usd        TEXT NOT NULL,
     hash       TEXT NOT NULL,
     from_addr  TEXT,
     from_owner TEXT,
     from_type  TEXT,
     to_addr    TEXT,
     to_owner   TEXT,
     to_type    TEXT,
     parts      INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS whale_transfers_at ON whale_transfers (at)`,
  `CREATE INDEX IF NOT EXISTS whale_transfers_symbol ON whale_transfers (symbol, at)`,
];

let ready = false;

/** Only for the test suite, which swaps the driver between cases. */
export function resetTableCache() {
  ready = false;
}

async function ensureTable() {
  if (ready) return;
  for (const statement of SCHEMA) await query(statement, []);
  ready = true;
}

/** A month. Long enough for the largest timeframe, short enough to stay small. */
export const RETAIN_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Write what a poll saw, ignoring anything already held.
 *
 * Dedup is the whole job. The same transfer arrives again on the next poll
 * because the windows overlap on purpose, arrives twice within one poll when a
 * page boundary repeats it, and arrives from two chains at once for a bridged
 * stablecoin. The primary key settles the first two. The third is a different
 * transfer on each side of the bridge and is correctly kept as two.
 *
 * Rows are inserted one at a time rather than as one statement with N tuples.
 * Slower, and it is what keeps the SQL portable enough for SQLite in the tests
 * to mean anything about Postgres in production.
 */
export async function record(transfers) {
  if (!databaseAvailable() || !Array.isArray(transfers) || !transfers.length) return 0;
  await ensureTable();

  let written = 0;
  for (const t of transfers) {
    if (!t?.id) continue;
    const existing = await query('SELECT id FROM whale_transfers WHERE id = $1', [t.id]);
    if (existing.rows.length) continue;
    await query(
      `INSERT INTO whale_transfers
         (id, at, blockchain, symbol, kind, amount, usd, hash,
          from_addr, from_owner, from_type, to_addr, to_owner, to_type, parts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        t.id, t.at, t.blockchain, t.symbol, t.kind,
        t.amount == null ? null : String(t.amount), String(t.usd), t.hash,
        t.from?.address ?? null, t.from?.owner ?? null, t.from?.ownerType ?? null,
        t.to?.address ?? null, t.to?.owner ?? null, t.to?.ownerType ?? null,
        t.parts ?? 1,
      ],
    );
    written += 1;
  }
  return written;
}

/** The newest transfer held, so the next poll asks from there rather than blind. */
export async function latestAt() {
  if (!databaseAvailable()) return null;
  await ensureTable();
  const { rows } = await query('SELECT MAX(at) AS at FROM whale_transfers', []);
  const at = Number(rows?.[0]?.at);
  return Number.isFinite(at) && at > 0 ? at : null;
}

function rowOut(r) {
  return {
    id: r.id,
    at: Number(r.at),
    blockchain: r.blockchain,
    symbol: r.symbol,
    kind: r.kind,
    amount: r.amount == null ? null : Number(r.amount),
    usd: Number(r.usd),
    hash: r.hash,
    from: { address: r.from_addr, owner: r.from_owner, ownerType: r.from_type },
    to: { address: r.to_addr, owner: r.to_owner, ownerType: r.to_type },
    parts: Number(r.parts) || 1,
  };
}

/**
 * Read the store back, newest first.
 *
 * The USD floor is applied in JavaScript rather than in SQL, and deliberately:
 * `usd` is a text column, so `usd >= '20000000'` is a string comparison that
 * would rank 9,000,000 above 20,000,000. Sorting on `at` is safe because that
 * one is a real integer.
 */
export async function read({ symbol = null, minUsd = 0, maxUsd = Infinity, limit = 200 } = {}) {
  if (!databaseAvailable()) return [];
  await ensureTable();

  const params = [];
  let sql = 'SELECT * FROM whale_transfers';
  if (symbol) {
    params.push(String(symbol).toUpperCase());
    sql += ` WHERE symbol = $${params.length}`;
  }
  sql += ' ORDER BY at DESC';

  const { rows } = await query(sql, params);
  const out = [];
  for (const r of rows) {
    const row = rowOut(r);
    if (!(row.usd >= minUsd) || row.usd >= maxUsd) continue;
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

/** How many are held per symbol, for the picker's counts. */
export async function countsBySymbol({ minUsd = 0 } = {}) {
  if (!databaseAvailable()) return new Map();
  await ensureTable();
  const { rows } = await query('SELECT symbol, usd FROM whale_transfers', []);
  const counts = new Map();
  for (const r of rows) {
    if (!(Number(r.usd) >= minUsd)) continue;
    counts.set(r.symbol, (counts.get(r.symbol) ?? 0) + 1);
  }
  return counts;
}

/** Drop what has aged out. Called on the way past, so nothing is scheduled. */
export async function prune({ now = Date.now() } = {}) {
  if (!databaseAvailable()) return;
  await ensureTable();
  const cutoff = Math.floor((now - RETAIN_MS) / 1000);
  await query('DELETE FROM whale_transfers WHERE at < $1', [cutoff]);
}
