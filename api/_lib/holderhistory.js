/**
 * Is this whale still holding? Answered today, not in two days' time.
 *
 * The holder card could already say who owns the most of a coin, but not
 * whether they have been adding or leaving — that came from comparing daily
 * snapshots, and comparing snapshots needs two days of them. On a fresh
 * deployment the whole lower half of the card read "nothing yet", which is the
 * least useful thing a tracker can say about the people it is tracking.
 *
 * ── Rebuilding the past from the present ─────────────────────────────────
 *
 * A balance is a running total of transfers, so it can be walked backwards. If
 * an address holds nineteen million tokens now, and over the last thirty days
 * two million arrived and five million left, then thirty days ago it held
 * twenty-two million:
 *
 *     balance(then) = balance(now) − (in − out) over the window
 *
 * The transfers are public and free to read, one indexed request per holder,
 * filtered to the token in question. Nothing has to have been recorded in
 * advance, which is the entire point: the answer is available the first time
 * anybody asks.
 *
 * ── What it will not claim ───────────────────────────────────────────────
 *
 * One page of transfers is fifty movements. For most holders that reaches back
 * months — several of the top LINK addresses have not moved since 2019 — but a
 * busy address can burn fifty in a week. When the page does not reach back far
 * enough, the window is reported as **partial** and no change is asserted for
 * it, rather than reporting the part that happened to fit as though it were
 * the whole.
 *
 * And tokens leaving a wallet are not a sale. The same rule as everywhere else
 * on this page: this file reports that a position got smaller, never why.
 */
import { query, databaseAvailable } from './db.js';

/** How far back the card asks about. */
export const WINDOWS = [
  { id: '30d', label: '30d', days: 30 },
  { id: '90d', label: '90d', days: 90 },
];

/** One page. Fifty movements, which is months for most holders and days for a few. */
const PAGE = 50;

/**
 * What a holder did over a window, from its transfer list.
 *
 * `transfers` are that holder's movements of one token, newest first, as the
 * indexer returns them. `unitsNow` is what it holds today.
 */
export function movementOf({ transfers = [], unitsNow = 0, address, days, now = Date.now(), complete = true }) {
  const cutoff = (now - days * 86_400_000) / 1000;
  const me = String(address ?? '').toLowerCase();

  let inUnits = 0;
  let outUnits = 0;
  let counted = 0;
  let lastAt = null;
  let reached = false;

  for (const t of transfers) {
    const at = t.at ?? 0;
    if (lastAt == null || at > lastAt) lastAt = at;
    if (at < cutoff) { reached = true; break; }

    const from = String(t.from ?? '').toLowerCase();
    const to = String(t.to ?? '').toLowerCase();
    // A wallet paying itself moved nothing, and would otherwise count twice.
    if (from === to) continue;

    const units = Number(t.units);
    if (!Number.isFinite(units) || units <= 0) continue;

    if (to === me) inUnits += units;
    else if (from === me) outUnits += units;
    counted += 1;
  }

  /**
   * The window is only answerable if the transfer list actually spans it: a
   * page that ran out before the cutoff has seen part of the window and knows
   * nothing about the rest.
   */
  const covered = reached || complete;
  if (!covered) {
    return { days, covered: false, transfers: counted, lastAt };
  }

  const netUnits = inUnits - outUnits;
  const raw = unitsNow - netUnits;

  /**
   * A wallet that started the window empty lands on zero, give or take.
   *
   * A real address came back at −9.3e-10 tokens: it received all 4,369,740
   * LINK it holds inside the window, so the true answer is exactly zero and
   * the sign is the last bits of a floating-point subtraction. Anything within
   * a whisker of the amounts involved is that, and is zero.
   *
   * A balance that is negative by more than a whisker is not rounding — it
   * means the transfer list is missing movements — so the window is reported
   * as unanswerable rather than as a number that cannot be true.
   */
  const noise = Math.max(unitsNow, inUnits, outUnits) * 1e-9;
  if (raw < -noise) return { days, covered: false, transfers: counted, lastAt };
  const unitsThen = raw < 0 ? 0 : raw;

  return {
    days,
    covered: true,
    inUnits,
    outUnits,
    netUnits,
    unitsThen,
    transfers: counted,
    lastAt,
    /**
     * Held nothing at the start and something now: the position was opened
     * inside the window. There is no percentage of nothing, so it is flagged
     * rather than given a number — and it must not fall through to "holding",
     * which is what a whale that built its entire position this quarter was
     * being called.
     */
    fromNothing: unitsThen === 0 && unitsNow > 0,
    /**
     * As a share of what was held then, which is the number that means
     * something: a whale that shed two million out of three is a different
     * story from one that shed two million out of two hundred.
     */
    pct: unitsThen > 0 ? (netUnits / unitsThen) * 100 : null,
  };
}

/** Below this a change is the dust of an active wallet, not a decision. */
export const MATERIAL_PCT = 2;

/**
 * What to call it on screen.
 *
 * "Holding" is the common and correct answer and is not hedged. Everything
 * else describes the size of the position, never a trade — tokens leaving a
 * wallet are not a sale and this file never says they are.
 */
export function describeHolding(move) {
  if (!move?.covered) {
    return { status: 'Not enough history', tone: '', note: 'The transfer record does not reach back this far.' };
  }
  // Built from nothing inside the window: not a holder, a new arrival.
  if (move.fromNothing) {
    return { status: 'New position', tone: 'cw-in', note: 'The whole position was built inside this window.' };
  }
  if (move.pct == null || Math.abs(move.pct) < MATERIAL_PCT) {
    return {
      status: move.transfers === 0 ? 'Untouched' : 'Holding',
      tone: '',
      note: move.transfers === 0
        ? 'Not one movement in this window.'
        : 'Moved, but the position is the size it was.',
    };
  }
  return move.pct > 0
    ? { status: 'Adding', tone: 'cw-in', note: 'The position grew over this window.' }
    : { status: 'Reducing', tone: 'cw-out', note: 'The position shrank. Where it went is a separate question.' };
}

/* ── the cache ──────────────────────────────────────────────────────────── */

let ready = false;

async function ensureTable() {
  if (ready || !databaseAvailable()) return;
  await query(`CREATE TABLE IF NOT EXISTS holder_history (
    chain TEXT NOT NULL,
    token TEXT NOT NULL,
    holder TEXT NOT NULL,
    day TEXT NOT NULL,
    moves TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (chain, token, holder, day)
  )`, []);
  ready = true;
}

export function resetTableCache() { ready = false; }

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Correct an answer worked out before the rules were right.
 *
 * A row cached earlier today can hold a balance of a fraction below zero and
 * no fromNothing flag, and would keep reading as "Holding" until the cache
 * turned over tomorrow. Fixing it on the way out means the correction applies
 * to what is already stored, not only to what is computed next.
 */
function normalise(moves) {
  for (const m of Object.values(moves ?? {})) {
    if (!m?.covered || m.unitsThen == null) continue;
    if (m.unitsThen <= 0) {
      m.unitsThen = 0;
      m.fromNothing = true;
      m.pct = null;
    }
  }
  return moves;
}

/** What was worked out today for this token, so it is worked out once. */
export async function readCache({ chain, token, now = Date.now() } = {}) {
  if (!databaseAvailable()) return new Map();
  await ensureTable();
  const { rows } = await query(
    'SELECT holder, moves FROM holder_history WHERE chain = $1 AND token = $2 AND day = $3',
    [chain, String(token).toLowerCase(), dayOf(now)],
  );
  const out = new Map();
  for (const r of rows ?? []) {
    try { out.set(String(r.holder).toLowerCase(), normalise(JSON.parse(r.moves))); } catch { /* skip */ }
  }
  return out;
}

export async function writeCache({ chain, token, holder, moves, now = Date.now() } = {}) {
  if (!databaseAvailable()) return 0;
  await ensureTable();
  const day = dayOf(now);
  const key = String(token).toLowerCase();
  const who = String(holder).toLowerCase();
  await query('DELETE FROM holder_history WHERE chain = $1 AND token = $2 AND holder = $3 AND day = $4',
    [chain, key, who, day]);
  await query(
    'INSERT INTO holder_history (chain, token, holder, day, moves, at) VALUES ($1, $2, $3, $4, $5, $6)',
    [chain, key, who, day, JSON.stringify(moves), Math.floor(now / 1000)],
  );
  return 1;
}

/** Yesterday's rows and older are of no use to anybody. */
export async function prune({ now = Date.now(), keepDays = 3 } = {}) {
  if (!databaseAvailable()) return;
  await ensureTable();
  await query('DELETE FROM holder_history WHERE day < $1', [dayOf(now - keepDays * 86_400_000)]);
}

/* ── reading the chain ──────────────────────────────────────────────────── */

/**
 * One holder's movements of one token, newest first.
 *
 * A single page. The indexer takes about fifteen seconds to answer and the
 * card asks about twenty-five holders, so this is run with a concurrency cap
 * and a budget rather than in a loop.
 */
export async function fetchTransfers({
  host, holder, token, decimals = 18, fetcher = fetch, signal,
  reachBack = 30, maxPages = 4, now = Date.now(),
} = {}) {
  /**
   * Keep asking until the list reaches past the window, or the cap is hit.
   *
   * The busiest holders burn a page in a week — the largest LINK address spends
   * fifty transfers in nine days — so one page left them permanently
   * unanswerable while the quiet ones were answered from a single request. The
   * cap is what stops a very active wallet costing four times as much as
   * everybody else combined.
   */
  const cutoff = (now - reachBack * 86_400_000) / 1000;
  const base = `https://${host}/api/v2/addresses/${holder}/token-transfers`
    + `?type=ERC-20&token=${token}`;

  const transfers = [];
  let next = null;
  let pages = 0;
  let complete = false;
  let scale = 10 ** Number(decimals);

  do {
    const url = next ? `${base}&${new URLSearchParams(next)}` : base;
    const res = await fetcher(url, { signal: signal ?? AbortSignal.timeout(25_000) });
    if (!res.ok) throw new Error(`the indexer answered ${res.status}`);
    const body = await res.json();

    const items = body?.items ?? [];
    if (items[0]?.token?.decimals != null) scale = 10 ** Number(items[0].token.decimals);

    for (const t of items) {
      transfers.push({
        at: t.timestamp ? Math.floor(Date.parse(t.timestamp) / 1000) : 0,
        from: t.from?.hash ?? null,
        to: t.to?.hash ?? null,
        units: Number(t.total?.value ?? 0) / scale,
        hash: t.transaction_hash ?? null,
      });
    }

    pages += 1;
    next = body?.next_page_params ?? null;
    // No next page means the list is the whole history, however short.
    if (!next) { complete = true; break; }
    // Reaching past the cutoff is enough; the rest of the history is not needed.
    if (transfers.length && transfers[transfers.length - 1].at < cutoff) break;
  } while (pages < maxPages);

  return { transfers, complete, pages, full: transfers.length < PAGE };
}
