/**
 * Who holds a token, how much, and whether that is falling.
 *
 * Everything else in this app tracks **flows** — a transfer happened, here is
 * what moved. This tracks **balances**, and the difference is the whole reason
 * it exists.
 *
 * A flow can be evaded without trying to. A whale that wants out deposits to an
 * exchange and sells there, and the free indexers cannot tell Binance's hot
 * wallet from any other address — it comes back with `name: null`. Or the sale
 * happens over the counter, or through a short on a venue that never touches
 * spot, or on a chain nothing here reads. Six ordinary routes out and the
 * transfer tracker sees one of them.
 *
 * A balance cannot be evaded, because it is not an event. Whatever route was
 * taken, if a holder went from forty million tokens to twenty-five million, it
 * fell. That is the honest answer to "is the team selling", and it is the only
 * measure here that does not depend on catching the right moment.
 *
 * Snapshots land in daily slots. One row per holder per day means twenty tokens
 * cost about a thousand rows a day however often the panel is refreshed, and
 * any window can be answered by differencing two days.
 */
import { query, databaseAvailable } from './db.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS holder_balances (
     chain   TEXT NOT NULL,
     token   TEXT NOT NULL,
     holder  TEXT NOT NULL,
     day     TEXT NOT NULL,
     symbol  TEXT NOT NULL,
     name    TEXT,
     kind    TEXT NOT NULL,
     units   TEXT NOT NULL,
     usd     TEXT NOT NULL,
     at      INTEGER NOT NULL,
     PRIMARY KEY (chain, token, holder, day)
   )`,
  `CREATE INDEX IF NOT EXISTS holder_balances_day ON holder_balances (day)`,
  `CREATE INDEX IF NOT EXISTS holder_balances_token ON holder_balances (chain, token, day)`,
];

let ready = false;
export function resetTableCache() { ready = false; }

async function ensureTable() {
  if (ready) return;
  for (const statement of SCHEMA) await query(statement, []);
  ready = true;
}

/** Ninety days: long enough for the longest window, short enough to stay small. */
export const RETAIN_DAYS = 90;

export const dayOf = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/**
 * What a holder is, which is the difference between two very different stories.
 *
 * A treasury multisig shedding tokens and an anonymous whale shedding tokens
 * look identical in a list of falling balances, and they do not mean the same
 * thing at all — one is the people who made the thing getting out.
 *
 * The deployer is knowable: the chain records who created the contract. Safes
 * are knowable: the indexer names the proxy, and a Safe holding a large share
 * of a token's supply is a treasury or a team allocation essentially every
 * time. Neither is a guess, and anything that fits neither is left as a plain
 * wallet rather than being promoted on a hunch.
 */
const SAFE_NAME = /safe|multisig|gnosis|timelock|vesting|treasury/i;

export function classify({ address, name, isContract, creator }) {
  if (creator && address && address.toLowerCase() === String(creator).toLowerCase()) {
    return 'deployer';
  }
  if (name && SAFE_NAME.test(name)) return 'team';
  if (isContract) return 'contract';
  return 'wallet';
}

/** The kinds that mean insiders rather than the market. */
export const INSIDER = new Set(['deployer', 'team']);

/**
 * Read a token's top holders from a Blockscout-shaped instance.
 *
 * Fifty in one request, which is what makes this affordable: the whole point is
 * that it costs one call per token rather than one per holder.
 */
export async function fetchHolders({
  host, chain, token, price = null, signal, fetcher = fetch,
}) {
  /**
   * The token has to be identified before its holders mean anything.
   *
   * A holder row is an address, a token id and a raw integer — no symbol and no
   * decimals — so 42112097000000000000000000 is either forty-two million LINK
   * or nonsense depending on a number that is not in the response.
   */
  const info = await fetchTokenInfo({ host, token, signal, fetcher });
  if (!info) return [];

  const res = await fetcher(`https://${host}/api/v2/tokens/${token}/holders`, {
    signal,
    headers: { Accept: 'application/json', 'User-Agent': 'riskbook' },
  });
  if (!res.ok) throw new Error(`${host} answered ${res.status} for holders`);
  const body = await res.json();

  const out = [];
  for (const row of body?.items ?? []) {
    const units = Number(row?.value) / 10 ** info.decimals;
    const address = row?.address?.hash;
    if (!address || !Number.isFinite(units) || units <= 0) continue;

    const name = row?.address?.name
      ?? row?.address?.ens_domain_name
      ?? (row?.address?.public_tags ?? [])[0]
      ?? null;

    out.push({
      chain,
      token,
      symbol: info.symbol,
      holder: address,
      name,
      /**
       * Carried through, not just consumed here.
       *
       * Without it a downstream classifier sees a named address with no way to
       * know it is code, and "Aave v3 LINK" and "TransparentUpgradeableProxy"
       * both ranked as whales — a lending pool and a proxy contract sitting in
       * a table of people with opinions.
       */
      isContract: !!row?.address?.is_contract,
      kind: classify({ address, name, isContract: !!row?.address?.is_contract, creator: info.creator }),
      units,
      usd: price ? units * price : 0,
    });
  }
  return out;
}

/**
 * A token's own symbol, decimals and creator.
 *
 * All three are fixed for the life of the contract, so this is cached hard and
 * asked once. It has to be asked at all because the holders endpoint does not
 * carry them: a holder row is an address, a token id and a raw value, and
 * without the decimals that value is a meaningless integer.
 */
const tokenInfo = new Map();

export async function fetchTokenInfo({ host, token, signal, fetcher = fetch }) {
  const key = `${host}:${token}`;
  if (tokenInfo.has(key)) return tokenInfo.get(key);

  const [meta, address] = await Promise.allSettled([
    fetcher(`https://${host}/api/v2/tokens/${token}`, {
      signal, headers: { Accept: 'application/json', 'User-Agent': 'riskbook' },
    }).then((r) => (r.ok ? r.json() : null)),
    fetcher(`https://${host}/api/v2/addresses/${token}`, {
      signal, headers: { Accept: 'application/json', 'User-Agent': 'riskbook' },
    }).then((r) => (r.ok ? r.json() : null)),
  ]);

  const m = meta.status === 'fulfilled' ? meta.value : null;
  const a = address.status === 'fulfilled' ? address.value : null;
  const symbol = String(m?.symbol ?? '').toUpperCase();
  if (!symbol) return null;

  const decimals = Number(m?.decimals) || 18;
  const info = {
    symbol,
    decimals,
    creator: a?.creator_address_hash ?? null,
    /** In whole tokens, so a share of supply can be worked out. */
    totalSupply: Number(m?.total_supply) / 10 ** decimals || null,
    address: token,
  };
  tokenInfo.set(key, info);
  return info;
}

export function resetTokenInfoCache() { tokenInfo.clear(); }

/** Who deployed a token, cached hard — a contract has exactly one creator, forever. */
const creators = new Map();

export async function fetchCreator({ host, token, signal, fetcher = fetch }) {
  const key = `${host}:${token}`;
  if (creators.has(key)) return creators.get(key);
  try {
    const res = await fetcher(`https://${host}/api/v2/addresses/${token}`, {
      signal,
      headers: { Accept: 'application/json', 'User-Agent': 'riskbook' },
    });
    if (!res.ok) throw new Error(String(res.status));
    const body = await res.json();
    const creator = body?.creator_address_hash ?? null;
    creators.set(key, creator);
    return creator;
  } catch {
    // Unknown rather than absent: a failed lookup must not make everybody a
    // plain wallet forever, so it is not cached.
    return null;
  }
}

export function resetCreatorCache() { creators.clear(); }

/** Write one day's snapshot. A second write in the same day replaces the first. */
/**
 * Rows per statement. Ten columns each, so 500 parameters — inside the oldest
 * SQLite limit of 999 as well as Postgres's.
 */
const BATCH = 50;

/**
 * Today's balance for each holder, replacing any earlier reading of the day.
 *
 * One delete and one insert per token, not two queries per holder. The
 * row-at-a-time version made about 1,600 round trips a snapshot — 2 chains,
 * 8 tokens, 50 holders, twice each — and every one crossed from the
 * function's region to the database's at about 80 ms. Measured on 1 October
 * 2026 it was still going after 36 seconds, ran the scheduled poll out of
 * its budget on every run, and so the netflow rollup after it never ran at
 * all.
 *
 * A holder listed twice keeps its last reading, as before; the table's
 * primary key would refuse both in one insert.
 */
export async function record(rows, { now = Date.now() } = {}) {
  if (!databaseAvailable() || !rows?.length) return 0;
  await ensureTable();

  const day = dayOf(now);
  const at = Math.floor(now / 1000);

  const byToken = new Map();
  for (const r of rows) {
    const key = `${r.chain}|${r.token}`;
    if (!byToken.has(key)) byToken.set(key, new Map());
    byToken.get(key).set(r.holder, r);
  }

  let written = 0;
  for (const holdersOf of byToken.values()) {
    const unique = [...holdersOf.values()];
    for (let i = 0; i < unique.length; i += BATCH) {
      const batch = unique.slice(i, i + BATCH);
      const { chain, token } = batch[0];

      const listed = batch.map((_, j) => `$${j + 4}`).join(', ');
      await query(
        `DELETE FROM holder_balances
          WHERE chain = $1 AND token = $2 AND day = $3 AND holder IN (${listed})`,
        [chain, token, day, ...batch.map((r) => r.holder)],
      );

      const values = [];
      const params = [];
      batch.forEach((r, j) => {
        const b = j * 10;
        values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`);
        params.push(r.chain, r.token, r.holder, day, r.symbol, r.name ?? null, r.kind,
          String(r.units), String(r.usd), at);
      });
      await query(
        `INSERT INTO holder_balances
           (chain, token, holder, day, symbol, name, kind, units, usd, at)
         VALUES ${values.join(', ')}`,
        params,
      );
      written += batch.length;
    }
  }
  return written;
}

/**
 * Holders whose balance has fallen since the window opened.
 *
 * The comparison is against the **earliest** snapshot inside the window rather
 * than the one immediately before, so a position sold down over three weeks
 * reads as three weeks of selling rather than as whatever happened yesterday.
 *
 * A holder with no earlier snapshot is not reported. It has not fallen; it has
 * only just been seen, and calling that a sale would turn every new entry to
 * the top fifty into an alarm.
 */
export async function changes({
  days = 7, minUsd = 1_000_000, minPct = 2, now = Date.now(), symbol = null, limit = 40,
} = {}) {
  if (!databaseAvailable()) return [];
  await ensureTable();

  const from = dayOf(now - days * 86_400_000);
  const params = [from];
  let sql = 'SELECT * FROM holder_balances WHERE day >= $1';
  if (symbol) {
    params.push(String(symbol).toUpperCase());
    sql += ` AND symbol = $${params.length}`;
  }
  const { rows } = await query(sql, params);

  /** Earliest and latest snapshot per holder, per token. */
  const seen = new Map();
  for (const r of rows) {
    const key = `${r.chain}:${r.token}:${r.holder}`;
    const entry = seen.get(key);
    if (!entry) { seen.set(key, { first: r, last: r }); continue; }
    if (r.day < entry.first.day) entry.first = r;
    if (r.day > entry.last.day) entry.last = r;
  }

  const out = [];
  for (const { first, last } of seen.values()) {
    if (first.day === last.day) continue;

    const before = Number(first.units);
    const after = Number(last.units);
    if (!(before > 0)) continue;

    const pct = ((after - before) / before) * 100;
    // Dust moves are not decisions, and every balance wobbles.
    if (Math.abs(pct) < minPct) continue;

    const usdNow = Number(last.usd);
    const usdMoved = Math.abs(usdNow - Number(first.usd));
    if (!(Math.max(usdMoved, usdNow) >= minUsd)) continue;

    out.push({
      chain: last.chain,
      token: last.token,
      symbol: last.symbol,
      holder: last.holder,
      name: last.name,
      kind: last.kind,
      insider: INSIDER.has(last.kind),
      unitsBefore: before,
      unitsAfter: after,
      unitsDelta: after - before,
      pct: Math.round(pct * 100) / 100,
      usdNow,
      usdDelta: usdNow - Number(first.usd),
      from: first.day,
      to: last.day,
      at: Number(last.at),
    });
  }

  // Biggest movers first, in dollars, whichever way they moved.
  return out
    .sort((a, b) => Math.abs(b.usdDelta) - Math.abs(a.usdDelta))
    .slice(0, limit);
}

/** Drop what has aged out. Called on the way past, so nothing is scheduled. */
export async function prune({ now = Date.now() } = {}) {
  if (!databaseAvailable()) return;
  await ensureTable();
  await query('DELETE FROM holder_balances WHERE day < $1',
    [dayOf(now - RETAIN_DAYS * 86_400_000)]);
}
