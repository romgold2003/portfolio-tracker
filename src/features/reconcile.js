/**
 * Checking what was rebuilt against what the broker said.
 *
 * The statement is the source of truth. It states the account's cash, what its
 * holdings are worth, what was paid in, and what the whole thing came to — and
 * none of those owe anything to this app's arithmetic. So after a file is read
 * and a journal is built from it, the two are set side by side and any
 * difference is named.
 *
 * This exists because of how the failures actually arrive. A file whose cash is
 * read from one account of two produces an account $4,900 light; a file whose
 * accrued dividends are looked for under the wrong words produces one $5.07
 * light. Neither looks like a bug from inside the app — the figures are
 * plausible, the page renders, nothing throws. They look like a bug six weeks
 * later, when someone notices the total does not match their broker and nobody
 * can say since when. Both of those would have been caught here on the day.
 *
 * What it deliberately does not do is adjust anything. A difference is reported,
 * never absorbed: an import that silently corrects itself to the broker's total
 * would hide the very thing this is for.
 */

import { accountTotals } from '../core/portfolio.js';

/**
 * How far apart two figures may be and still count as the same number.
 *
 * A statement's own lines are rounded to the cent and its totals are sums of
 * them, so a few cents can separate two correct answers on a large account.
 * Anything beyond that is a discrepancy, not rounding.
 */
export const tolerance = (reported) => Math.max(0.05, Math.abs(reported ?? 0) * 1e-6);

const check = (id, label, reported, rebuilt, note) => {
  if (!Number.isFinite(reported) || !Number.isFinite(rebuilt)) return null;
  const diff = rebuilt - reported;
  const limit = tolerance(reported);
  return { id, label, reported, rebuilt, diff, tolerance: limit, ok: Math.abs(diff) <= limit, note };
};

/**
 * Every figure the statement states, against the same figure rebuilt.
 *
 * Returns null when the file states none of them — another broker's
 * transaction history has no net asset value block, and there is nothing
 * honest to check it against. That is a different answer from "it reconciles",
 * and the caller is told which.
 */
export function reconcileStatement(parsed, journal) {
  const nav = parsed?.navReported;
  const navChange = parsed?.navChange ?? {};
  if (!nav && navChange.endNav == null) return null;

  const open = (journal?.positions ?? []).filter((p) => p.status === 'Open');
  const totals = accountTotals(journal?.positions ?? [], journal?.cash ?? 0);
  const flows = (journal?.cashFlows ?? []).reduce((sum, f) => sum + (Number(f.amount) || 0), 0);

  /**
   * The cash balance rebuilt from every movement rather than read off the
   * statement's own line. This is the one check that exercises the whole
   * transaction ledger: if a trade, a fee or a dividend was misread, the
   * closing balance will not land where the broker says it did.
   */
  const ledgerCash = (parsed?.ledger ?? []).reduce((sum, t) => sum + (Number(t.cash) || 0), 0);
  const transferCash = (parsed?.transfers ?? []).reduce((sum, t) => sum + (Number(t.cash) || 0), 0);
  const income = (navChange.dividends ?? 0) + (navChange.interest ?? 0) + (navChange.tax ?? 0);
  const chained = Number.isFinite(parsed?.openingCash)
    ? parsed.openingCash + ledgerCash + transferCash + flows + income
    : null;

  const checks = [
    check('cash', 'Cash balance', nav ? nav.cash + nav.accruals : null, journal?.cash,
      'the broker carries accrued dividends and interest with cash, and so does this'),
    check('positions', 'Holdings at the closing marks', nav?.positions, totals.positionsValue,
      `${open.length} open position${open.length === 1 ? '' : 's'}`),
    check('nav', 'Net asset value', nav?.total ?? navChange.endNav, totals.account,
      'cash and holdings together, which is what the broker calls the account'),
    check('deposits', 'Money paid in and taken out', navChange.deposits, flows,
      'deposits less withdrawals, over the whole period'),
    check('ledger', 'Cash rebuilt from every movement', nav ? nav.cash : null, chained,
      'opening balance, then every trade, transfer, deposit, dividend, fee and tax'),
    check('opening', 'Value the period opened at', navChange.startNav,
      parsed?.openingCash != null && parsed?.openingMarks
        ? parsed.openingCash + openingHoldingsValue(parsed)
        : null,
      'opening cash plus what was held, at the marks the statement gives'),
  ].filter(Boolean);

  const failed = checks.filter((c) => !c.ok);
  return {
    checks,
    failed,
    ok: failed.length === 0,
    /** The largest unexplained difference, which is the one worth naming first. */
    worst: failed.slice().sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))[0] ?? null,
  };
}

/** What the statement says was held when the period opened, at its own marks. */
function openingHoldingsValue(parsed) {
  const holdings = parsed.openingHoldings ?? {};
  const marks = parsed.openingMarks ?? {};
  let total = 0;
  for (const [ticker, qty] of Object.entries(holdings)) {
    const price = Number(marks[ticker]);
    if (Number.isFinite(price) && Number.isFinite(qty)) total += qty * price;
  }
  return total;
}

/** The report as lines of text, for the import preview and for a test to read. */
export function reconciliationLines(report) {
  if (!report) return ['This file states no account totals, so there is nothing to check it against.'];
  const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return report.checks.map((c) => (c.ok
    ? `${c.label}: matches the statement at ${money(c.reported)}.`
    : `${c.label}: the statement says ${money(c.reported)}, this reads ${money(c.rebuilt)} — `
      + `${money(Math.abs(c.diff))} ${c.diff > 0 ? 'more' : 'less'}, which is not rounding.`));
}
