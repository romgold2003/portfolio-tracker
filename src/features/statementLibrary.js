/**
 * Several years of statements, kept as one history.
 *
 * A statement describes one window of the account. The journal is the whole of
 * it, so it is rebuilt from every window imported, one per calendar year:
 *
 *   open positions and cash   the newest year, which is the account today
 *   closed trades, deposits   every year, since each happened exactly once
 *   the transaction ledger    the unbroken run of years ending at the newest,
 *                             so a past day can be valued back to the first
 *
 * Years are the unit because they cannot overlap. Two files for the same year
 * are the same period, so the newer replaces the older; two different years
 * share no trades, so nothing can be counted twice. A file that straddles a
 * new year would break that, and is refused with a sentence saying why.
 *
 * ── Checking the years join up ───────────────────────────────────────────
 *
 * The broker states where each year closed and where the next one opened. A
 * year missing, or imported from a narrower export than the rest, shows up as
 * those two disagreeing — in value, or holding by holding — which is a far more
 * reliable test than anything that looks at the trades themselves.
 *
 * ── Splits ───────────────────────────────────────────────────────────────
 *
 * Prices from the history service are split-adjusted all the way back, so the
 * share counts before a split have to be expressed in after-split shares or a
 * past day is valued many times over. ETHU's 1-for-20 in April 2025 turned 257
 * shares into 12.85, and a January 2025 day priced 257 shares at a price
 * already divided by twenty would read as a twentieth of what it was worth.
 * Every movement dated before a split is scaled by it; the split's own two
 * legs are not movements at all and are left out.
 */
import { statementToJournal } from './ibkr.js';
import { journalFromTransactions } from './transactionBook.js';

/**
 * Where a year came from: an Interactive Brokers statement, which states its
 * own figures, or another broker's transaction history, from which they are
 * worked out. Years stored before the distinction existed are IBKR's.
 */
export const sourceOf = (record) => record?.kind ?? 'ibkr';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** A holding this close to zero has been sold out. */
const EMPTY = 1e-6;
/** Opening and closing values this far apart are the same number, rounded. */
const VALUE_TOLERANCE = 1;

const plain = (value) => (value instanceof Map ? Object.fromEntries(value) : { ...(value ?? {}) });

/**
 * A parsed statement as something that can be stored and merged later.
 *
 * Throws when the file cannot sit in a single year's slot.
 */
export function statementRecord(parsed) {
  const from = parsed?.periodStart;
  const to = parsed?.periodEnd;
  if (!DATE_ONLY.test(from ?? '') || !DATE_ONLY.test(to ?? '')) {
    throw new Error('Could not tell which dates this statement covers.');
  }
  if (from.slice(0, 4) !== to.slice(0, 4)) {
    throw new Error(`This statement runs from ${from} to ${to}, across more than one year. `
      + 'Export one calendar year per file, so each can sit in its own year.');
  }

  return {
    kind: 'ibkr',
    year: Number(from.slice(0, 4)),
    from,
    to,
    // Under the parser's own names too: the journal builder reads a stored
    // year exactly as it reads a freshly parsed file.
    periodStart: from,
    periodEnd: to,
    accounts: [...(parsed.accounts ?? [])],
    twr: Number.isFinite(parsed.twr) ? parsed.twr : null,
    positions: parsed.positions ?? [],
    closed: parsed.closed ?? [],
    firstBuy: plain(parsed.firstBuy),
    netQty: plain(parsed.netQty),
    ledger: parsed.ledger ?? [],
    transfers: parsed.transfers ?? [],
    dated: parsed.dated ?? [],
    flows: parsed.flows ?? [],
    splits: parsed.splits ?? [],
    openingCash: parsed.openingCash ?? null,
    openingHoldings: parsed.openingHoldings ?? {},
    openingMarks: parsed.openingMarks ?? {},
    cash: parsed.cash ?? null,
    accruals: parsed.accruals ?? 0,
    income: parsed.income ?? {},
    navChange: parsed.navChange ?? {},
  };
}

/**
 * The stored years with new ones added, oldest first.
 *
 * A year already present is replaced. Within one batch, two files for the same
 * year keep the one reaching later, so a year-to-date export picked alongside
 * an older one does not lose the recent months.
 */
export function withStatements(existing = [], incoming = []) {
  const batch = new Map();
  for (const record of incoming) {
    const held = batch.get(record.year);
    if (!held || record.to >= held.to) batch.set(record.year, record);
  }
  const byYear = new Map(existing.map((r) => [r.year, r]));
  for (const [year, record] of batch) byYear.set(year, record);
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

/** The stored years without one of them. */
export function withoutStatement(existing = [], year) {
  return existing.filter((r) => r.year !== year);
}

/** When something happened, finely enough to order a trade against a split. */
const momentOf = (event, fallbackTime = '00:00:00') => event.at ?? `${event.date} ${fallbackTime}`;

/** Every split across all the years, once each. */
export function allSplits(records) {
  const seen = new Map();
  for (const record of records) {
    for (const split of record.splits ?? []) {
      if (!split?.ticker || !(split.ratio > 0)) continue;
      seen.set(`${split.ticker}|${split.at}`, split);
    }
  }
  return [...seen.values()];
}

/** How many of today's shares one share held at `moment` has become. */
function splitFactor(splits, ticker, moment) {
  let factor = 1;
  for (const split of splits) {
    if (split.ticker === ticker && split.at > moment) factor *= split.ratio;
  }
  return factor;
}

function adjustEvent(event, splits) {
  if (!event.ticker || !Number.isFinite(event.qty)) return event;
  const factor = splitFactor(splits, event.ticker, momentOf(event));
  if (factor === 1) return event;
  const out = { ...event, qty: event.qty * factor };
  if (Number.isFinite(event.price) && event.price > 0) out.price = event.price / factor;
  return out;
}

function adjustQuantities(holdings, splits, moment) {
  const out = {};
  for (const [ticker, qty] of Object.entries(holdings ?? {})) {
    out[ticker] = qty * splitFactor(splits, ticker, moment);
  }
  return out;
}

function adjustPrices(marks, splits, moment) {
  const out = {};
  for (const [ticker, price] of Object.entries(marks ?? {})) {
    out[ticker] = price / splitFactor(splits, ticker, moment);
  }
  return out;
}

const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Whether each year picks up exactly where the one before it closed.
 *
 * One entry per adjacent pair, oldest first: `ok`, and a `reason` when not.
 */
export function chainReport(records) {
  const splits = allSplits(records);
  const links = [];

  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1];
    const next = records[i];
    const link = { from: prev.year, to: next.year, ok: true, value: next.navChange?.startNav ?? null };

    if (sourceOf(prev) !== sourceOf(next)) {
      links.push({
        ...link,
        ok: false,
        reason: 'One is an Interactive Brokers statement and the other a history from another broker, which cannot be joined.',
      });
      continue;
    }

    const gap = next.year - prev.year > 2 ? `${prev.year + 1}–${next.year - 1}` : `${prev.year + 1}`;

    /**
     * A transaction history states no balances to compare, so all that can be
     * checked between two of its years is that none is missing — and a year
     * with no file may simply be a year with no trades.
     */
    if (sourceOf(next) === 'transactions') {
      if (next.year !== prev.year + 1) {
        links.push({ ...link, ok: false, reason: `No file for ${gap} — fine if there were no trades that year.` });
      } else {
        links.push({ ...link, value: null });
      }
      continue;
    }

    if (next.year !== prev.year + 1) {
      links.push({ ...link, ok: false, reason: `No statement for ${gap}.` });
      continue;
    }

    const closed = prev.navChange?.endNav;
    const opened = next.navChange?.startNav;
    if (Number.isFinite(closed) && Number.isFinite(opened) && Math.abs(closed - opened) > VALUE_TOLERANCE) {
      links.push({
        ...link,
        ok: false,
        reason: `${prev.year} closed at ${money(closed)} but ${next.year} opens at ${money(opened)} — `
          + 'one of them may cover a different set of accounts or a shorter period.',
      });
      continue;
    }

    const closing = adjustQuantities(
      Object.fromEntries((prev.positions ?? []).map((p) => [p.ticker, p.qty])),
      splits,
      `${prev.to} 23:59:59`,
    );
    const opening = adjustQuantities(next.openingHoldings, splits, `${next.from} 00:00:00`);
    const differ = [...new Set([...Object.keys(closing), ...Object.keys(opening)])]
      .filter((t) => Math.abs((closing[t] ?? 0) - (opening[t] ?? 0)) > EMPTY)
      .slice(0, 3)
      .map((t) => `${t} ${+(closing[t] ?? 0).toFixed(4)} vs ${+(opening[t] ?? 0).toFixed(4)}`);
    if (differ.length) {
      links.push({
        ...link,
        ok: false,
        reason: `${prev.year} did not close holding what ${next.year} opens with (${differ.join(', ')}).`,
      });
      continue;
    }

    links.push(link);
  }

  return links;
}

/**
 * When the holding each day belongs to began.
 *
 * Walks every share movement in order and notes each moment a ticker went from
 * holding nothing to holding something. A holding already open when the
 * history begins has no such moment inside it, and is reported as unknown
 * rather than dated to the first day on record.
 */
function holdingStarts(openingHoldings, events) {
  const qty = new Map(Object.entries(openingHoldings ?? {}));
  const starts = new Map();
  for (const [ticker, held] of qty) {
    if (Math.abs(held) > EMPTY) starts.set(ticker, [{ date: null, until: null }]);
  }

  for (const event of events) {
    if (!event.ticker || !Number.isFinite(event.qty)) continue;
    const before = qty.get(event.ticker) ?? 0;
    const after = before + event.qty;
    qty.set(event.ticker, after);
    const runs = starts.get(event.ticker) ?? [];
    if (Math.abs(before) <= EMPTY && Math.abs(after) > EMPTY) {
      runs.push({ date: event.date, until: null });
      starts.set(event.ticker, runs);
    } else if (Math.abs(before) > EMPTY && Math.abs(after) <= EMPTY && runs.length) {
      runs[runs.length - 1].until = event.date;
    }
  }
  return starts;
}

/** The start of the run of a holding that was open on `day`, or undefined. */
function runOn(starts, ticker, day) {
  const runs = starts.get(ticker) ?? [];
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i];
    if ((run.date === null || run.date <= day) && (run.until === null || run.until >= day)) return run;
  }
  return undefined;
}

/** A journal rebuilt from every imported year. */
export function journalFromStatements(records, existing = {}) {
  if (!records?.length) throw new Error('There are no statements to build from.');
  const sorted = [...records].sort((a, b) => a.year - b.year);

  const sources = new Set(sorted.map(sourceOf));
  if (sources.size > 1) {
    throw new Error('Interactive Brokers statements and histories from other brokers cannot be combined in one journal. '
      + 'Import files from one source, or remove the other years first.');
  }
  if (sources.has('transactions')) return journalFromTransactions(sorted, existing);

  const latest = sorted[sorted.length - 1];
  const splits = allSplits(sorted);
  const links = chainReport(sorted);

  // The unbroken years ending at the newest: the only ones a single forward
  // walk can cross without inventing what happened in a gap.
  let first = sorted.length - 1;
  while (first > 0 && links[first - 1].ok) first -= 1;
  const run = sorted.slice(first);

  const events = run.flatMap((r) => [
    ...(r.ledger ?? []).map((t) => adjustEvent({ ...t, kind: 'trade' }, splits)),
    ...(r.transfers ?? []).map((t) => adjustEvent(t, splits)),
    ...(r.flows ?? []).map((f) => ({ date: f.date, kind: 'flow', cash: f.amount })),
    ...(r.dated ?? []),
  ]).sort((a, b) => momentOf(a).localeCompare(momentOf(b)));

  const openingHoldings = adjustQuantities(run[0].openingHoldings, splits, `${run[0].from} 00:00:00`);
  const starts = holdingStarts(openingHoldings, events);

  const base = statementToJournal(latest, existing);
  const stamp = Date.now() * 1000;

  /**
   * Every row dated to when its holding actually began, wherever that is known.
   *
   * A single statement can only date a purchase that is inside it, so a holding
   * bought in one year and sold the next came back opened on the day it was
   * sold, and one sold out and bought again within a year was dated to the
   * first purchase rather than the second. Its own guess at whether a holding
   * was carried in also counts shares in whatever units they traded in, which a
   * split in that year turns into nonsense. The walk across all the years has
   * none of those problems: it saw the holding go from nothing to something.
   *
   * A holding that was already open when the history begins has no such
   * moment, and keeps what its statement said.
   */
  const closed = sorted.flatMap((record) => {
    const journal = record === latest ? base : statementToJournal(record, existing);
    return journal.positions.filter((p) => p.status === 'Closed').map((row) => {
      const started = runOn(starts, row.ticker, row.close)?.date;
      return started ? { ...row, open: started } : row;
    });
  });

  const open = base.positions.filter((p) => p.status === 'Open').map((position) => {
    const started = runOn(starts, position.ticker, latest.to)?.date;
    return started ? { ...position, open: started, carriedIn: false } : position;
  });

  const positions = [...closed, ...open].map((p, i) => ({ ...p, id: stamp + i + 1 }));

  return {
    ...base,
    positions,
    cashFlows: sorted.flatMap((r) => r.flows ?? []).sort((a, b) => a.date.localeCompare(b.date)),
    ledger: {
      from: run[0].from,
      to: latest.to,
      openingCash: run[0].openingCash,
      openingHoldings,
      openingMarks: adjustPrices(run[0].openingMarks, splits, `${run[0].from} 00:00:00`),
      events: events.map(({ at, ...rest }) => rest),
      holdings: base.ledger?.holdings ?? {},
    },
    statements: sorted,
  };
}

/**
 * The latest year the journal already knows about, whatever its source.
 *
 * Used to refuse an import that would rebuild today's book out of an old
 * statement: adding 2024 alone to a journal holding 2026 would otherwise put
 * the account back to December 2024.
 */
export function newestYearIn(journal) {
  let newest = 0;
  const note = (date) => {
    if (typeof date === 'string' && DATE_ONLY.test(date)) newest = Math.max(newest, Number(date.slice(0, 4)));
  };
  for (const p of journal?.positions ?? []) { note(p.open); note(p.close); }
  note(journal?.ledger?.to);
  note(journal?.openingNav?.through);
  note(journal?.openingNav?.date);
  for (const r of journal?.statements ?? []) note(r.to);
  return newest || null;
}
