/** The overview page: account value, today's move, KPIs and a compact watchlist. */
import { state } from '../../core/store.js';
import {
  accountTotals, dailyPortfolioMove, unreal, costOf, pctD,
  dailyDollar, dailyDollarExits, dailyDollarTotal, sortPositions, todayStr,
  sectorBreakdown, accountPerformance,
} from '../../core/portfolio.js';
import { regularSessionOpen, extendedPricingAvailable, tradingDayOver } from '../../services/extendedHours.js';
import { lastClosedSession } from '../../config/marketCalendar.js';
import { ui } from '../uiState.js';
import { renderCurve, renderSectorChart } from '../charts.js';
import {
  benchmarkSeries, benchmarkKey, benchmarkFailure,
  benchmarkSpot, benchmarkYearToDate,
} from '../../services/benchmark.js';
import {
  pricesOn, dailySeries, historySymbol, closeOnOrBefore as closeAtOrBefore,
} from '../../services/history.js';
import {
  periodStart, cutoffFor, setBackfill, authoritativeHistory, windowEnd,
} from '../../core/snapshots.js';
import {
  yearToDateReturn as measuredYearToDate, asTradedClose, allTimeFromDeposits,
} from '../../core/portfolioHistory.js';
import { splitsOf } from '../../services/history.js';
import { allSplits, historyGaps, gapInWindow } from '../../features/statementLibrary.js';
import { onJournalLoaded, combinedJournals } from '../../core/store.js';
import { chainedBrokerReturn } from '../../features/statementLibrary.js';
import { rebuildDailyValue } from '../../core/rebuild.js';
import {
  buildPortfolioHistory, periodReturnFromHistory, combineHistories, withManualFlows, manualFlowsBetween,
} from '../../core/portfolioHistory.js';
import {
  money as $u, signedMoney as $s, pctText as fp, pnlColor as clr,
  fmtPrice, escapeHtml,
} from '../format.js';

const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
const setColor = (id, color) => { const el = document.getElementById(id); if (el) el.style.color = color; };

/** Currency rounding, matching what the history dataset stores. */
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Hiding the figures, for when someone can see the screen.
 *
 * Only the amounts that reveal how much money is here are masked — the account
 * value, cash, the gain and unrealised P&L. Percentages, tickers and the
 * allocation stay visible, because they give away nothing about size and
 * blanking them would leave an app you cannot use.
 *
 * The choice is remembered: someone who hid the numbers on a train wants them
 * still hidden when they reopen the tab, not exposed by a reload.
 */
export const MASK = '••••••';
const HIDDEN_KEY = 'pt_hide_amounts';

let hidden = (() => {
  try { return localStorage.getItem(HIDDEN_KEY) === '1'; } catch { return false; }
})();

export function amountsHidden() { return hidden; }

export function toggleAmounts() {
  hidden = !hidden;
  try { localStorage.setItem(HIDDEN_KEY, hidden ? '1' : '0'); } catch { /* ignore */ }
  renderHome();
}

/** Keep the eye in step with what it is currently doing. */
function renderPrivacyToggle() {
  const button = document.getElementById('hideAmounts');
  if (!button) return;
  button.textContent = hidden ? '🙈' : '👁';
  button.title = hidden ? 'Show amounts' : 'Hide amounts';
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-pressed', String(hidden));
}

/** Header row above the compact position list. */
const HEAD = 'font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.04em';
const LIST_HEADER = `<div class="mini-grid" style="margin-bottom:6px;padding:0 2px">
  <div style="${HEAD}">Asset</div>
  <div style="${HEAD};text-align:center">D%</div>
  <div class="mini-ytd" style="${HEAD};text-align:center">YTD %</div>
  <div style="${HEAD};text-align:right">P&L</div>
</div>`;

/**
 * Says when a price came from outside regular hours.
 *
 * Without it an after-hours print is indistinguishable from the closing price,
 * and the two mean different things — one is live, the other is history.
 */
function extBadge(p) {
  if (!p.extPhase) return '';
  const label = p.extPhase === 'pre' ? 'PRE' : 'AFTER';
  return `<span class="ext-badge" title="Traded outside regular hours">${label}</span>`;
}

/**
 * How far a holding has moved this year.
 *
 * From last year's close for something held since before January, and from what
 * was paid for anything bought since — a position opened in March has no
 * January price, and its whole move is this year's.
 *
 * The price move is what is shown, coloured for the position, so a short whose
 * price fell reads as the gain it is. Null when the history has not loaded yet,
 * which shows as a dash rather than a wrong number.
 */
function ytdPct(p) {
  const year = new Date().getFullYear();
  const start = p.open && p.open >= `${year}-01-01` ? p.entry : pastPrice(p.ticker, `${year - 1}-12-31`);
  if (!(start > 0) || !(p.cur > 0)) return null;
  return ((p.cur - start) / start) * 100;
}

function miniRow(p) {
  const pnl = unreal(p);
  const retPct = pctD(pnl, costOf(p));
  const daily = p.dailyChg ?? null;
  const ytd = ytdPct(p);
  const dailyMoney = dailyDollar(p) == null && dailyDollarExits(p) === 0
    ? null
    : dailyDollarTotal(p);

  // Colour the % by what it means for THIS position: a short gains when the
  // price falls, so the raw percentage and its colour can disagree.
  const dailySign = daily == null ? 0 : (p.dir === 'Long' ? daily : -daily);
  const dailyText = daily != null
    ? `<span style="color:${clr(dailySign)}">${fp(daily)}</span>`
    : '<span style="color:var(--text4)">—</span>';
  const ytdSign = ytd == null ? 0 : (p.dir === 'Long' ? ytd : -ytd);
  const ytdText = ytd != null
    ? `<span style="color:${clr(ytdSign)}">${fp(ytd)}</span>`
    : '<span style="color:var(--text4)">—</span>';

  return `<div class="mini-row mini-grid">
    <div class="mini-asset">
      <span class="mini-tk">${escapeHtml(p.ticker)}</span>
      <span class="mini-dir d-${p.dir.toLowerCase()}">${p.dir}</span>
      <span class="mini-price" style="color:${daily == null ? 'var(--text3)' : clr(dailySign)}">$${fmtPrice(p.cur)}</span>${extBadge(p)}
    </div>
    <div class="mini-col">
      ${dailyText}
      ${dailyMoney != null ? `<div style="font-size:10px;color:${clr(dailyMoney)};margin-top:2px">${$s(+dailyMoney.toFixed(2))}</div>` : ''}
    </div>
    <div class="mini-col mini-ytd">${ytdText}</div>
    <div class="mini-pnl">
      <div class="mini-tk" style="color:${clr(pnl)}">${$s(pnl)}</div>
      <div style="font-size:10px;color:${clr(retPct)}">${fp(retPct)}</div>
    </div>
  </div>`;
}

/** The active journal's ledger events plus the money it moved by hand. */
function eventsWithManualFlows(journal = state) {
  return withManualFlows(journal?.ledger?.events, journal?.cashFlows);
}

/** Money moved by hand between a day and today, for the row that ends the walk. */
function manualFlowsAfter(journal, after, upTo) {
  return manualFlowsBetween(journal?.cashFlows, after, upTo);
}

/**
 * Which day the figure beneath this heading is actually describing.
 *
 * The American session ends at eight in the evening in New York — three in the
 * morning in Israel — and nothing trades again until pre-market at four, which
 * is eleven in the morning there. Through those eight hours the figures are
 * deliberately held where the day left them, because nothing has happened to
 * move them.
 *
 * What was wrong was the word above them. At ten in the morning the box said
 * "Today" over Wednesday's move, and there was no way to tell from the screen
 * that the number was a finished day rather than a quiet one. So the heading
 * names the session instead, and goes back to saying "Today" when pre-market
 * opens and the figure starts meaning today again.
 *
 * Crypto never stops, so a book holding only crypto is always looking at today
 * and is left alone.
 */
export function dailyHeading() {
  const holdsStocks = state.positions.some((p) => p.status === 'Open' && p.cls !== 'Crypto');
  if (!holdsStocks || !tradingDayOver()) return 'Today';
  const [y, m, d] = lastClosedSession().split('-').map(Number);
  const when = new Date(Date.UTC(y, m - 1, d));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][when.getUTCDay()];
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  return `Last session · ${day} ${d} ${month}`;
}

function renderDailyMove(totals) {
  // The ledger prices the shares bought and sold on the day, as the broker does.
  const move = dailyPortfolioMove(state.positions, totals.account, undefined, eventsWithManualFlows());
  const pctEl = document.getElementById('portfolioDailyPct');
  const amtEl = document.getElementById('portfolioDailyAmt');
  setText('dailyLabel', dailyHeading());
  if (!pctEl || !amtEl) return;

  if (!move.hasData) {
    pctEl.textContent = '—';
    pctEl.style.color = 'var(--text3)';
    amtEl.textContent = 'loading…';
    amtEl.style.color = 'var(--text3)';
    return;
  }

  pctEl.textContent = fp(move.percent);
  pctEl.style.color = clr(move.percent);

  // Today's move in currency is masked with the rest: left visible it sits
  // beside its own percentage, and the two together give the account size away.
  if (hidden) {
    amtEl.textContent = MASK;
    amtEl.style.color = 'var(--text3)';
    return;
  }

  const notes = [];
  if (move.sold !== 0) notes.push(`incl. ${$s(+move.sold.toFixed(2))} sold`);
  if (move.pending > 0) notes.push(`${move.pending} pending`);
  amtEl.textContent = $s(+move.dollars.toFixed(2)) + (notes.length ? ' · ' + notes.join(' · ') : '');
  amtEl.style.color = clr(move.dollars);
}

/**
 * Sector allocation: the doughnut plus its legend.
 *
 * Every sector is listed even when its wedge is too thin to carry a label, so
 * the small holdings are still readable somewhere.
 */
function renderAllocation() {
  const rows = sectorBreakdown(state.positions, state.cash);
  renderSectorChart(rows);

  const legend = document.getElementById('sectorLegend');
  if (!legend) return;
  legend.innerHTML = rows.map((r) => `<div class="alloc-row">
      <span class="alloc-dot" style="background:${r.colour}"></span>
      <span class="alloc-name">${escapeHtml(r.name)}</span>
      <span class="alloc-pct">${r.pct.toFixed(1)}%</span>
    </div>`).join('');
}

/**
 * The year, for the market and for you. Fixed.
 *
 * This corner deliberately ignores the timeframe buttons. Those drive the chart
 * and the KPIs below, and having the scoreboard flicker between a week and a
 * year as you scrubbed through them made it useless as a reference — the thing
 * you look up at is meant to be the one number that stays still.
 *
 * So both rows are the year: the index from 1 January, and your account from 1
 * January or the day it opened, whichever is later. Those coincide from 2027,
 * and until then yours is the honest window rather than a year you were not
 * invested for.
 */
async function renderBenchmark(totals) {
  const valEl = document.getElementById('benchVal');
  const mineEl = document.getElementById('benchMine');
  const noteEl = document.getElementById('benchNote');
  if (!valEl || !mineEl || !noteEl) return;

  const mine = yearToDateReturn(totals);
  mineEl.textContent = mine.returnPct == null ? '—' : fp(mine.returnPct);
  mineEl.style.color = mine.returnPct == null ? 'var(--text3)' : clr(mine.returnPct);
  mineEl.title = describeOwnYear(mine);

  const clear = () => { noteEl.textContent = ''; noteEl.title = ''; };

  const rows = await benchmarkSeries();
  if (!rows) {
    valEl.textContent = '—';
    valEl.style.color = 'var(--text3)';
    // The note carries failures only. Saying what actually went wrong beats
    // "unavailable" for anyone who has just pasted a key and is wondering
    // whether they typed it wrong or spent the day's quota.
    noteEl.textContent = benchmarkKey()
      ? (benchmarkFailure() || 'Market data unavailable right now')
      : 'Add a market data key in settings to compare';
    noteEl.title = noteEl.textContent;
    return;
  }

  // Live rather than last night's close, so the index is read at the same
  // moment as the account it is being put beside.
  const marketReturn = benchmarkYearToDate(rows, benchmarkSpot());
  if (marketReturn == null) {
    valEl.textContent = '—';
    valEl.style.color = 'var(--text3)';
    noteEl.textContent = 'No index data for this year';
    noteEl.title = noteEl.textContent;
    return;
  }

  valEl.textContent = fp(marketReturn);
  valEl.style.color = clr(marketReturn);
  valEl.title = `S&P 500 since 1 January ${new Date().getFullYear()}`;
  clear();
}

/**
 * The account's own return for the year.
 *
 * Worked out from the trades rather than from the account curve. The curve only
 * began when the app was first opened, so it cannot see a year of trading
 * entered afterwards — it reported the same figure whether the year had made
 * sixty thousand or nothing, which is no use as the number sat beside the
 * market's own.
 *
 * `startPrices` is filled in the background for holdings carried in from an
 * earlier year; until it arrives those are left out, so the figure can rise
 * slightly on the second pass rather than starting overstated.
 */
let startPrices = new Map();

/** Price history per ticker, for reconstructing the days before the recording. */
let priceHistories = new Map();
let backfillPending = false;
/**
 * The book the back-cast was last built for.
 *
 * Not a plain "done" flag. The page renders once on load with no positions —
 * signed out, or before the vault is open — and a flag set then latched
 * permanently, so the rebuild never ran for the real book and the curve stayed
 * exactly as short as before. Keyed on the book instead, so it runs when there
 * is something to run for and again if the positions change.
 */
let backfillFor = null;

/**
 * A run that came back with price histories missing, and when to try again.
 *
 * Latching such a run kept that device's returns built without those tickers
 * for the rest of the session, while another device that loaded them all showed
 * different percentages on the same account value.
 */
let backfillTriedFor = null;
let backfillRetryAt = 0;
let backfillAttempts = 0;

/**
 * Which journal the history and prices above were worked out for.
 *
 * Replacing one imported history with another left the old account's returns
 * on screen, because the daily history they are measured from was still the old
 * one until a rebuild noticed — and a rebuild already running for the old book
 * could finish after the swap and put its figures back. So a new journal throws
 * all of it away at once: the returns show nothing until the new history is
 * built, and a run started for the old book is discarded when it lands.
 */
let journalGeneration = 0;

onJournalLoaded(() => {
  journalGeneration += 1;
  backfillFor = null;
  backfillTriedFor = null;
  backfillRetryAt = 0;
  backfillAttempts = 0;
  startPrices = new Map();
  setBackfill([]);
});

/**
 * Rebuild the account value for the days the app was not open.
 *
 * The recorded curve starts the day this app was first used. The trades, the
 * cash flows and the broker statement all reach further back, so every figure
 * beside the chart covered a longer period than the chart did — a YTD curve
 * drew six weeks while the KPI counted the year.
 *
 * One history per ticker held at any point this year, priced through the same
 * service the rest of the app uses, and a value worked out for every day. It
 * runs once: a past close never changes.
 */
async function loadBackfill() {
  if (backfillPending) return;
  const generation = journalGeneration;

  const earliest = earliestInterest();
  if (!earliest) return;

  /**
   * Every ticker that needs a price, from the ledger when there is one.
   *
   * The ledger names tickers the positions no longer mention — a holding
   * carried in from last year and sold in January is a closed row in money, but
   * the ledger still knows it was 250 shares and when they went.
   */
  const ledgers = state.combined ? combinedJournals().map((j) => j.ledger).filter(Boolean) : [state.ledger].filter(Boolean);
  const fromLedger = ledgers.length
    ? [...new Set(ledgers.flatMap((ledger) => [
      ...Object.keys(ledger.openingHoldings ?? {}),
      ...Object.keys(ledger.holdings ?? {}),
      ...(ledger.events ?? []).map((e) => e.ticker),
    ]).filter(Boolean))]
    : [];
  /**
   * Every ticker the book has ever touched, with no date filter on it.
   *
   * The filter that used to be here required a non-null `open`, which is
   * precisely what a holding carried in from an earlier year does not have.
   * So the sixteen holdings that were ninety per cent of January were the ones
   * left out of the price fetch; unpriced, they counted as stale, every
   * reconstructed day was dropped for being mostly guesswork, and the curve
   * fell back to the recorded snapshots and began in August — the exact
   * symptom this was all meant to fix.
   *
   * Fetching a ticker that turns out not to be needed costs one cached request.
   * Missing one costs the year.
   */
  const tickers = fromLedger.length
    ? [...new Set([...fromLedger, ...(state.combined ? state.positions.map((p) => p.ticker) : [])])]
    : state.positions.map((p) => p.ticker);

  const wanted = [...new Map(tickers.filter(Boolean).map((ticker) => {
    const position = state.positions.find((p) => p.ticker === ticker);
    return [historySymbol(ticker, position?.cls), ticker];
  })).entries()];
  if (!wanted.length) return;

  /** What this run would be built from. Unchanged means nothing to redo. */
  const key = `${earliest}|${state.cash}|${wanted.map(([sym]) => sym).sort().join(',')}|`
    + `${state.positions.length}|${(state.cashFlows ?? []).length}|`
    + `${(state.ledger?.events ?? []).length}`;
  if (key === backfillFor) return;
  if (key !== backfillTriedFor) backfillAttempts = 0;
  // A run that came back short is tried again, but not on every redraw.
  if (key === backfillTriedFor && Date.now() < backfillRetryAt) return;

  backfillPending = true;
  try {
    // Six at a time rather than every ticker at once, so a burst is not refused.
    const loaded = await inBatches(wanted, 6, ([symbol]) => dailySeries(symbol)
      .then((rows) => [symbol, rows])
      .catch(() => [symbol, null]));
    for (const [symbol, rows] of loaded) if (rows?.length) priceHistories.set(symbol, rows);
    const unpriced = loaded.filter(([, rows]) => !rows?.length).length;
    // The journal was replaced while these loaded: this run is for a book that is gone.
    if (generation !== journalGeneration) return;

    /**
     * The ledger when the broker gave us one, the positions otherwise.
     *
     * The positions record realised profit in money, which is what a journal
     * needs and what a statement reports — but it means a partly sold holding
     * comes back with no share count, and a holding carried in from last year
     * and bought into again during the period leaves no record of that
     * purchase anywhere. Reconstructing a past day from them was out by seven
     * per cent on average and nineteen on the first of January. From the
     * ledger it is out by a tenth of one per cent.
     */
/**
     * Forward from the statement's opening balance when there is one.
     *
     * That is the broker's own arithmetic — holdings at the day's marks plus
     * cash, rolled forward through every dated event — and it reproduces the
     * statement it came from exactly at the open and to within a fifth of a
     * per cent at the close.
     *
     * The older path infers a past day by undoing today, which is all that can
     * be done without a statement, and is kept for books that have none.
     */
    const ledger = state.ledger;
    /**
     * All accounts: each sub-account's own daily value, added day by day, as a
     * broker consolidates linked accounts. The combined return is then measured
     * on the combined balance, not averaged from each account's return.
     */
    const forward = state.combined
      ? combineHistories(combinedJournals().map((j) => journalHistory(j, earliest)))
      : ledger?.openingCash != null && ledger.from
      ? buildPortfolioHistory({
        opening: {
          date: ledger.from, cash: ledger.openingCash, holdings: ledger.openingHoldings,
        },
        events: eventsWithManualFlows(state),
        priceOn: pastPrice,
        lastKnown: datedMarks(ledger),
        from: earliest,
        to: historyEnd(),
      })
      : null;

    if (forward?.length) {
      /**
       * Today is known exactly, so it is not left at yesterday's close.
       *
       * Every other day in the walk is marked at the last close the price
       * service has, which for today is usually the previous session. The
       * account value beside the chart is the live one, and a curve ending four
       * hundred dollars below the number printed above it reads as a bug.
       */
      const live = accountTotals(state.positions, state.cash).account;
      const today = todayStr();
      const last = forward[forward.length - 1];
      if (live > 0 && last) {
        const row = { ...last, date: today };
        row.totalAccountValue = round2(live);
        row.cashValue = round2(state.cash);
        row.positionsValue = round2(live - state.cash);
        if (last.date === today) forward[forward.length - 1] = row;
        else {
          const moved = round2(manualFlowsAfter(state, last.date, today));
          forward.push({
            ...row,
            externalCashFlow: moved,
            deposit: Math.max(moved, 0),
            withdrawal: Math.min(moved, 0),
          });
        }
      }
      setBackfill(forward, { authoritative: true });
    } else {
      setBackfill(rebuildDailyValue({
        positions: state.positions,
        cash: state.cash,
        flows: state.cashFlows,
        priceOn: pastPrice,
        from: earliest,
        to: todayStr(),
      }).map((r) => ({ date: r.date, totalAccountValue: r.value })));
    }
    /**
     * Histories still missing: build with what arrived, and come back for the
     * rest a little later, three times at most — a ticker the price service
     * genuinely does not carry should not be asked for all session.
     */
    if (unpriced && backfillAttempts < 3) {
      backfillAttempts += 1;
      backfillTriedFor = key;
      backfillRetryAt = Date.now() + 15000 * backfillAttempts;
      setTimeout(() => renderHome(), 15000 * backfillAttempts + 50);
    } else {
      backfillFor = key;
    }
    renderHome();
  } finally {
    backfillPending = false;
    // Started for a journal since replaced: build straight away for the one loaded now.
    if (generation !== journalGeneration) setTimeout(() => renderHome(), 0);
  }
}

/** One sub-account's daily value, for the combined view. */
function journalHistory(journal, earliest) {
  /**
   * Ended at the account's own live value, as a single account's history is.
   * An account with no priced days then still joins the sum as money brought
   * in on the day it appears, rather than its whole value landing as profit.
   */
  const rows = journalDays(journal, earliest);
  const live = accountTotals(state.positions.filter((p) => p.account === journal.id), journal.cash).account;
  const today = todayStr();
  const last = rows[rows.length - 1];
  if (last?.date === today) rows[rows.length - 1] = { ...last, totalAccountValue: round2(live) };
  else if (live !== 0 || last) {
    rows.push({
      date: today,
      totalAccountValue: round2(live),
      externalCashFlow: round2(manualFlowsAfter(journal, last?.date ?? '', today)),
    });
  }
  return rows;
}

function journalDays(journal, earliest) {
  const ledger = journal.ledger;
  if (ledger?.openingCash != null && ledger.from) {
    return buildPortfolioHistory({
      opening: { date: ledger.from, cash: ledger.openingCash, holdings: ledger.openingHoldings },
      events: eventsWithManualFlows(journal),
      priceOn: pastPrice,
      lastKnown: datedMarks(ledger),
      from: earliest,
      to: historyEnd(journal.statements),
    });
  }
  const flows = new Map();
  for (const f of journal.cashFlows ?? []) flows.set(f.date, (flows.get(f.date) ?? 0) + f.amount);
  return rebuildDailyValue({
    positions: journal.positions,
    cash: journal.cash,
    flows: journal.cashFlows,
    priceOn: pastPrice,
    from: earliest,
    to: todayStr(),
  }).map((r) => ({ date: r.date, totalAccountValue: r.value, externalCashFlow: flows.get(r.date) ?? 0 }));
}

/** The earliest day worth rebuilding: the start of the longest window offered. */
function earliestInterest() {
  const dates = state.positions.flatMap((p) => [p.open, p.close]).filter(Boolean);
  for (const f of state.cashFlows ?? []) if (f?.date) dates.push(f.date);
  /**
   * A book of nothing but holdings carried in from an earlier year has no dates
   * on it at all, and returning null there gave up before starting. There is
   * still a year to draw: those holdings were held through every day of it.
   */
  if (!dates.length && !state.positions.length) return null;
  const firstTrade = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;

  /**
   * Far enough back that every button is answered in full.
   *
   * The first trade alone is not enough: YTD means the first of January, and an
   * account whose first trade of the year was on the eighth would report from
   * the eighth and be flagged as a short window. The days before it are not a
   * guess — the book was cash, and cashOn() knows exactly how much.
   *
   * Floored at three years because that is what the history service fetches;
   * asking for days it cannot price would only produce days that get dropped.
   */
  const back = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const janFirst = `${new Date().getUTCFullYear()}-01-01`;

  /**
   * The first trade or the first of January, whichever came first — and no
   * earlier.
   *
   * Padding back a full year regardless would give "All" months of flat cash
   * before the account existed, which reads as a longer track record than there
   * is. A window the account genuinely predates is a window it cannot answer,
   * and the note under the chart says so rather than the curve inventing it.
   */
  // A statement's period start is the earliest day the ledger can answer for,
  // and it is usually before the first trade inside it.
  const ledgerFrom = state.combined
    ? combinedJournals().map((j) => j.ledger?.from).filter(Boolean).sort()[0]
    : state.ledger?.from;
  let earliest = firstTrade && firstTrade < janFirst ? firstTrade : janFirst;
  if (ledgerFrom && ledgerFrom < earliest) earliest = ledgerFrom;
  const floor = back(3 * 366);
  return earliest < floor ? floor : earliest;
}

/**
 * The prices we know for a ticker without asking anyone, with their dates.
 *
 * The statement's opening mark, then the price of every trade in it. Dated,
 * because "the last price we ever saw" values a holding on every past day at a
 * price from its future — a delisted stub marked at 0.40 on the thirty-first of
 * December and sold at 0.70 in April was carried at 0.70 all year.
 */
function datedMarks(ledger) {
  const out = {};
  for (const [ticker, price] of Object.entries(ledger.openingMarks ?? {})) {
    if (price > 0) out[ticker] = [{ date: ledger.from, price }];
  }
  for (const event of ledger.events ?? []) {
    if (event.kind !== 'trade' || !(event.price > 0) || !event.ticker) continue;
    (out[event.ticker] ??= []).push({ date: event.date, price: event.price });
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/**
 * The last day the imported history is walked to.
 *
 * Today, when this year has a file. When it does not, the end of the newest
 * imported year: the book shows no holdings now, and walking last year's
 * holdings on to today would draw months the account never had.
 */
function historyEnd(statements = state.statements) {
  const records = statements ?? [];
  const newest = records[records.length - 1];
  const year = Number(String(newest?.to ?? '').slice(0, 4));
  return year && year < new Date().getFullYear() ? newest.to : todayStr();
}

/** Map over a list a few items at a time, keeping the order. */
async function inBatches(list, size, fn) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(...await Promise.all(list.slice(i, i + size).map(fn)));
  }
  return out;
}

/**
 * A ticker's close on or before a past day.
 *
 * On or before, not on: a Saturday has no close and the book still had a value
 * on it. Friday's close is what the holding was worth over the weekend.
 */
function pastPrice(ticker, day) {
  const position = state.positions.find((p) => p.ticker === ticker);
  const symbol = historySymbol(ticker, position?.cls);
  const rows = priceHistories.get(symbol);
  if (!rows?.length) return null;
  /**
   * As traded that day. The history is adjusted for every later split and the
   * journal's share counts are not — except splits a broker statement reported,
   * which the import already rescaled the holdings for.
   */
  const applied = splitsAppliedByJournal().filter((s) => s.ticker === ticker);
  return asTradedClose(closeAtOrBefore(rows, day), day, splitsOf(symbol), applied);
}

/** The splits the imported statements reported, worked out once per set of statements. */
let appliedSplitsFor = null;
let appliedSplits = [];
function splitsAppliedByJournal() {
  // All accounts: the splits every sub-account's statements reported.
  const source = state.combined ? `combined:${journalGeneration}` : state.statements;
  if (appliedSplitsFor !== source) {
    appliedSplitsFor = source;
    appliedSplits = allSplits(state.combined ? combinedJournals().flatMap((j) => j.statements) : state.statements ?? []);
  }
  return appliedSplits;
}

/**
 * The year beside the market's, measured the same way as the year-to-date
 * figure above it: the broker's own when a statement gave one, otherwise the
 * account valued day by day. Shows nothing while those values load, rather
 * than a figure that credits the year's deposits with their profit.
 */
function yearToDateReturn(totals) {
  const from = `${new Date().getFullYear()}-01-01`;
  const to = todayStr();
  const trades = accountPerformance({
    positions: state.positions,
    account: totals.account,
    from,
    to,
    flows: state.cashFlows,
    openingNav: state.openingNav,
    startPrices,
  });
  if (trades.method === 'broker' || (!state.ledger?.events?.length && !state.combined)) return trades;
  const history = authoritativeHistory();
  if (!history.length) return { ...trades, returnPct: null };
  const measured = measuredYearToDate(trades, history, from, to);
  return measured ? { ...trades, ...measured } : { ...trades, returnPct: null };
}

/**
 * Fetch what each already-held position was worth when the window opened.
 *
 * Only positions predating the window need one — for a year that is normally
 * none or a handful — and a past close never changes, so it is cached for good.
 * Until it arrives those positions are left out, so the figure can rise on the
 * second pass rather than starting overstated.
 */
async function loadWindowStartPrices() {
  const from = windowStart();
  if (!from) return;

  const held = state.positions
    .filter((p) => p.status === 'Open' && p.open && p.open < from)
    .map((p) => p.ticker);
  if (!held.length) return;

  const fetched = await pricesOn(held, from);
  // Only redraw when something new actually arrived, or this recurses.
  const changed = [...fetched].some(([t, v]) => startPrices.get(t) !== v);
  if (!changed) return;
  startPrices = new Map([...startPrices, ...fetched]);
  renderHome();
}

const longDate = (iso) => new Date(iso).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric',
});

/**
 * What window your own figure covers and how it was worked out, for the
 * tooltip.
 *
 * Naming the method is the point. Two honest ways of measuring a year disagree
 * by a few points whenever money was paid in, and anyone comparing this against
 * their broker's app deserves to know which one they are looking at rather than
 * wondering which is broken.
 */
function describeOwnYear(performance) {
  const year = new Date().getFullYear();

  if (performance?.method === 'broker') {
    return `Time-weighted return, the same measure your broker reports: ${
      performance.brokerTwr.toFixed(2)}% from their statement to ${
      longDate(performance.brokerThrough)}, compounded with this account's move since.`;
  }
  if (performance?.method === 'history') {
    return `Time-weighted return since 1 January ${year}: your account valued every day from your `
      + 'imported history, with deposits and withdrawals taken out, so money you paid in never counts as profit.';
  }
  if (performance?.method === 'statement') {
    return `Your return since 1 January ${year}: the year's profit over what the account `
      + 'was worth on 1 January, so money you paid in since does not change it. Import a '
      + 'statement carrying your broker\'s own time-weighted return to match their figure '
      + 'exactly.';
  }

  const span = trackedSpan();
  if (!span) return '';
  const janFirst = `${year}-01-01`;
  if (span.from <= janFirst) return `Your return since 1 January ${year}`;
  return `Your return since ${longDate(span.from)}, when this account started`;
}

/** The first and last day the year's curve actually has data for. */
function trackedSpan() {
  const snaps = state.snapshots;
  if (!snaps?.length) return null;
  // Never reaches back past the day the account started, so a year-to-date on a
  // three-week-old account measures the three weeks rather than inventing the
  // months before it.
  const cutoff = periodStart('YTD', snaps[0].date);
  const inWindow = snaps.filter((s) => new Date(s.date) >= cutoff);
  const used = inWindow.length >= 2 ? inWindow : snaps;
  if (used.length < 2) return null;
  const from = used[0].date;
  const to = used[used.length - 1].date;
  return {
    from,
    to,
    days: Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000)),
  };
}

/**
 * The gain across the selected timeframe, under the account value.
 *
 * This follows the timeframe buttons rather than showing lifetime P&L, so
 * "1M" answers what the month did.
 */
function renderPeriodGain(period) {
  const pnlEl = document.getElementById('acctPnl');
  if (!pnlEl) return;

  if (!period || period.returnPct == null) {
    pnlEl.textContent = '—';
    return;
  }

  const gain = period.pnl;
  const returnPct = period.returnPct ?? 0;
  const arrow = gain >= 0 ? '▲ ' : '▼ ';

  pnlEl.innerHTML = hidden
    ? `<span style="color:var(--text3)">${MASK}</span>`
    : `${arrow}${$s(gain)} <span style="color:${clr(returnPct)}">(${fp(returnPct)})</span>`;
  pnlEl.style.color = hidden ? 'var(--text3)' : clr(gain);
}

/** The live/partial pill shown on both the home and positions pages. */
/**
 * What the pill says, and why it says more than it used to.
 *
 * "Live prices on" was shown at every hour of the day. Outside the session that
 * is not true — the figures are the last close — and someone watching an
 * unchanging number under a label promising live prices has no way to tell a
 * shut market from a broken app. That is exactly the wrong way round, because
 * one of those needs no action and the other does.
 *
 * So the pill now names the session. Pre-market and after-hours are reported
 * only when prices genuinely came from those sessions, which is something the
 * positions themselves know: applyExtendedQuotes stamps the ones it moved.
 */
function priceStatus() {
  const openStocks = state.positions.filter((p) => p.status === 'Open' && p.cls !== 'Crypto');
  const extended = openStocks.find((p) => p.extPhase);

  if (extended) {
    return {
      label: extended.extPhase === 'pre' ? 'Pre-market' : 'After hours',
      short: extended.extPhase === 'pre' ? 'Pre' : 'After',
      off: false,
    };
  }

  if (openStocks.length && !state.apiKey) {
    return { label: 'Crypto live · stocks manual', short: 'Partial', off: true };
  }

  if (openStocks.length && !regularSessionOpen()) {
    // Without a server there is nothing that could be showing, so say so
    // rather than implying the feed is merely quiet.
    return extendedPricingAvailable()
      ? { label: 'Market closed', short: 'Closed', off: true }
      : { label: 'Market closed · last close', short: 'Closed', off: true };
  }

  return { label: 'Live prices on', short: 'Live', off: false };
}

export function updateLivePill() {
  const { label, short, off } = priceStatus();

  [['livePill', 'livePillTxt'], ['livePill2', 'livePill2Txt']].forEach(([pillId, textId], i) => {
    const pill = document.getElementById(pillId);
    if (!pill) return;
    pill.className = 'live-pill' + (off ? ' off' : '');
    const text = document.getElementById(textId);
    if (!text) return;
    text.textContent = i === 0 ? label : short;
  });
}

export function renderHome() {
  const totals = accountTotals(state.positions, state.cash);

  renderPrivacyToggle();
  setText('acctValue', hidden ? MASK : $u(totals.account).replace('.00', ''));

  setText('cashDisplay', hidden ? MASK : $u(state.cash));

  renderDailyMove(totals);

  setText('kUnreal', hidden ? MASK : $s(totals.unrealised));
  setColor('kUnreal', hidden ? 'var(--text3)' : clr(totals.unrealised));
  setText('kUnrealSub', `${totals.open.length} open position${totals.open.length !== 1 ? 's' : ''}`);

  // Banked, as against the tile beside it, which is still riding.
  const closedCount = state.positions.filter((p) => p.status === 'Closed').length;
  setText('kRealised', hidden ? MASK : $s(totals.realised));
  setColor('kRealised', hidden ? 'var(--text3)' : clr(totals.realised));
  setText('kRealisedSub', `${closedCount} closed position${closedCount !== 1 ? 's' : ''}`);
  setText('kRetLbl', ui.timeframe);
  setText('kWinRate', `${totals.winRate}%`);
  setColor('kWinRate', totals.winRate >= 50 ? 'var(--amber)' : 'var(--red)');
  setText('kWinSub', `${totals.wins}W · ${totals.losses}L closed`);

  const list = document.getElementById('homePositions');
  if (list) {
    list.innerHTML = totals.open.length
      ? LIST_HEADER + sortPositions(totals.open, ui.homeSort).map(miniRow).join('')
      : '<div class="empty">No open positions</div>';
  }

  renderAllocation();

  // The chart still draws the recorded account value; the figures beside it do
  // not come from it. That curve measures the change in what the account holds,
  // which counts money paid in as though it had been earned — it reported 2,450
  // of funding as profit on this book, and disagreed with realised plus
  // unrealised by exactly that. Every number here is counted from the trades.
  renderCurve(ui.timeframe);

  // Kicked off after the draw, so the chart appears immediately and lengthens
  // when the price histories land rather than blocking on the network.
  loadBackfill();

  const period = timeframePerformance(totals);
  setText('kReturn', period?.returnPct == null ? '—' : fp(period.returnPct));
  setColor('kReturn', period?.returnPct == null ? 'var(--text3)' : clr(period.returnPct));
  renderPeriodGain(period);

  // Needs the network, so it settles in after the rest of the page is drawn.
  renderBenchmark(totals);
  loadWindowStartPrices();

  updateLivePill();
}

/**
 * The first day of the window the buttons are asking for, as a date string.
 *
 * Null for "All", which means the whole life of the account — where the period
 * P&L necessarily equals realised plus unrealised, so the figure under the
 * account value and the two tiles below it finally agree.
 */
function windowStart() {
  if (ui.timeframe === 'All') return null;
  return cutoffFor(ui.timeframe).toISOString().slice(0, 10);
}

/**
 * The selected timeframe's return, by the most reliable measure the data allows.
 *
 * Measured against this account's own three years of IBKR statements, the
 * figures outside year to date were far out: a week read −7.90% where it was
 * −0.90%, the year +47.54% where it was +25.45%, and all time +97.44% where
 * IBKR itself says +53.19%. Two faults. Every window was costed from the prices
 * on 1 January, so a week's return carried nine months of price moves. And all
 * time divided the whole history's profit by the first deposit alone, as though
 * the fifteen thousand paid in afterwards had earned nothing.
 *
 * So, in order of how much is actually known:
 *
 *   year to date   the broker's own figure, chained to today, as before
 *   all time       the broker's yearly figures compounded, when every year is
 *                  an IBKR statement and the years join up
 *   any window     the account valued every day from the statements, deposits
 *                  taken out and the days compounded — within about half a
 *                  point of the broker on every year it could be checked on
 *   no statements  the estimate from trades, but no longer handed 1 January's
 *                  prices for a window that does not start then
 *
 * While the daily values are still loading a figure is not guessed: the
 * statements mean a reliable one is seconds away, and a wrong one on screen in
 * the meantime is exactly the complaint.
 */
/** All time from the broker's yearly returns chained to today, or null when any year is not an IBKR statement. */
function allTimeFromBroker(totals) {
  const year = new Date().getFullYear();
  const thisYear = accountPerformance({
    positions: state.positions,
    account: totals.account,
    from: `${year}-01-01`,
    to: todayStr(),
    flows: state.cashFlows,
    openingNav: state.openingNav,
    startPrices,
  });
  return chainedBrokerReturn(state.statements, thisYear.method === 'broker' ? thisYear.returnPct : null, year);
}

function timeframePerformance(totals) {
  const from = windowStart();
  /**
   * 1W to 1Y run to the last market close rather than to this minute. That is
   * the day a broker's own figures run to, and ending mid-session measured a
   * different three months from the three months IBKR reports.
   */
  const to = windowEnd(ui.timeframe) ?? todayStr();
  const ytd = ui.timeframe === 'YTD';
  const fromTrades = () => accountPerformance({
    positions: state.positions,
    account: totals.account,
    from,
    to,
    flows: state.cashFlows,
    openingNav: state.openingNav,
    // The closes on 1 January are the starting prices of a window that starts
    // on 1 January, and of no other.
    startPrices: ytd ? startPrices : new Map(),
  });

  if (!state.ledger?.events?.length && !state.combined) return fromTrades();

  // A window over the missing part of a year has no trades or values there: no figure rather than a wrong one.
  if (gapInWindow(historyGaps(state.statements), from, to)) return null;

  /**
   * Year to date keeps the broker's own chained figure when a statement gave
   * one. Without it — any other broker's history — the year is measured like
   * every other window, from the account valued day by day: profit over the
   * January balance read +88% on a bank history that made +20.9%, because the
   * year's deposits had earned most of the profit.
   */
  if (ytd) {
    const trades = fromTrades();
    if (trades.method === 'broker') return trades;
    const history = authoritativeHistory();
    if (!history.length) return null;
    // Not measurable when the history does not reach back to 1 January: say so rather than guess.
    return measuredYearToDate(trades, history, from, to);
  }

  /**
   * All time is the account against everything paid into it, whenever deposits
   * are known: profit is today's value less deposits net of withdrawals, and the
   * return is that profit over what was paid in. It needs no daily history, so
   * it shows at once. A journal with no recorded deposits keeps the older
   * measure below.
   */
  // All accounts is measured from the combined daily balance below, like every other window.
  if (ui.timeframe === 'All' && !state.combined) {
    // A year covered only in part is missing its deposits, which the figure would then count as profit.
    if (historyGaps(state.statements).length) return null;
    const sinceDeposits = allTimeFromDeposits(state.cashFlows, totals.account);
    /**
     * Every year an IBKR statement: the broker's yearly returns compounded, as
     * its own app shows since inception. Profit over deposits read +48.1% where
     * IBKR read +51.3%, because this year's deposits counted as invested from
     * the first day. The dollar profit stays account less deposits.
     */
    const brokerAllTime = allTimeFromBroker(totals);
    if (brokerAllTime != null) return { ...(sinceDeposits ?? {}), returnPct: brokerAllTime, method: 'broker' };
    if (sinceDeposits) return sinceDeposits;
  }

  const history = authoritativeHistory();
  if (!history.length) return null;
  const measured = periodReturnFromHistory(history, from, to);
  if (!measured) return fromTrades();

  return { ...measured, method: 'history' };
}
