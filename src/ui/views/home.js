/** The overview page: account value, today's move, KPIs and a compact watchlist. */
import { state } from '../../core/store.js';
import {
  accountTotals, dailyPortfolioMove, unreal, costOf, pctD,
  dailyDollar, dailyDollarExits, dailyDollarTotal, sortPositions, todayStr,
  sectorBreakdown, accountPerformance,
} from '../../core/portfolio.js';
import { regularSessionOpen, extendedPricingAvailable } from '../../services/extendedHours.js';
import { ui } from '../uiState.js';
import { renderCurve, renderSectorChart } from '../charts.js';
import {
  benchmarkSeries, benchmarkKey, benchmarkFailure,
  benchmarkSpot, benchmarkYearToDate, benchmarkHistories,
} from '../../services/benchmark.js';
import {
  pricesOn, dailySeries, historySymbol, closeOnOrBefore as closeAtOrBefore,
} from '../../services/history.js';
import { periodStart, cutoffFor, setBackfill } from '../../core/snapshots.js';
import { rebuildDailyValue } from '../../core/rebuild.js';
import { buildPortfolioHistory } from '../../core/portfolioHistory.js';
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
  <div class="mini-7d" style="${HEAD};text-align:center">W%</div>
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

function miniRow(p) {
  const pnl = unreal(p);
  const retPct = pctD(pnl, costOf(p));
  const daily = p.dailyChg ?? null;
  const weekly = p.weeklyChg ?? null;
  const dailyMoney = dailyDollar(p) == null && dailyDollarExits(p, todayStr()) === 0
    ? null
    : dailyDollarTotal(p);

  // Colour the % by what it means for THIS position: a short gains when the
  // price falls, so the raw percentage and its colour can disagree.
  const dailySign = daily == null ? 0 : (p.dir === 'Long' ? daily : -daily);
  const dailyText = daily != null
    ? `<span style="color:${clr(dailySign)}">${fp(daily)}</span>`
    : '<span style="color:var(--text4)">—</span>';
  const weeklyText = weekly != null
    ? `<span style="color:${clr(weekly)}">${fp(weekly)}</span>`
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
    <div class="mini-col mini-7d">${weeklyText}</div>
    <div class="mini-pnl">
      <div class="mini-tk" style="color:${clr(pnl)}">${$s(pnl)}</div>
      <div style="font-size:10px;color:${clr(retPct)}">${fp(retPct)}</div>
    </div>
  </div>`;
}

function renderDailyMove(totals) {
  const move = dailyPortfolioMove(state.positions, totals.account);
  const pctEl = document.getElementById('portfolioDailyPct');
  const amtEl = document.getElementById('portfolioDailyAmt');
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
/**
 * What the benchmark chart took out of the return, said out loud.
 *
 * "Deposits do not affect the percentage" is a claim, and a claim about money
 * deserves to be checkable rather than trusted. This states the amount actually
 * removed from the chained return — and, when the journal records transfers the
 * chart did not remove, says that instead, because that is the failure worth
 * catching: an account whose deposits are invisible to the curve reports them
 * as performance and reads high by roughly the deposits over the opening
 * balance.
 */
function renderCurveNote(series) {
  const note = document.getElementById('curveNote');
  if (!note) return;

  if (!series || ui.curveMode !== 'benchmark') {
    note.style.display = 'none';
    return;
  }
  note.style.display = '';

  const removed = series.flowsNetted ?? 0;
  const missing = (series.missing ?? []).length
    ? ` · No data for ${series.missing.join(' or ')}.`
    : '';

  /**
   * There is no warning here any more, because there is no longer a case to
   * warn about.
   *
   * This used to caution that the account had no transfer records, since the
   * return was worked out from the balance and had to subtract them back out —
   * so without them it read high. The line is now built from what the holdings
   * earned, which never had the money in it, and needs no record of a transfer
   * to be right about one.
   */
  const excluded = removed > 0
    ? ` ${$u(removed)} of deposits and withdrawals changed your balance and not this line.`
    : '';
  const base = 'Return since 1 January, compounded daily from what your holdings '
    + `earned — never from your balance, so money paid in cannot appear in it.${excluded}`;

  /**
   * How much of the account this line actually covers.
   *
   * A holding the price service cannot quote is left out of both halves of the
   * return, because the only prices available for it are trade marks and
   * differencing those invents moves that never happened. That is the right
   * thing to do and the wrong thing to do silently: a figure covering half an
   * account must not be read as covering all of it.
   */
  /**
   * A book with no broker ledger cannot draw this line and should say so.
   *
   * Without the statement's dated events, past days are reconstructed from
   * today's positions — and the positions record a realised trade as money
   * rather than shares, so a partly sold holding has no share count and a
   * holding bought into twice leaves no trace of the second purchase. The
   * reconstruction is out by one and a half thousand dollars on the first of
   * January and swings several per cent a day on noise that never happened.
   *
   * Compounding that noise is what makes the line diverge: fake volatility
   * drags a genuine +30% year to below zero. Measured from the same account
   * with the ledger present it reads 29.97% against the broker's own 30.83%.
   *
   * So the figure is not presented as though it were sound. The fix is one
   * import away and is worth naming exactly.
   */
  if (!state.ledger?.events?.length) {
    note.innerHTML = '<span style="color:var(--amber)">This line is reconstructed from your '
      + 'current positions, which cannot show what you held on a past day — so it drifts, '
      + 'and the further back it goes the less it means. Import your broker statement on the '
      + 'Settings page to rebuild it from the dated transactions instead.</span>'
      + escapeHtml(missing);
    return;
  }

  const share = series.pricedShare ?? 1;
  if (share < 0.95) {
    note.innerHTML = escapeHtml(base)
      + ` <span style="color:var(--amber)">Covers ${Math.round(share * 100)}% of your `
      + 'account — the rest has no daily price to measure.</span>'
      + escapeHtml(missing);
    return;
  }
  note.textContent = base + missing;
}

/**
 * The index histories the benchmark chart draws against.
 *
 * Fetched once and held, then the page is redrawn — the same shape as the
 * price backfill above and for the same reason: the account's own line is
 * already in hand, so drawing it immediately and adding the indexes a moment
 * later beats an empty chart waiting on the network.
 *
 * Only fetched when the benchmark is actually being looked at. Someone who
 * never opens it never spends the requests.
 */
let indexHistories = [];
let indexPending = false;
let indexLoaded = false;

async function loadIndexHistories() {
  if (indexPending || indexLoaded || ui.curveMode !== 'benchmark') return;
  indexPending = true;
  try {
    const fetched = await benchmarkHistories();
    // Held even when some came back empty: the chart names what is missing,
    // and retrying on every render would hammer a source that is simply down.
    indexHistories = fetched;
    indexLoaded = true;
    renderHome();
  } catch {
    // Left empty; the chart draws the account alone and says the comparison
    // is unavailable.
  } finally {
    indexPending = false;
  }
}

async function loadBackfill() {
  if (backfillPending) return;

  const earliest = earliestInterest();
  if (!earliest) return;

  /**
   * Every ticker that needs a price, from the ledger when there is one.
   *
   * The ledger names tickers the positions no longer mention — a holding
   * carried in from last year and sold in January is a closed row in money, but
   * the ledger still knows it was 250 shares and when they went.
   */
  const fromLedger = state.ledger
    ? [...new Set([
      ...Object.keys(state.ledger.openingHoldings ?? {}),
      ...Object.keys(state.ledger.holdings ?? {}),
      ...(state.ledger.events ?? []).map((e) => e.ticker),
    ].filter(Boolean))]
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
    ? fromLedger
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

  backfillPending = true;
  try {
    const loaded = await Promise.all(wanted.map(([symbol]) => dailySeries(symbol)
      .then((rows) => [symbol, rows])
      .catch(() => [symbol, null])));
    for (const [symbol, rows] of loaded) if (rows?.length) priceHistories.set(symbol, rows);

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
    const forward = ledger?.openingCash != null && ledger.from
      ? buildPortfolioHistory({
        opening: {
          date: ledger.from, cash: ledger.openingCash, holdings: ledger.openingHoldings,
        },
        events: ledger.events ?? [],
        priceOn: pastPrice,
        lastKnown: datedMarks(ledger),
        from: earliest,
        to: todayStr(),
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
        if (last.date === today) {
          /**
           * Today's performance is restated along with today's balance.
           *
           * Spreading the previous row over today carried its `marketPnl` with
           * it, so the live value was reported alongside a figure describing a
           * different day — and the last point of the line stepped by whatever
           * the two days happened to differ by. What today actually earned is
           * the change in balance since yesterday, less anything paid in.
           */
          const previous = forward[forward.length - 2];
          row.marketPnl = previous
            ? round2(live - previous.totalAccountValue - (row.externalCashFlow ?? 0))
            : 0;
          forward[forward.length - 1] = row;
        } else {
          forward.push({
            ...row,
            externalCashFlow: 0,
            deposit: 0,
            withdrawal: 0,
            marketPnl: round2(live - last.totalAccountValue),
          });
        }
      }
      setBackfill(forward, { authoritative: true });
    } else {
      /**
       * The back-cast keeps its flows, which it used to throw away here.
       *
       * Reducing each day to a date and a balance meant the percentage curve
       * had nothing to work with but the balance — and a balance moves when
       * money is paid in. It then had to find the deposits somewhere else and
       * line them up by date against days that may not exist, which is where
       * the unexplained steps came from. The transfer belongs on the day it
       * happened, beside the balance it changed.
       */
      const byDay = new Map();
      for (const flow of state.cashFlows ?? []) {
        if (!flow?.date || !Number.isFinite(flow.amount)) continue;
        byDay.set(flow.date, (byDay.get(flow.date) ?? 0) + flow.amount);
      }
      setBackfill(rebuildDailyValue({
        positions: state.positions,
        cash: state.cash,
        flows: state.cashFlows,
        priceOn: pastPrice,
        from: earliest,
        to: todayStr(),
      }).map((r) => ({
        date: r.date,
        totalAccountValue: r.value,
        externalCashFlow: byDay.get(r.date) ?? 0,
        // Carried through so the percentage curve has a cash-free figure to
        // work from even on a book with no statement behind it.
        marketPnl: r.marketPnl,
      })));
    }
    backfillFor = key;
    renderHome();
  } finally {
    backfillPending = false;
  }
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
  const ledgerFrom = state.ledger?.from;
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
 * A ticker's close on or before a past day.
 *
 * On or before, not on: a Saturday has no close and the book still had a value
 * on it. Friday's close is what the holding was worth over the weekend.
 */
function pastPrice(ticker, day) {
  const position = state.positions.find((p) => p.ticker === ticker);
  const rows = priceHistories.get(historySymbol(ticker, position?.cls));
  if (!rows?.length) return null;
  return closeAtOrBefore(rows, day);
}

function yearToDateReturn(totals) {
  return accountPerformance({
    positions: state.positions,
    account: totals.account,
    from: `${new Date().getFullYear()}-01-01`,
    to: todayStr(),
    flows: state.cashFlows,
    openingNav: state.openingNav,
    startPrices,
  });
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

  if (!period) {
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
  renderCurveNote(renderCurve(ui.timeframe, ui.curveMode, indexHistories));

  // Kicked off after the draw, so the chart appears immediately and lengthens
  // when the price histories land rather than blocking on the network.
  loadBackfill();
  loadIndexHistories();

  const period = accountPerformance({
    positions: state.positions,
    account: totals.account,
    from: windowStart(),
    to: todayStr(),
    flows: state.cashFlows,
    openingNav: state.openingNav,
    startPrices,
  });
  setText('kReturn', fp(period.returnPct ?? 0));
  setColor('kReturn', clr(period.returnPct ?? 0));
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
