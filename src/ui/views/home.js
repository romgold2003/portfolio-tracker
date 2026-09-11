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
  benchmarkSpot, benchmarkYearToDate,
  COMPARISONS, alignedReturns,
} from '../../services/benchmark.js';
import {
  pricesOn, dailySeries, historySymbol, closeOnOrBefore as closeAtOrBefore,
} from '../../services/history.js';
import {
  periodStart, cutoffFor, curveSeries, setBackfill,
} from '../../core/snapshots.js';
import { rebuildDailyValue, rebuildFromLedger } from '../../core/rebuild.js';
import {
  money as $u, signedMoney as $s, pctText as fp, pnlColor as clr,
  fmtPrice, escapeHtml,
} from '../format.js';

const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
const setColor = (id, color) => { const el = document.getElementById(id); if (el) el.style.color = color; };

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

/**
 * The index histories behind the benchmark curve, once they have arrived.
 *
 * Held here rather than fetched on every draw: a past close never changes, the
 * history service caches the series for the session anyway, and renderHome runs
 * on every price tick. Until they land the curve draws the account alone, which
 * is the same curve the % mode shows and is never wrong — only lonely.
 */
let comparisons = new Map();
let comparisonsPending = false;

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
      ...Object.keys(state.ledger.holdings ?? {}),
      ...(state.ledger.trades ?? []).map((t) => t.ticker),
    ])]
    : [];
  const tickers = fromLedger.length
    ? fromLedger
    : state.positions
      .filter((p) => p.open && (p.status === 'Open' || (p.close && p.close >= earliest)))
      .map((p) => p.ticker);

  const wanted = [...new Map(tickers.filter(Boolean).map((ticker) => {
    const position = state.positions.find((p) => p.ticker === ticker);
    return [historySymbol(ticker, position?.cls), ticker];
  })).entries()];
  if (!wanted.length) return;

  /** What this run would be built from. Unchanged means nothing to redo. */
  const key = `${earliest}|${state.cash}|${wanted.map(([sym]) => sym).sort().join(',')}|`
    + `${state.positions.length}|${(state.cashFlows ?? []).length}|`
    + `${(state.ledger?.trades ?? []).length}`;
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
    const shape = { cash: state.cash, flows: state.cashFlows, priceOn: pastPrice, from: earliest, to: todayStr() };
    setBackfill(state.ledger?.trades?.length
      ? rebuildFromLedger({ ledger: state.ledger, ...shape })
      : rebuildDailyValue({ positions: state.positions, ...shape }));
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
  if (!dates.length) return null;
  const firstTrade = dates.reduce((a, b) => (a < b ? a : b));

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
  let earliest = firstTrade < janFirst ? firstTrade : janFirst;
  if (ledgerFrom && ledgerFrom < earliest) earliest = ledgerFrom;
  const floor = back(3 * 366);
  return earliest < floor ? floor : earliest;
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

/**
 * Fetch the tracked indices once, then redraw.
 *
 * Only when the benchmark mode is actually selected, so nobody pays two
 * requests for a chart they are not looking at.
 */
async function loadComparisons() {
  if (comparisonsPending || comparisons.size === COMPARISONS.length) return;
  comparisonsPending = true;
  try {
    const fetched = await Promise.all(
      COMPARISONS.map((row) => dailySeries(row.symbol)
        .then((rows) => [row.id, rows])
        .catch(() => [row.id, null])),
    );
    let gained = false;
    for (const [id, rows] of fetched) {
      if (rows?.length && !comparisons.has(id)) { comparisons.set(id, rows); gained = true; }
    }
    if (gained) renderHome();
  } finally {
    comparisonsPending = false;
  }
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

/**
 * The indices rebased onto the same days the account curve is drawn over.
 *
 * Each index is answered per date with its last close on or before that day, so
 * a weekend reads Friday and the three curves stay in step. An index whose
 * history does not reach the start of the window is left out entirely rather
 * than drawn from where it happens to begin, which would read as a flat start
 * and understate whatever it did before then.
 */
function comparisonRows() {
  const dates = curveSeries(ui.timeframe).dates ?? [];
  if (!dates.length) return [];
  const out = [];
  for (const row of COMPARISONS) {
    const rows = comparisons.get(row.id);
    if (!rows) continue;
    const data = alignedReturns(dates, rows);
    if (data) out.push({ label: row.label, colour: row.colour, data });
  }
  return out;
}

/**
 * What the curve on screen actually covers, said under it.
 *
 * The figure in the KPI beside it is counted from the trades and reaches back
 * as far as the trades do. The curve can only be drawn from recorded account
 * values, which begin the day the app was installed. When those two periods
 * differ the two numbers differ, and without this line there is nothing on
 * screen to explain why — which is exactly how a correct number gets reported
 * as a bug.
 */
function drawCurveNote(series) {
  const host = document.getElementById('curveNote');
  if (!host) return;
  if (!series || series.synthetic) {
    host.textContent = series?.synthetic
      ? 'Not enough recorded history to draw yet — this is an illustration, not your account.'
      : '';
    host.classList.toggle('is-warn', Boolean(series?.synthetic));
    return;
  }

  const span = `${longDate(series.from)} – ${longDate(series.to)}`;

  /**
   * Even over a fully covered window the curve and the KPI beside it can
   * disagree, because they are two honest methods rather than one figure drawn
   * twice. The curve is the recorded account value with deposits taken out,
   * chained daily — a time-weighted return. The KPI counts the trades. Naming
   * the method is cheaper than fielding the question.
   */
  const how = ui.curveMode === 'value'
    ? 'Recorded account value.'
    : 'Return on recorded account value, deposits removed and compounded daily.';

  if (!series.short) {
    host.textContent = `${span} · ${how}`;
    host.classList.remove('is-warn');
    return;
  }

  host.textContent = `${span} — daily account values only start ${longDate(series.from)}, `
    + `so this is not the full ${ui.timeframe}. The ${ui.timeframe} figure beside it is `
    + 'counted from your trades and does cover the whole period.';
  host.classList.add('is-warn');
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
    return `Your return since 1 January ${year}, measured on the money you had at work `
      + '(Modified Dietz). Import a statement carrying your broker\'s own time-weighted '
      + 'return to match their figure exactly.';
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
  // Flows go in so the percentage can take them out: a deposit raises the
  // account without earning anything, and a return that counts it is not one.
  const curve = renderCurve(ui.timeframe, ui.curveMode, state.cashFlows,
    ui.curveMode === 'benchmark' ? comparisonRows() : []);

  // Both kicked off after the draw, so the chart appears immediately and
  // lengthens when the histories land rather than blocking on the network.
  if (ui.curveMode === 'benchmark') loadComparisons();
  loadBackfill();
  drawCurveNote(curve);

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
