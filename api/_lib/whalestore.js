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

/**
 * Thirteen months, because the panel now offers a year.
 *
 * It was thirty days, which quietly made the 3M, 1Y and All windows lies — they
 * would have asked for a year and been handed a month without saying so. The
 * cost of keeping the rest is nothing: these are short text rows, and a busy
 * day writes a few hundred.
 */
export const RETAIN_MS = 397 * 24 * 60 * 60 * 1000;

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

/**
 * The same question asked per wallet instead of per transfer.
 *
 * This is the one that turns a feed into a tracker. A single $50M transfer says
 * almost nothing — it could be an exchange moving its own float between hot and
 * cold storage, which happens every day. The same address taking coins in
 * fourteen times over three weeks and sending none back says something a single
 * row never can, and it is the whole reason the store exists rather than the
 * panel simply re-reading the last hour.
 *
 * Net is `in - out`, in dollars at the time each transfer was recorded. Positive
 * is accumulation, negative is distribution. An address that received and sent
 * roughly the same amount nets out near zero, which is correct and is exactly
 * what filters out the pass-through addresses that dominate a raw feed.
 *
 * Two things this deliberately does not do:
 *
 * **It does not join addresses across chains.** An Ethereum address and a Tron
 * address are different keys with no on-chain link between them, so claiming
 * they are one whale would be a guess. Where the source has given both the same
 * entity name they are grouped by that name and the grouping is honest; where it
 * has not, an address is a wallet and nothing more.
 *
 * **It does not call anything a whale.** Ranking by net flow is arithmetic.
 * Deciding whose flow is *smart* needs each wallet's realised profit over its
 * whole history, which is a different and far larger product.
 */
export async function byAddress({
  symbol = null, sinceDays = 30, minNetUsd = 0, limit = 40, kinds = null, now = Date.now(),
} = {}) {
  if (!databaseAvailable()) return [];
  await ensureTable();

  const cutoff = Math.floor((now - sinceDays * 24 * 60 * 60 * 1000) / 1000);
  const params = [cutoff];
  let sql = 'SELECT * FROM whale_transfers WHERE at >= $1';
  if (symbol) {
    params.push(String(symbol).toUpperCase());
    sql += ` AND symbol = $${params.length}`;
  }
  const { rows } = await query(sql, params);

  /** Mint and burn holes are not wallets and must not head the ranking. */
  const VOID = new Set([
    '0x0000000000000000000000000000000000000000',
    'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
  ]);

  const wallets = new Map();
  const touch = (address, owner, row, direction) => {
    if (!address || VOID.has(address)) return;
    let w = wallets.get(address);
    if (!w) {
      w = {
        address,
        owner: owner || null,
        inUsd: 0,
        outUsd: 0,
        transfers: 0,
        chains: new Set(),
        symbols: new Map(),
        firstAt: Infinity,
        lastAt: 0,
      };
      wallets.set(address, w);
    }
    // A name learned on any row belongs to the wallet on all of them.
    if (!w.owner && owner) w.owner = owner;

    const usd = Number(row.usd) || 0;
    if (direction === 'in') w.inUsd += usd; else w.outUsd += usd;
    w.transfers += 1;
    w.chains.add(row.blockchain);
    w.symbols.set(row.symbol, (w.symbols.get(row.symbol) ?? 0) + (direction === 'in' ? usd : -usd));
    w.firstAt = Math.min(w.firstAt, Number(row.at));
    w.lastAt = Math.max(w.lastAt, Number(row.at));
  };

  for (const r of rows) {
    if (kinds && !kinds.includes(r.kind)) continue;
    touch(r.to_addr, r.to_owner, r, 'in');
    touch(r.from_addr, r.from_owner, r, 'out');
  }

  return [...wallets.values()]
    .map((w) => ({
      address: w.address,
      owner: w.owner,
      netUsd: w.inUsd - w.outUsd,
      inUsd: w.inUsd,
      outUsd: w.outUsd,
      transfers: w.transfers,
      chains: [...w.chains],
      // Largest exposure first: what the wallet is actually doing this in.
      symbols: [...w.symbols.entries()]
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .map(([sym, net]) => ({ symbol: sym, netUsd: net })),
      firstAt: w.firstAt === Infinity ? null : w.firstAt,
      lastAt: w.lastAt || null,
      /**
       * A wallet that only ever received, or only ever sent.
       *
       * Worth flagging because it is the cleanest version of the signal: no
       * round-tripping, no ambiguity about which way the position went.
       */
      oneWay: w.inUsd === 0 || w.outUsd === 0,
    }))
    .filter((w) => Math.abs(w.netUsd) >= minNetUsd)
    .sort((a, b) => Math.abs(b.netUsd) - Math.abs(a.netUsd))
    .slice(0, limit);
}
