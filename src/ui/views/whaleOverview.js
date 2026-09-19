/**
 * The standing picture above the whale trades: stablecoin dominance, exchange
 * netflow and the top holders of the chosen coin, with the coin strip that
 * chooses it. The strip also chooses the coin for the Leveraged and Spot
 * sections below, through the callback set with setCoinListener.
 *
 * Kept from the whale page as it was; only its "Live whale activity" tape was
 * replaced, by the Leveraged and Spot sections in cryptoWhales.js.
 */
import { escapeHtml } from '../format.js';
import {
  fetchCoins, explorerTx, explorerAddress, chainLabel,
  shortAddress, money, tokens,
  fetchNetflow, SIGNAL_TONE, fetchTopHolders, STATUS_TONE,
  STANCE_TONE, percent, holdingChange,
  fetchNetflowSeries, NETFLOW_FRAMES, netflowFrame, netflowBars, netflowIntraday, barLabel,
} from '../../services/cryptoWhales.js';

const el = (id) => document.getElementById(id);

/* ── what the three selectors are set to, kept across a redraw ──────────── */

/** The coin. Filters the tape, and tells the holder card what to look at. */
let symbol = '';

let coins = null;
let netflow = null;
let topHolders = null;
let loading = false;
let lastAt = 0;
/** Which netflow period is expanded into its per-exchange split. */
let openPeriod = null;
/** The daily netflow history, fetched once. Re-bucketed, never re-fetched. */
let netflowHistory = null;
/** Which window the graph is drawn over. The graph only — nothing else reads it. */
let netflowFrameId = '1m';
/** The bar the cursor is over, or null. */
let netflowHover = null;
/** Rising with each load, so a slow answer cannot overwrite a newer one. */
let loadToken = 0;

/** "2m ago", "4h ago", "3d ago" — enough to place a transfer without a stamp. */
function ago(seconds) {
  const secs = Math.max(0, Math.floor(Date.now() / 1000) - seconds);
  if (secs < 60) return 'now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** The exact moment, for the title attribute. */
const stamp = (seconds) => new Date(seconds * 1000).toLocaleString();

/* ── the two cards on top ──────────────────────────────────────────────── */

/**
 * The largest holders of the selected coin, and what happened when one left.
 *
 * Follows the coin selector, unlike the netflow card beside it — "who holds the
 * most ETH" is a question about ETH.
 *
 * The lower table is the one worth reading carefully. A whale can leave the top
 * twenty-five because it sold or because somebody else bought more, and only
 * the first is behaviour; the events come from balances falling, never from
 * ranks changing. And a deposit to an exchange is never called a sale, because
 * whatever happened inside is on no ledger available here.
 */
function drawTopHolders() {
  const box = el('cwTop');
  if (!box) return;

  const hd = `<div class="cw-card-hd">Top holder whales<span>${
  symbol ? `${escapeHtml(symbol)} · current snapshot${
    topHolders?.supplyBasis ? ` · shares are % of ${escapeHtml(topHolders.supplyBasis)} supply` : ''
  }` : 'pick a coin below'}</span></div>`;

  if (!symbol) {
    box.innerHTML = `${hd}<div class="cw-card-empty">Choose a coin in the selector below to
      see who holds the most of it.</div>`;
    return;
  }
  /**
   * Only ever the chosen coin's holders. Switching coin used to leave the
   * previous coin's list on screen under the new coin's name until — or,
   * when the request failed, instead of — the new one arriving.
   */
  if (topHolders?.forSymbol !== symbol) {
    box.innerHTML = `${hd}<div class="cw-card-empty">Reading ${escapeHtml(symbol)} holders…</div>`;
    return;
  }
  if (topHolders?.unsupported) {
    box.innerHTML = `${hd}<div class="cw-card-empty">${escapeHtml(topHolders.unsupported)}</div>`;
    return;
  }

  const list = topHolders?.holders ?? [];
  const events = topHolders?.events ?? [];

  const rows = list.length ? list.map((h) => `<div class="cw-th-row">
      <span class="cw-th-rank">${h.rank}</span>
      <span class="cw-th-who">${(() => {
    const href = explorerAddress(topHolders.chain, h.address);
    const label = h.name || shortAddress(h.address);
    return href
      ? `<a class="cw-party${h.name ? ' is-known' : ''}" href="${escapeHtml(href)}"
             target="_blank" rel="noopener noreferrer"
             title="${escapeHtml(h.address)}">${escapeHtml(label)}</a>`
      : escapeHtml(label);
  })()}</span>
      <span class="cw-th-units">${escapeHtml(tokens(h.units, h.symbol ?? symbol))}</span>
      <span class="cw-th-usd">${escapeHtml(h.usd == null ? '—' : money(h.usd))}</span>
      <span class="cw-th-pct">${h.pctSupply == null ? '—' : `${h.pctSupply}%`}</span>
      ${(() => {
    /**
     * How much bigger or smaller this position got over thirty days.
     *
     * Walked back from today's balance through the wallet's own transfers, so
     * it is answerable on the first view rather than after two days of
     * snapshots — and it moves as the holder does.
     */
    const d = holdingChange(h.moves?.['30d'], { symbol: h.symbol ?? symbol });
    return `<span class="cw-th-move ${d.tone}" title="${escapeHtml(d.note)}">${
      escapeHtml(d.text)}</span>`;
  })()}
    </div>`).join('')
    : `<div class="cw-card-empty">${loading ? 'Reading holders…'
      : 'No holder list for this coin yet.'}</div>`;

  /** What was left out, so the filtering is visible rather than silent. */
  const excluded = (topHolders?.excluded ?? []).length
    ? `<div class="cw-th-excl">Not ranked: ${
      escapeHtml([...new Set(topHolders.excluded.map((x) => x.kindLabel))].join(' · '))}
      — none of them is somebody taking a position.</div>`
    : '';

  const eventRows = events.length ? events.map((e) => {
    const href = e.hash ? explorerTx(e.chain, e.hash) : null;
    const tone = STATUS_TONE[e.status] ?? '';
    return `<div class="cw-ev">
      <div class="cw-ev-path">
        <span class="cw-ev-who">${escapeHtml(e.name || shortAddress(e.holder))}</span>
        <span class="cw-ev-arrow">→</span>
        <span class="cw-ev-dest">${escapeHtml(e.destination ?? 'unknown')}</span>
        ${e.gotAsset
    ? `<span class="cw-ev-swap">${escapeHtml(e.soldAsset)} → ${escapeHtml(e.gotAsset)}</span>`
    : `<span class="cw-ev-swap">${escapeHtml(e.soldAsset ?? '')}</span>`}
      </div>
      <div class="cw-ev-meta">
        <span class="cw-ev-amt">${escapeHtml(tokens(e.unitsMoved, e.symbol))} ·
          ${escapeHtml(money(e.usdMoved))} · ${e.pct.toFixed(1)}% of holding</span>
        <span class="cw-ev-status ${tone}">${escapeHtml(e.status)}</span>
      </div>
      <div class="cw-ev-note">${escapeHtml(e.note)}${e.at ? ` · ${escapeHtml(ago(e.at))}` : ''}${href
    ? ` · <a class="cw-hash" href="${escapeHtml(href)}" target="_blank"
           rel="noopener noreferrer">${escapeHtml(shortAddress(e.hash))}</a>` : ''}</div>
    </div>`;
  }).join('')
    : `<div class="cw-card-empty">No top holder has materially reduced yet. This needs two
       days of holder snapshots before it can say anything.</div>`;

  box.innerHTML = `${hd}
    <div class="cw-th-head">
      <span>#</span><span>Holder</span><span>Amount</span><span>Value</span><span title="Share of the coins in circulation">% float</span><span>30d change</span>
    </div>
    ${rows}
    ${excluded}
    <div class="cw-th-sub">Recent top holder changes<span>only when the holder itself
      reduced — not when somebody else outgrew it</span></div>
    ${eventRows}`;
}

/**
 * Exchange netflow for the whole market.
 *
 * Independent of all three selectors — no coin, no timeframe, no size band. It
 * answers one question and it is the only thing here that answers it: across
 * every asset, is crypto capital moving onto exchanges or off them?
 *
 * Nothing here says bought or sold. Coins arriving on an exchange have not been
 * sold and may never be; they have only been put where selling is possible.
 */
/**
 * Stablecoin dominance: how much of the market is sitting in dollars.
 *
 * The reading is the whole point of the box. Stablecoins are money that has
 * entered crypto and not yet been spent, so a **high** share means buying power
 * is waiting on the sidelines with somewhere to go, and a **low** share means
 * it has already been deployed and there is less left to push prices further.
 *
 * A percentage on its own would say nothing. Eleven percent is only high
 * against what it has been, so what is shown is where today sits inside its own
 * year — and until there is a year to sit inside, the percentile is left out
 * rather than invented from a fortnight.
 */
function drawDominance() {
  const box = el('cwDominance');
  if (!box) return;

  const s = netflow?.stables;
  if (!s) {
    box.innerHTML = loading
      ? '<span class="cw-dom-wait">stablecoin dominance…</span>' : '';
    return;
  }

  const p = s.position;
  const tone = STANCE_TONE[p?.stance] ?? '';
  const arrow = s.changed30d == null ? ''
    : s.changed30d > 0.05 ? '▲' : s.changed30d < -0.05 ? '▼' : '·';

  /** A year of dominance as a line, so the level has a shape behind it. */
  const spark = (s.spark ?? []).length > 4 ? (() => {
    const xs = s.spark;
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    const span = hi - lo || 1;
    const points = xs.map((y, i) => `${(i / (xs.length - 1)) * 100},${
      28 - ((y - lo) / span) * 24}`).join(' ');
    return `<svg class="cw-dom-spark" viewBox="0 0 100 30" preserveAspectRatio="none"
        aria-hidden="true"><polyline points="${points}" /></svg>`;
  })() : '';

  const title = [
    `${money(s.stableUsd)} of ${money(s.totalUsd)} on ${s.day}`,
    p ? `${p.percentile}th percentile of the last ${p.days} days (${
      percent(p.low)}–${percent(p.high)})` : 'not enough history to rank it yet',
    s.changed30d == null ? null
      : `${s.changed30d > 0 ? '+' : ''}${s.changed30d.toFixed(2)} points in 30 days`,
    'Stablecoin market cap over total crypto market cap. High is dry powder.',
  ].filter(Boolean).join('\n');

  box.innerHTML = `<span class="cw-dom-lbl">Stablecoin dominance</span>
    <span class="cw-dom-val ${tone}" title="${escapeHtml(title)}">${
  escapeHtml(percent(s.dominance))}<span class="cw-dom-arrow">${arrow}</span></span>
    ${spark}
    <span class="cw-dom-read ${tone}" title="${escapeHtml(title)}">${
  p ? `${escapeHtml(p.reads)} · ${p.percentile}th pct`
    : `building history — ${s.since ? `since ${escapeHtml(s.since)}` : 'day one'}`}</span>`;
}

/* ── the graph ─────────────────────────────────────────────────────────── */

/** How tall the plot is, in the SVG's own units. Width is always 100. */
const PLOT_H = 118;
/** Room under the plot for the dates. */
const AXIS_H = 14;

/**
 * A short money label for an axis: $2.4B, $600M, $0.
 *
 * Deliberately coarser than the tooltip's figure. An axis is read at a glance
 * and four significant figures on it is clutter; the exact number is a
 * hover away.
 */
function axisMoney(usd) {
  const n = Math.abs(usd);
  if (n >= 1e12) return `$${(usd / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${Math.round(usd / 1e6)}M`;
  if (n >= 1e3) return `$${Math.round(usd / 1e3)}K`;
  return `$${Math.round(usd)}`;
}

/** Signed, for a netflow: the minus sign is the whole message. */
const signedMoney = (usd) => (usd > 0 ? '+' : usd < 0 ? '−' : '') + money(Math.abs(usd));

/**
 * The bars for whatever frame is selected.
 *
 * The intraday frame is a different measurement and comes from a different
 * place — see NETFLOW_FRAMES — so it is built separately rather than bucketed
 * from the daily rows, which do not have the resolution.
 */
function netflowSeries() {
  const frame = netflowFrame(netflowFrameId);
  if (frame.intraday) return netflowIntraday(netflowHistory?.live ?? []);
  return netflowBars(netflowHistory?.rows ?? [], frame.id);
}

/**
 * The graph.
 *
 * Bars against a zero line, and the sign is never touched. Netflow is inflow
 * minus outflow, so coins arriving on exchanges is positive and draws **upward**
 * — and upward is the bearish direction. It would read more comfortably to flip
 * it so that bullish points up, and that is exactly the temptation this comment
 * exists to refuse: the number on the axis would then disagree with the number
 * in the tooltip, and with the 24H row above it, and with every other
 * exchange-flow chart in the world. The colour carries the meaning instead —
 * red above the line, green below it — and the zero line is labelled Neutral.
 *
 * Drawn as SVG rather than on a canvas so it inherits the page's colours and
 * stays sharp on a phone, and so every bar is a real element a cursor can find
 * without any hit-testing arithmetic.
 */
function netflowGraph(bars) {
  if (!bars.length) {
    const frame = netflowFrame(netflowFrameId);
    return `<div class="cw-nf-plot-empty">${escapeHtml(frame.intraday
      ? 'The intraday record is still filling. It is built from readings taken as the page is used, so this frame fills over the next few hours.'
      : 'No exchange history has been collected for this window yet.')}</div>`;
  }

  const peak = Math.max(...bars.map((b) => Math.abs(b.netUsd)), 1);
  const gap = bars.length > 60 ? 0.15 : bars.length > 24 ? 0.22 : 0.3;
  const step = 100 / bars.length;
  const width = step * (1 - gap);
  const mid = PLOT_H / 2;
  /** Never thinner than a hairline: a near-zero bar must still be visible. */
  const height = (v) => Math.max(0.7, (Math.abs(v) / peak) * (mid - 4));

  const rects = bars.map((b, i) => {
    const h = height(b.netUsd);
    const x = i * step + (step - width) / 2;
    const y = b.netUsd >= 0 ? mid - h : mid;
    const tone = b.signal === 'Bullish' ? 'is-in' : b.signal === 'Bearish' ? 'is-out' : 'is-flat';
    const on = netflowHover === i ? ' is-on' : '';
    return `<rect class="cw-nf-bar ${tone}${on}" x="${x.toFixed(3)}" y="${y.toFixed(2)}"
      width="${width.toFixed(3)}" height="${h.toFixed(2)}" data-bar="${i}"></rect>`;
  }).join('');

  /**
   * A transparent column per bar, full height.
   *
   * The bars themselves are a poor target — a quiet day is two pixels tall and
   * essentially unhoverable — so the cursor is caught by a full-height column
   * instead and the bar it belongs to lights up.
   */
  const hits = bars.map((_, i) => `<rect class="cw-nf-hit" x="${(i * step).toFixed(3)}" y="0"
    width="${step.toFixed(3)}" height="${PLOT_H}" data-bar="${i}"></rect>`).join('');

  const first = bars[0];
  const last = bars[bars.length - 1];

  return `<div class="cw-nf-plot">
      <div class="cw-nf-scale">
        <span class="cw-out">${escapeHtml(axisMoney(peak))}</span>
        <span class="cw-nf-zero-lbl">0 · Neutral</span>
        <span class="cw-in">−${escapeHtml(axisMoney(peak))}</span>
      </div>
      <svg class="cw-nf-svg" viewBox="0 0 100 ${PLOT_H}" preserveAspectRatio="none"
           role="img" aria-label="Exchange netflow over time">
        <line class="cw-nf-zero" x1="0" y1="${mid}" x2="100" y2="${mid}"></line>
        ${rects}${hits}
      </svg>
      <div class="cw-nf-xaxis"><span>${escapeHtml(barLabel(first))}</span><span>${
  escapeHtml(barLabel(last))}</span></div>
    </div>
    <div class="cw-nf-side">
      <span class="cw-out">▲ above the line · onto exchanges · Bearish</span>
      <span class="cw-in">▼ below the line · off exchanges · Bullish</span>
    </div>`;
}

/**
 * What the cursor is on: the four numbers and what they mean together.
 *
 * The two sides are shown alongside the net because they are a different fact.
 * Two billion each way netting to nothing is a day of enormous churn, and a net
 * of zero on its own reads as a day when nothing happened.
 */
function netflowTip(bars) {
  const bar = netflowHover != null ? bars[netflowHover] : bars[bars.length - 1];
  if (!bar) return '';
  const tone = SIGNAL_TONE[bar.signal] ?? '';
  const live = netflowHover == null ? '<span class="cw-nf-tip-hint">latest · hover the graph</span>' : '';

  return `<div class="cw-nf-tip">
      <div class="cw-nf-tip-hd">${escapeHtml(barLabel(bar))}${
  bar.grain === 'hour' ? '<span class="cw-nf-tip-sub">24h to this point</span>' : ''}${live}</div>
      <div class="cw-nf-tip-rows">
        <span>Inflow</span><span class="cw-out">${escapeHtml(money(bar.inUsd))}</span>
        <span>Outflow</span><span class="cw-in">${escapeHtml(money(bar.outUsd))}</span>
        <span>Netflow</span><span class="${tone}">${escapeHtml(signedMoney(bar.netUsd))}</span>
        <span>Reading</span><span class="${tone}">${escapeHtml(bar.signal)}</span>
      </div>
    </div>`;
}

/* ── the card ──────────────────────────────────────────────────────────── */

/**
 * Exchange netflow: the rolling day, then the graph.
 *
 * The five historical rows this card used to carry — 7D, 1M, 6M, 1Y, YTD —
 * were five numbers that could not be compared with each other. A negative 1M
 * told you nothing about whether it had been negative all month or turned on
 * the twenty-eighth, which is the only thing worth knowing about a flow. The
 * graph answers that and the rows are gone.
 *
 * The 24H row stays because it is the one figure that is genuinely about now,
 * it is a rolling twenty-four hours rather than a bucket, and it carries the
 * per-exchange split behind it.
 *
 * Nothing on this card is touched by the coin, timeframe or size selectors
 * underneath it. It is the whole market, every asset, every size.
 */
function drawNetflow() {
  const box = el('cwNetflow');
  if (!box) return;

  /**
   * Two measurements of one thing, and the better one is shown.
   *
   * `balances` is what the exchanges publish about their own wallets, daily,
   * back years — every asset, every size. It is a census.
   *
   * `periods` is the transfers this app caught itself: five chains, a large
   * floor, and only since collecting started. It is a sample, and for anything
   * longer than a day the census beats it comfortably.
   */
  const census = (netflow?.balances?.periods ?? []).filter((p) => p.netUsd != null);
  const usingCensus = census.length > 0;
  const day = (usingCensus ? census : (netflow?.periods ?? [])).find((p) => p.id === '24h');

  const bars = netflowSeries();
  const frames = NETFLOW_FRAMES.map((f) => `<button type="button"
      class="cw-nf-frame${f.id === netflowFrameId ? ' active' : ''}"
      data-frame="${f.id}">${escapeHtml(f.label)}</button>`).join('');

  if (!day && !bars.length) {
    box.innerHTML = `<div class="cw-card-hd">Exchange netflow<span>whole market ·
      all assets in USD</span></div>
      <div class="cw-card-empty">${loading ? 'Reading the exchanges…'
    : 'No exchange flow recorded yet.'}</div>`;
    return;
  }

  /** The rolling day, kept as a row, with its per-exchange split behind it. */
  const dayRow = day ? (() => {
    const open = openPeriod === day.id;
    const tone = SIGNAL_TONE[day.signal] ?? '';
    const drawer = open ? `<div class="cw-nf-drawer">
      ${day.venues?.length ? day.venues.map((x) => `<div class="cw-nf-vrow">
          <span class="cw-nf-venue">${escapeHtml(x.venue)}</span>
          <span class="cw-nf-in">${escapeHtml(money(x.inUsd))}</span>
          <span class="cw-nf-out">${escapeHtml(money(x.outUsd))}</span>
          <span class="cw-nf-net ${SIGNAL_TONE[x.signal] ?? ''}">${
  escapeHtml(signedMoney(x.netUsd))}</span>
          <span class="cw-nf-sig ${SIGNAL_TONE[x.signal] ?? ''}">${escapeHtml(x.signal ?? '')}</span>
        </div>`).join('')
    : '<div class="cw-card-empty">No exchange moved anything in this period.</div>'}
    </div>` : '';

    return `<div class="cw-nf-wrap${open ? ' is-open' : ''}">
      <div class="cw-nf-row cw-clickable" data-period="${day.id}"
           title="Click for the split by exchange">
        <span class="cw-nf-period">24H${day.rolling
  ? '<span class="cw-nf-live" title="Rolling twenty-four hours, recomputed through the day">●</span>'
  : ''}</span>
        <span class="cw-nf-in">${escapeHtml(money(day.inUsd))}</span>
        <span class="cw-nf-out">${escapeHtml(money(day.outUsd))}</span>
        <span class="cw-nf-net ${tone}">${escapeHtml(signedMoney(day.netUsd))}</span>
        <span class="cw-nf-sig ${tone}">${escapeHtml(day.signal ?? '')}</span>
      </div>${drawer}
    </div>`;
  })() : '';

  const at = netflow?.at ? new Date(netflow.at).toLocaleTimeString() : '—';
  const venues = netflowHistory?.venues ?? (netflow?.balances?.venues ?? []).length;
  const since = netflowHistory?.since ?? netflow?.balances?.since ?? null;

  const provenance = usingCensus
    ? `Published exchange wallet balances, daily${since ? ` since ${escapeHtml(since)}` : ''} —
       every asset, every size, ${venues || '—'} exchanges. Priced at one date throughout, so a
       coin repricing is never read as a coin moving. A venue moving its own float between its
       own wallets is not a flow and never enters the figure.${day?.rolling
    ? ` The 24H row is a rolling day across ${day.venueCount} exchanges, recomputed through the day.`
    : ''}`
    : `This app's own record of large transfers. ${netflow?.labels ?? 0} exchange addresses
       across ${(netflow?.venues ?? []).length} venues.`;

  box.innerHTML = `<div class="cw-card-hd">Exchange netflow<span>whole market · all
      assets in USD · never filtered by the selectors below</span></div>
    <div class="cw-nf-head">
      <span>Period</span><span>Inflow</span><span>Outflow</span><span>Netflow</span><span>Signal</span>
    </div>
    ${dayRow}
    <div class="cw-nf-graph">
      <div class="cw-nf-frames">${frames}</div>
      ${netflowGraph(bars)}
      ${netflowTip(bars)}
    </div>
    <div class="cw-nf-foot">
      Onto exchanges is selling pressure · off them is accumulation. Neither is a
      confirmed trade.<br>${provenance}<br>Updated ${escapeHtml(at)}
    </div>`;

  box.onclick = (e) => {
    const frame = e.target.closest('[data-frame]');
    if (frame) {
      netflowFrameId = frame.dataset.frame;
      netflowHover = null;
      drawNetflow();
      return;
    }
    const hit = e.target.closest('[data-period]');
    if (!hit) return;
    openPeriod = openPeriod === hit.dataset.period ? null : hit.dataset.period;
    drawNetflow();
  };

  /**
   * Hover is bound to the plot rather than to each bar.
   *
   * One listener that reads which column the event came from, so a frame with
   * three hundred bars costs one handler. Redrawing on every move would also
   * rebuild the whole card and lose the cursor, so only the highlight and the
   * readout are touched.
   */
  const plot = box.querySelector('.cw-nf-svg');
  if (plot) {
    plot.onmousemove = (e) => {
      const hit = e.target.closest('[data-bar]');
      const next = hit ? Number(hit.dataset.bar) : null;
      if (next === netflowHover) return;
      netflowHover = next;
      paintNetflowHover(box, bars);
    };
    plot.onmouseleave = () => {
      if (netflowHover == null) return;
      netflowHover = null;
      paintNetflowHover(box, bars);
    };
  }
}

/** Move the highlight and rewrite the readout, without rebuilding the card. */
function paintNetflowHover(box, bars) {
  box.querySelectorAll('.cw-nf-bar').forEach((bar, i) => {
    bar.classList.toggle('is-on', i === netflowHover);
  });
  const tip = box.querySelector('.cw-nf-tip');
  if (tip) tip.outerHTML = netflowTip(bars);
}

/* ── the three selectors ───────────────────────────────────────────────── */

/**
 * The coin picker: the top fifty by market cap, horizontally, with their ranks.
 *
 * Nothing here is hardcoded — the list, the ranks, the logos and the counts all
 * come from ?resource=coins, so it follows the market as it reorders itself.
 *
 * Every one of the fifty is shown, including the ones that cannot be watched,
 * and that is the point of showing them. Being told that a top-ten coin has no
 * chain this app can read is information; silently omitting it looks like the
 * app forgot about the coin.
 */
function drawCoins() {
  const box = el('cwCoins');
  if (!box || !coins) return;

  const option = (c) => {
    const watchable = c.chains.length > 0;
    const classes = ['cw-coin'];
    if (c.symbol === symbol) classes.push('active');

    const readers = (c.readers ?? []).map((r) => r.label ?? chainLabel(r.chain));
    const via = (c.viaProvider ?? []).map(chainLabel);
    const title = watchable
      ? [`${c.name} · #${c.rank}`,
        readers.length ? `read directly on ${readers.join(', ')}` : null,
        via.length ? `via Whale Alert on ${via.join(', ')}` : null,
        c.support === 'partial' ? 'sampled, not swept' : null].filter(Boolean).join(' · ')
      : `${c.name} · #${c.rank} · no top-holder data for this coin`;

    return `<button class="${classes.join(' ')}" data-symbol="${escapeHtml(c.symbol)}"
      title="${escapeHtml(title)}">
      <img class="cw-logo" src="${escapeHtml(c.logo)}" alt="" loading="lazy" width="16" height="16">
      <span class="cw-sym">${escapeHtml(c.symbol)}</span>
      <span class="cw-rank">#${c.rank}</span>
      ${c.chains.length > 1 ? '<span class="cw-multi" title="Aggregated across networks">⛓</span>' : ''}
    </button>`;
  };

  /**
   * Said once, quietly, at the end of the strip.
   *
   * Twelve of the top fifty were dollars. Dropping them without a word would
   * leave a list that looks like it is missing the coins everybody knows.
   */
  const dropped = (coins.excludedStables ?? []).length
    ? `<span class="cw-coin-note" title="${escapeHtml((coins.excludedStables ?? []).join(', '))}">${
      coins.excludedStables.length} stablecoins not shown</span>`
    : '';

  box.innerHTML = `<button class="cw-coin${symbol ? '' : ' active'}" data-symbol="">
      <span class="cw-sym">All coins</span>
    </button>${coins.coins.map(option).join('')}${dropped}`;

  box.onclick = (e) => {
    const button = e.target.closest('[data-symbol]');
    if (!button) return;
    const next = button.dataset.symbol;
    if (next === symbol) return;
    symbol = next;
    onCoin(symbol);
    load();
  };
}

function draw() {
  drawCoins();
  drawNetflow();
  drawDominance();
  drawTopHolders();
  const name = el('cwName');
  if (name) name.textContent = symbol ? symbol : 'all coins';
}

/* ── loading ───────────────────────────────────────────────────────────── */

/**
 * Fetch and draw.
 *
 * The coin list is asked for once and kept; the ranking moves over weeks and
 * re-fetching it every thirty seconds would spend CoinGecko's rate limit on a
 * question whose answer has not changed.
 */
export async function renderOverview() {
  const card = el('cryptoWhaleCard');
  if (!card) return;

  if (!coins) {
    loading = true;
    draw();
    coins = await fetchCoins();
  }
  await load();
}

/**
 * How often each source is worth asking again.
 *
 * All three used to be refetched together every sixty seconds, which asked the
 * server three questions a minute when only one of them had a new answer. The
 * two heavy ones are the ones that change least:
 *
 *   the tape      — the collector adds to it every ten minutes
 *   netflow       — exchange balances are published once a day
 *   top holders   — the holder snapshot is taken once a day
 *
 * So each is asked on its own clock. A selector changing forces the sources it
 * actually affects, immediately, so the page still feels instant to touch.
 */
const FRESHNESS = {
  // The 24H row is a rolling figure now, so this is worth asking for often.
  netflow: 3 * 60_000,
  holders: 10 * 60_000,
  // Years of daily rows. They change once a day; the intraday tail is the only
  // part that moves, and fifteen minutes is finer than the eye on a day frame.
  nfseries: 15 * 60_000,
};

/** When each source last answered, so a tick can skip what is still fresh. */
const fetchedAt = { netflow: 0, holders: 0, nfseries: 0 };

/** The coin the holder card was last asked about, which is its other trigger. */
let holdersFor = null;

async function load({ force = null } = {}) {
  draw();

  /**
   * Each card draws when its own answer lands, not when the slowest does.
   *
   * These were awaited together once, so every card waited on whichever request
   * was slowest — and one of them triggers the chain poll, which takes the
   * better part of a minute on a cold start. The holder card had its data in
   * three seconds and sat blank for forty, which is indistinguishable from
   * broken.
   *
   * The token guards against a stale answer landing after a selector has
   * already changed: only the newest load is allowed to write.
   */
  const mine = ++loadToken;
  const settle = (key, fn) => (value) => {
    if (mine !== loadToken) return;
    fn(value);
    fetchedAt[key] = Date.now();
    loading = false;
    draw();
  };

  const now = Date.now();
  const due = (key) => force === 'all' || force === key
    || now - fetchedAt[key] >= FRESHNESS[key];

  const jobs = [];

  // No symbol and no timeframe: this one is about the market, always.
  if (due('netflow')) {
    jobs.push(fetchNetflow().then(settle('netflow', (market) => {
      if (market?.error == null || !netflow) netflow = market;
    })));
  }

  /**
   * The graph's history: years of daily rows that change once a day.
   *
   * On its own much slower clock than the rolling figure beside it. Asking for
   * it every three minutes would ship the same forty kilobytes twenty times an
   * hour to redraw bars that had not moved.
   */
  if (due('nfseries')) {
    jobs.push(fetchNetflowSeries().then(settle('nfseries', (history) => {
      if (history?.error == null || !netflowHistory) netflowHistory = history;
    })));
  }

  // A symbol, and only a symbol — a timeframe means nothing to a snapshot, but
  // a different coin is a different question and cannot wait for the clock.
  if (due('holders') || holdersFor !== symbol) {
    holdersFor = symbol;
    const asked = symbol;
    /**
     * Kept whenever it lands, as long as the coin is still the one chosen.
     *
     * It went through the shared load token, so a refresh starting while a
     * slow holder list was loading threw that list away — and as the coin had
     * already been asked for, it was never asked for again. The old coin's
     * holders stayed on screen for good.
     */
    jobs.push(fetchTopHolders({ symbol: asked }).then((top) => {
      if (asked !== symbol) return;
      // A failed refresh keeps this coin's last good list; never another coin's.
      if (top?.error == null || topHolders?.forSymbol !== asked) topHolders = { ...top, forSymbol: asked };
      fetchedAt.holders = Date.now();
      draw();
    }));
  }

  if (!jobs.length) return;
  await Promise.allSettled(jobs);

  if (mine !== loadToken) return;
  lastAt = Date.now();
  draw();
}

/** Refresh whatever is due; called on the page's timer. */
export function tickOverview() {
  load();
}

/** Be told when the coin strip changes coin. */
let onCoin = () => {};
export function setCoinListener(fn) { onCoin = typeof fn === 'function' ? fn : () => {}; }

/** The coins the strip offers, once loaded. */
export function overviewCoins() { return coins?.coins ?? []; }
