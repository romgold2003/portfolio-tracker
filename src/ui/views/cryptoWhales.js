/**
 * The crypto whale page.
 *
 * Rebuilt from the beginning, one piece at a time, because the version before
 * it had grown into five cards and three tables that all half-answered the same
 * question. This one asks three things in order and nothing else:
 *
 *   1. Is capital moving onto exchanges or off them?   — Exchange Netflow
 *   2. Who holds the most of this coin?                — Top Holder Whales
 *   3. What just moved, and what was it?               — Live Whale Activity
 *
 * The two cards on top are the standing picture and the table underneath is the
 * tape. The three selectors sit between them, and they belong to the tape: the
 * netflow card is about the whole market over its own fixed periods and the
 * holder card is a snapshot of right now, so a timeframe or a size band would
 * mean nothing to either.
 *
 * The coin selector is the one exception, and only for the holder card — "who
 * holds the most" is a question that needs a coin before it means anything.
 * Netflow is never filtered by it, deliberately.
 *
 * Nothing here is called a buy or a sell unless the chain shows both legs of
 * the trade. See api/_lib/activity.js — that rule is the reason this panel is
 * worth reading.
 */
import { escapeHtml } from '../format.js';
import {
  BANDS, bandDef, fetchCoins, fetchTransfers, selectTransfers,
  ACTIVITY_WINDOWS, activityWindowDef, ACTION_TONE,
  explorerTx, explorerAddress, chainLabel,
  shortAddress, money, tokens,
  fetchNetflow, SIGNAL_TONE, fetchTopHolders, STATUS_TONE,
  STANCE_TONE, percent, describeHolding, movePct,
} from '../../services/cryptoWhales.js';

const el = (id) => document.getElementById(id);

/* ── what the three selectors are set to, kept across a redraw ──────────── */

/** The coin. Filters the tape, and tells the holder card what to look at. */
let symbol = '';
/** How far back the tape reaches. The tape only. */
let win = '7d';
/** The transaction size band. The tape only. */
let band = 'all';

let coins = null;
let feed = null;
let netflow = null;
let topHolders = null;
let loading = false;
let lastAt = 0;
/** Which netflow period is expanded into its per-exchange split. */
let openPeriod = null;
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
  symbol ? `${escapeHtml(symbol)} · current snapshot` : 'pick a coin below'}</span></div>`;

  if (!symbol) {
    box.innerHTML = `${hd}<div class="cw-card-empty">Choose a coin in the selector below to
      see who holds the most of it.</div>`;
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
     * Still holding, or not. Walked back from today's balance through this
     * wallet's own transfers, so it is answerable on the first view rather
     * than after two days of snapshots.
     */
    const move = h.moves?.['30d'];
    const d = describeHolding(move);
    if (!d.status) {
      return '<span class="cw-th-move cw-th-wait" title="Reading this wallet&#39;s history">…</span>';
    }
    const amount = movePct(move);
    return `<span class="cw-th-move ${d.tone}" title="${escapeHtml(d.note)}">${
      escapeHtml(d.status)}${amount ? `<span class="cw-th-movepct">${escapeHtml(amount)}</span>` : ''}</span>`;
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
      <span>#</span><span>Holder</span><span>Amount</span><span>Value</span><span>Supply</span><span>30d</span>
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

function drawNetflow() {
  const box = el('cwNetflow');
  if (!box) return;

  /**
   * Two measurements of one thing, and the better one is shown.
   *
   * `balances` is what the exchanges publish about their own wallets, daily,
   * back years — every asset, every size, and it can answer "since the first of
   * January" on the day the app is installed. It is a census.
   *
   * `periods` is the transfers this app caught itself: five chains, a large
   * floor, and only since collecting started. It is a sample, and for anything
   * longer than a day the census beats it comfortably.
   *
   * Which one produced the numbers is printed under the table, because two
   * different measurements both called "netflow" would be the easiest way on
   * this page to mislead somebody.
   */
  const census = (netflow?.balances?.periods ?? []).filter((p) => p.netUsd != null);
  const usingCensus = census.length > 0;
  const periods = usingCensus ? census : (netflow?.periods ?? []);

  if (!periods.length) {
    box.innerHTML = `<div class="cw-card-hd">Exchange netflow<span>whole market ·
      all assets in USD</span></div>
      <div class="cw-card-empty">${loading ? 'Reading the exchanges…'
  : 'No exchange flow recorded yet.'}</div>`;
    return;
  }

  const since = netflow?.since ?? null;
  const recordHours = since ? (Date.now() / 1000 - since) / 3600 : 0;
  const HOURS = { '24h': 24, '7d': 168, '1m': 744, '6m': 4392, '1y': 8784 };

  const row = (p) => {
    const open = openPeriod === p.id;
    const tone = SIGNAL_TONE[p.signal] ?? '';
    /**
     * A period the record cannot reach across is marked, not hidden.
     *
     * The census carries its own answer to this; the sample has to be measured
     * against how long the app has been collecting.
     */
    const short = usingCensus
      ? p.covered === false
      : !!(recordHours && recordHours < (HOURS[p.id] ?? 0));

    /** The per-exchange split, so a market call built on one venue shows it. */
    const drawer = open ? `<div class="cw-nf-drawer">
      ${p.venues.length ? p.venues.map((x) => `<div class="cw-nf-vrow">
          <span class="cw-nf-venue">${escapeHtml(x.venue)}</span>
          <span class="cw-nf-in">${escapeHtml(money(x.inUsd))}</span>
          <span class="cw-nf-out">${escapeHtml(money(x.outUsd))}</span>
          <span class="cw-nf-net ${SIGNAL_TONE[x.signal] ?? ''}">${
  escapeHtml((x.netUsd > 0 ? '+' : x.netUsd < 0 ? '−' : '') + money(Math.abs(x.netUsd)))}</span>
          <span class="cw-nf-sig ${SIGNAL_TONE[x.signal] ?? ''}">${escapeHtml(x.signal ?? '')}</span>
        </div>`).join('')
    : '<div class="cw-card-empty">No exchange moved anything in this period.</div>'}
    </div>` : '';

    return `<div class="cw-nf-wrap${open ? ' is-open' : ''}">
      <div class="cw-nf-row cw-clickable" data-period="${p.id}"
           title="Click for the split by exchange">
        <span class="cw-nf-period">${escapeHtml(p.label)}${p.rolling ? `<span class="cw-nf-live" title="Rolling twenty-four hours, recomputed through the day — every other row is a daily snapshot">●</span>` : ''}${
  short ? '<span class="cw-nf-partial" title="The record does not reach back this far yet">*</span>' : ''}</span>
        <span class="cw-nf-in">${escapeHtml(money(p.inUsd))}</span>
        <span class="cw-nf-out">${escapeHtml(money(p.outUsd))}</span>
        <span class="cw-nf-net ${tone}">${
  escapeHtml((p.netUsd > 0 ? '+' : p.netUsd < 0 ? '−' : '') + money(Math.abs(p.netUsd)))}</span>
        <span class="cw-nf-sig ${tone}">${escapeHtml(p.signal ?? '')}</span>
      </div>${drawer}
    </div>`;
  };

  const at = netflow?.at ? new Date(netflow.at).toLocaleTimeString() : '—';

  /**
   * Where the numbers came from, said plainly under the table.
   *
   * The census reaches back years and covers every asset and every size; the
   * sample reaches back as far as this app has been running. Reading a number
   * without knowing which of those produced it is how a reader ends up trusting
   * a week of data as though it were a year of it.
   */
  const provenance = usingCensus
    ? `Published exchange wallet balances, daily${netflow.balances.since
      ? ` since ${escapeHtml(netflow.balances.since)}` : ''} — every asset, every size.
       Priced at one date throughout, so a coin repricing is never read as a coin moving.
       ${(netflow.balances.venues ?? []).length} exchanges.${census.some((p) => p.rolling) ? ` The 24H row is a rolling day across ${census.find((p) => p.rolling).venueCount} exchanges, recomputed through the day — the rest are daily snapshots.` : ''}`
    : `This app's own record of large transfers, ${recordHours
      ? `reaching back ${recordHours < 48 ? `${Math.max(1, Math.round(recordHours))}h`
        : `${Math.round(recordHours / 24)}d`}` : 'which is still filling'}.
       ${netflow?.labels ?? 0} exchange addresses across ${(netflow?.venues ?? []).length} venues.`;

  box.innerHTML = `<div class="cw-card-hd">Exchange netflow<span>whole market · all
      assets in USD · never filtered by the selectors below</span></div>
    <div class="cw-nf-head">
      <span>Period</span><span>Inflow</span><span>Outflow</span><span>Netflow</span><span>Signal</span>
    </div>
    ${periods.map(row).join('')}
    <div class="cw-nf-foot">
      Onto exchanges is selling pressure · off them is accumulation. Neither is a
      confirmed trade.<br>${provenance}<br>Updated ${escapeHtml(at)}
    </div>`;

  box.onclick = (e) => {
    const hit = e.target.closest('[data-period]');
    if (!hit) return;
    openPeriod = openPeriod === hit.dataset.period ? null : hit.dataset.period;
    drawNetflow();
  };
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

  const counts = feed?.counts ?? {};
  const option = (c) => {
    const watchable = c.chains.length > 0;
    const n = counts[c.symbol] ?? 0;
    const classes = ['cw-coin'];
    if (c.symbol === symbol) classes.push('active');
    if (!watchable) classes.push('is-off');
    const readers = (c.readers ?? []).map((r) => r.label ?? chainLabel(r.chain));
    const via = (c.viaProvider ?? []).map(chainLabel);
    const title = watchable
      ? [`${c.name} · #${c.rank}`,
        readers.length ? `read directly on ${readers.join(', ')}` : null,
        via.length ? `via Whale Alert on ${via.join(', ')}` : null,
        c.support === 'partial' ? 'sampled, not swept' : null].filter(Boolean).join(' · ')
      : `${c.name} · #${c.rank} · no chain this app can read`;

    return `<button class="${classes.join(' ')}" data-symbol="${escapeHtml(c.symbol)}"
      ${watchable ? '' : 'disabled'} title="${escapeHtml(title)}">
      <img class="cw-logo" src="${escapeHtml(c.logo)}" alt="" loading="lazy" width="16" height="16">
      <span class="cw-sym">${escapeHtml(c.symbol)}</span>
      <span class="cw-rank">#${c.rank}</span>
      ${n ? `<span class="gam-count">${n}</span>` : ''}
      ${c.chains.length > 1 ? '<span class="cw-multi" title="Aggregated across networks">⛓</span>' : ''}
    </button>`;
  };

  box.innerHTML = `<button class="cw-coin${symbol ? '' : ' active'}" data-symbol="">
      <span class="cw-sym">All coins</span>
    </button>${coins.coins.map(option).join('')}`;

  box.onclick = (e) => {
    const button = e.target.closest('[data-symbol]');
    if (!button || button.disabled) return;
    const next = button.dataset.symbol;
    if (next === symbol) return;
    symbol = next;
    // The tape is filtered by the coin; the holder card notices on its own.
    load({ force: 'feed' });
  };
}

function drawWindow() {
  const picker = el('cwWindow');
  if (!picker) return;
  picker.innerHTML = ACTIVITY_WINDOWS.map((w) =>
    `<button class="opt-tab${w.id === win ? ' active' : ''}"
      data-win="${w.id}">${escapeHtml(w.label)}</button>`).join('');
  picker.onclick = (e) => {
    const id = e.target?.dataset?.win;
    if (!id || id === win) return;
    win = id;
    load({ force: 'feed' });
  };
}

function drawBands() {
  const picker = el('cwBand');
  if (!picker) return;
  picker.innerHTML = BANDS.map((b) =>
    `<button class="opt-tab${b.id === band ? ' active' : ''}"
      data-band="${b.id}">${escapeHtml(b.label)}</button>`).join('');
  picker.onclick = (e) => {
    const id = e.target?.dataset?.band;
    if (!id || id === band) return;
    band = id;
    load({ force: 'feed' });
  };
}

/* ── the tape ──────────────────────────────────────────────────────────── */

/** One end of a transfer, linked so the address can be read in full. */
function end(label, address, chain) {
  const href = explorerAddress(chain, address);
  const known = !!label && label !== 'Wallet' && label !== 'Unknown';
  const title = address ? `${address}${known ? ` · ${label}` : ''}` : 'not attributed';
  return href
    ? `<a class="cw-party${known ? ' is-known' : ''}" href="${escapeHtml(href)}"
         target="_blank" rel="noopener noreferrer"
         title="${escapeHtml(title)}">${escapeHtml(label)}</a>`
    : `<span class="cw-party${known ? ' is-known' : ''}"
         title="${escapeHtml(title)}">${escapeHtml(label)}</span>`;
}

/**
 * One row: how much, from where to where, what asset changed, what kind of
 * movement it was, and when.
 *
 * The classification arrives from the server already made — it needs the
 * exchange label set, which is three hundred addresses and has no business in
 * the browser — so this only renders it. What it must not do is add confidence
 * the classifier withheld: an exchange deposit is amber and says "sale not
 * confirmed", and only a confirmed swap is ever green or red.
 */
function row(t) {
  const a = t.activity;
  const href = explorerTx(t.blockchain, t.hash);
  const chains = [t.blockchain, ...(t.alsoOn ?? [])].map(chainLabel).join(' + ');
  const tone = ACTION_TONE[a?.action] ?? '';

  const flow = a?.swapped
    ? `<span class="cw-swap-out">${escapeHtml(a.assetFrom)}</span><span
         class="cw-swap-arrow"> → </span><span class="cw-swap-in">${escapeHtml(a.assetTo)}</span>`
    : `<span class="cw-flow-flat">${escapeHtml(a?.assetFrom ?? t.symbol)} → ${
  escapeHtml(a?.assetTo ?? t.symbol)}</span>`;

  return `<div class="gam-row cw-act-grid">
    <div class="gam-size">
      ${escapeHtml(money(t.usd))}
      <span class="cw-tokens">${escapeHtml(tokens(t.amount, t.symbol))}</span>
    </div>
    <div class="cw-path">
      <span class="cw-path-line">${end(a?.fromLabel ?? 'Wallet', t.from?.address, t.blockchain)}
        <span class="cw-arrow">→</span>
        ${end(a?.toLabel ?? 'Wallet', t.to?.address, t.blockchain)}</span>
      <span class="cw-tokens">${escapeHtml(chains)}${t.parts > 1 ? ` · ${t.parts} parts` : ''}${href
    ? ` · <a class="cw-hash" href="${escapeHtml(href)}" target="_blank"
           rel="noopener noreferrer" title="${escapeHtml(t.hash)}">${
  escapeHtml(shortAddress(t.hash))}</a>` : ''}</span>
    </div>
    <div class="cw-flow">${flow}</div>
    <div class="cw-act">
      <span class="cw-act-tag ${tone}" title="${escapeHtml(a?.note ?? '')}">${
  escapeHtml(a?.action ?? 'Unknown')}</span>
      ${a?.action === 'Exchange Deposit'
    ? '<span class="cw-act-note">sale not confirmed</span>' : ''}
    </div>
    <div class="gam-when" title="${escapeHtml(stamp(t.at))}">${escapeHtml(ago(t.at))}</div>
  </div>`;
}

/**
 * What the tape says when it has no rows — which is several different
 * sentences, because there are several different reasons and only some of them
 * are anything the reader can do something about.
 */
function emptyMessage() {
  const provider = feed?.provider;
  if (provider?.configured === null) {
    return 'Could not reach the tracker. It will try again shortly.';
  }
  if (provider?.error) {
    return `Some chains are not answering right now (${escapeHtml(provider.error)}).
      Anything already recorded is still shown.`;
  }

  /** How far the record actually reaches, so a long timeframe stays honest. */
  const since = feed?.recordSince;
  const reach = since
    ? (() => {
      const secs = Date.now() / 1000 - since;
      const days = Math.floor(secs / 86400);
      return days >= 1 ? `${days}d` : `${Math.max(1, Math.round(secs / 3600))}h`;
    })()
    : null;

  return `No ${symbol ? `${escapeHtml(symbol)} ` : ''}transfer in the ${
    escapeHtml(bandDef(band).label)} range over ${escapeHtml(activityWindowDef(win).label)}.
    ${reach ? `The record goes back ${escapeHtml(reach)}. ` : ''}Transfers this large are
    rare, which is what makes them worth watching — try a wider size band or a
    longer timeframe.`;
}

function draw() {
  const rows = el('cwRows');
  if (!rows) return;

  drawCoins();
  drawWindow();
  drawBands();
  drawNetflow();
  drawDominance();
  drawTopHolders();

  const name = el('cwName');
  if (name) name.textContent = symbol ? symbol : 'all coins';

  const transfers = selectTransfers(feed?.rows, { band, window: win, limit: 80 });

  const head = `<div class="gam-head cw-act-grid">
      <div>Size</div><div>From → To</div><div>Asset flow</div><div>Action</div><div>When</div>
    </div>`;

  rows.innerHTML = transfers.length
    ? head + transfers.map(row).join('')
    : `<div class="empty">${loading ? 'Loading…' : emptyMessage()}</div>`;

  const count = el('cwCount');
  if (count) {
    count.textContent = transfers.length
      ? `${transfers.length} transfer${transfers.length === 1 ? '' : 's'} · ${
        bandDef(band).label} · ${activityWindowDef(win).label}`
      : `${bandDef(band).label} · ${activityWindowDef(win).label}`;
  }

  const src = el('cwSrc');
  if (src) {
    // Named individually rather than counted, because "5 chains" tells nobody
    // whether the one they care about is among them.
    const names = (coins?.chains ?? []).map((c) => c.label + (c.complete ? '' : '*'));
    const watchable = coins?.watchable ?? 0;
    /**
     * Said out loud when the answer did not wait for the sweep it started.
     *
     * A page load no longer blocks on reading five chains — that is what made
     * the first request into a cold function time out — so it can be showing a
     * store that is a minute behind. A minute behind is fine. Looking current
     * while being behind is not.
     */
    const behind = feed?.provider?.refreshing ? ' · reading the chains now' : '';
    src.innerHTML = lastAt
      ? `${escapeHtml(names.join(' · ') || 'on-chain')}${
        feed?.provider?.whaleAlert ? ' · Whale Alert' : ''} — ${watchable} of the top 50
         watchable · updated ${escapeHtml(new Date(lastAt).toLocaleTimeString())}${behind}
         ${names.some((n) => n.endsWith('*')) ? '<br>* sampled each poll rather than swept in full' : ''}`
      : 'Reading the chains…';
  }
}

/* ── loading ───────────────────────────────────────────────────────────── */

/**
 * Fetch and draw.
 *
 * The coin list is asked for once and kept; the ranking moves over weeks and
 * re-fetching it every thirty seconds would spend CoinGecko's rate limit on a
 * question whose answer has not changed.
 */
export async function renderCryptoWhales() {
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
  feed: 60_000,
  // The 24H row is a rolling figure now, so this is worth asking for often.
  netflow: 3 * 60_000,
  holders: 10 * 60_000,
};

/** When each source last answered, so a tick can skip what is still fresh. */
const fetchedAt = { feed: 0, netflow: 0, holders: 0 };

/** The coin the holder card was last asked about, which is its other trigger. */
let holdersFor = null;

async function load({ force = null } = {}) {
  loading = !feed;
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

  // All three selectors: this is the tape they belong to.
  if (due('feed')) {
    jobs.push(fetchTransfers({ symbol, band, window: win }).then(settle('feed', (next) => {
      /**
       * A refresh that came back empty replaces what was there, and it should:
       * a selector may have just changed, and holding the previous answer would
       * show one filter's results under another filter's label.
       */
      if (next?.rows || !feed) feed = next;
    })));
  }

  // No symbol and no timeframe: this one is about the market, always.
  if (due('netflow')) {
    jobs.push(fetchNetflow().then(settle('netflow', (market) => {
      if (market?.error == null || !netflow) netflow = market;
    })));
  }

  // A symbol, and only a symbol — a timeframe means nothing to a snapshot, but
  // a different coin is a different question and cannot wait for the clock.
  if (due('holders') || holdersFor !== symbol) {
    holdersFor = symbol;
    jobs.push(fetchTopHolders({ symbol }).then(settle('holders', (top) => {
      if (top?.error == null || !topHolders) topHolders = top;
    })));
  }

  if (!jobs.length) return;
  await Promise.allSettled(jobs);

  if (mine !== loadToken) return;
  lastAt = Date.now();
  draw();
}

/**
 * The two trackers inside the Gamble tab.
 *
 * Bound once, on the strip rather than on each button, so redrawing either
 * panel cannot leave a stale handler behind — the same reason installNewsTabs
 * is written this way.
 */
export function installGambleTabs({ onMacro } = {}) {
  const strip = el('gambleTabs');
  if (!strip || strip.dataset.bound === '1') return;
  strip.dataset.bound = '1';

  strip.addEventListener('click', (e) => {
    const button = e.target.closest('[data-gtab]');
    if (!button) return;
    const wanted = button.dataset.gtab;

    for (const b of strip.querySelectorAll('[data-gtab]')) {
      b.classList.toggle('active', b.dataset.gtab === wanted);
    }
    el('gambleMacro').hidden = wanted !== 'macro';
    el('gambleCrypto').hidden = wanted !== 'crypto';

    if (wanted === 'crypto') renderCryptoWhales();
    else if (typeof onMacro === 'function') onMacro();
  });
}

/**
 * Keep it live while it is on screen.
 *
 * Sixty seconds, matching the rate at which the server actually reads the
 * chains — polling faster would only re-read the same store. An off-screen or
 * backgrounded page skips the fetch and keeps the timer.
 */
const EVERY_MS = 60_000;
let timer = null;

export function startCryptoWhales() {
  clearInterval(timer);
  timer = setInterval(() => {
    const card = el('cryptoWhaleCard');
    const onScreen = card && card.offsetParent !== null
      && document.visibilityState === 'visible';
    if (onScreen) load();
  }, EVERY_MS);
}
