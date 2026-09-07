/**
 * Which whales hold the most, and in what.
 *
 * Two sections, stacked, both live and both moving together. On top the tape:
 * the large transfers as they land. Under it the standings: who holds the most
 * and in what, added up over the chosen window.
 *
 * They are not alternatives and were briefly built as though they were, behind
 * a toggle, which was wrong — the point is watching a sale hit the tape and
 * seeing the ranking move under it in the same glance. A transfer on its own
 * says little, since an exchange shifting its float between hot and cold
 * storage looks exactly like conviction; the ranking says what it added up to.
 * Each answers what the other cannot.
 *
 * A whale in three coins appears three times, because those are three positions
 * of different sizes that happen to share an owner and flattening them into one
 * row would hide the sizes. Opening a row shows that whale's whole book, so the
 * repetition explains itself rather than looking like duplication.
 *
 * The size bands filter the position and the windows decide how far back to
 * add up. Both are honest about what they cannot do: the record only reaches
 * as far as the app has been collecting, so "1Y" is a request, not a promise.
 */
import { escapeHtml } from '../format.js';
import {
  BANDS, bandDef, fetchCoins, fetchTransfers, selectTransfers,
  explorerTx, explorerAddress, chainLabel, directionOf, partyName, isVoid,
  shortAddress, money, tokens, fetchFlow, FLOW_WINDOWS, TREND_TONE,
  fetchHolders, fetchLeverage, HOLDER_KIND,
  fetchVerdict, VERDICT_TONE,
  fetchNetflow, SIGNAL_TONE,
} from '../../services/cryptoWhales.js';

const el = (id) => document.getElementById(id);

/** Survives a re-render, like the other panels. */
let band = 'all';
let symbol = '';
let coins = null;
let feed = null;
let loading = false;
let lastAt = 0;
/**
 * 'transfers' is what moved; 'wallets' is who has been moving it.
 *
 * Two views of one store rather than two panels, because they answer the same
 * question at two zoom levels and switching between them is the useful motion:
 * see a wallet accumulating, then look at the transfers that built it.
 */
let flow = null;
/** Which rank is open, showing that whale's whole book. */
let openRank = null;
/** The opened row's leverage: null while it is being asked for. */
let openLeverage = null;
let holders = null;
let reading = null;
/** The market-wide netflow card. Never filtered by the coin picker. */
let netflow = null;
/** Which period row is expanded into its per-exchange breakdown. */
let openPeriod = null;
let win = '1m';

/** "2m", "4h", "3d" — enough to place a transfer without a full timestamp. */
function ago(seconds) {
  const secs = Math.max(0, Math.floor(Date.now() / 1000) - seconds);
  if (secs < 60) return 'now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** The full moment, for the title attribute — "when it was made", exactly. */
const stamp = (seconds) => new Date(seconds * 1000).toLocaleString();

/**
 * One end of a transfer.
 *
 * Linked to the explorer so the address can be opened and its whole history
 * read — which is the on-chain equivalent of the macro panel linking a wallet
 * to its Polymarket profile, and is there for the same reason: the interesting
 * question is never one transfer, it is whether this address has been busy.
 */
function party(end, chain) {
  const name = partyName(end);
  // The burn hole gets no link and no emphasis: there is nothing to look at.
  if (isVoid(end)) return '<span class="cw-void" title="No counterparty: the tokens were created or destroyed">—</span>';
  const href = explorerAddress(chain, end?.address);
  const title = end?.address ? `${end.address}${end.owner ? ` · ${end.owner}` : ''}` : 'not attributed';
  const known = end?.owner ? ' is-known' : '';

  return href
    ? `<a class="cw-party${known}" href="${escapeHtml(href)}" target="_blank"
         rel="noopener noreferrer" title="${escapeHtml(title)}">${escapeHtml(name)}</a>`
    : `<span class="cw-party${known}" title="${escapeHtml(title)}">${escapeHtml(name)}</span>`;
}

/**
 * One row.
 *
 * Nothing here is coloured by direction. An exchange inflow is read as bearish
 * and an outflow as bullish by convention, but it is only a convention — a
 * whale moving coins onto an exchange may be posting collateral — and a green
 * or red row would make the app assert something it does not know.
 */
function row(t) {
  const href = explorerTx(t.blockchain, t.hash);
  const chains = [t.blockchain, ...(t.alsoOn ?? [])].map(chainLabel).join(' + ');
  const kindBadge = t.kind && t.kind !== 'transfer'
    ? `<span class="cw-kind">${escapeHtml(t.kind)}</span>` : '';

  return `<div class="gam-row gam-grid cw-grid">
    <div class="gam-size">
      ${escapeHtml(money(t.usd))}
      <span class="cw-tokens">${escapeHtml(tokens(t.amount, t.symbol))}</span>
    </div>
    <div class="gam-who">
      <span class="gam-name">${party(t.from, t.blockchain)}</span>
      <span class="cw-arrow">→ ${party(t.to, t.blockchain)}</span>
    </div>
    <div class="gam-bet">
      <span class="cw-dir">${escapeHtml(t.direction.label)}</span>
    </div>
    <div class="gam-market">
      <span class="gam-title">${t.swap
    // A trade: what was given up, and what came back for it.
    ? `<span class="cw-swap-out">${escapeHtml(t.swap.from)}</span><span
         class="cw-swap-arrow"> → </span><span class="cw-swap-in">${escapeHtml(t.swap.to)}</span>`
    // Not a trade — one asset moved, so the asset is the whole answer.
    : escapeHtml(t.symbol)} on ${escapeHtml(chains)}${
  t.parts > 1 ? ` · ${t.parts} parts` : ''}</span>
      <span class="gam-topic">${kindBadge}${href
    ? `<a class="cw-hash" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"
          title="${escapeHtml(t.hash)}">${escapeHtml(shortAddress(t.hash))}</a>`
    : escapeHtml(shortAddress(t.hash))}</span>
    </div>
    <div class="gam-when" title="${escapeHtml(stamp(t.at))}">${escapeHtml(ago(t.at))}</div>
  </div>`;
}

/** One ranked position: a whale, a coin, and what it did over the window. */
function walletRow(r) {
  const buying = r.netUsd > 0;
  const chain = r.chains[0];
  const href = explorerAddress(chain, r.address);
  const name = r.owner ? r.owner : shortAddress(r.address);
  const open = openRank === r.rank;
  const more = (r.holdings?.length ?? 1) - 1;
  /**
   * How far today's value has drifted from what it cost.
   *
   * Shown only when it is worth showing: on a stablecoin, or on anything bought
   * minutes ago, the two numbers are the same and printing both would be noise.
   */
  const moved = r.costUsd && Math.abs(r.netUsd - r.costUsd) / Math.abs(r.costUsd);

  /**
   * What this whale holds in everything else, shown only when the row is open.
   *
   * The ranking is per position, so a whale in three coins appears three times
   * and each of those rows is only a third of the story. Opening one tells the
   * rest without making the table itself wider or the ranking mean something
   * other than what it says.
   */
  const drawer = open ? `<div class="cw-drawer">
    <div class="cw-drawer-hd">Everything ${escapeHtml(name)} moved in this window</div>
    ${(r.holdings ?? []).map((h) => `<div class="cw-hold${h.symbol === r.symbol ? ' is-this' : ''}">
        <span class="cw-hold-sym">${escapeHtml(h.symbol)}</span>
        <span class="cw-hold-amt ${h.netUsd > 0 ? 'cw-in' : 'cw-out'}">${
  escapeHtml((h.netUsd > 0 ? '+' : '') + money(h.netUsd))}</span>
        <span class="cw-hold-units">${escapeHtml(tokens(Math.abs(h.netUnits), h.symbol))}${
  h.costUsd && Math.abs(h.netUsd - h.costUsd) / Math.abs(h.costUsd) > 0.01
    ? ` · cost ${escapeHtml(money(Math.abs(h.costUsd)))}` : ''}</span>
      </div>`).join('')}
    ${openLeverage === null
    ? '<div class="cw-lev cw-lev-wait">Checking Hyperliquid…</div>'
    : openLeverage?.positions?.length
      ? `<div class="cw-lev"><span class="cw-lev-hd">Leveraged on Hyperliquid</span>${
        openLeverage.positions.map((p) => `<span class="cw-lev-pos ${
          p.side === 'short' ? 'cw-out' : 'cw-in'}">${escapeHtml(p.side)} ${
          escapeHtml(p.coin)} ${escapeHtml(money(p.notionalUsd))}${
          p.leverage ? ` · ${p.leverage}x` : ''}</span>`).join('')}</div>`
      : openLeverage?.supported === false
        ? ''
        : '<div class="cw-lev cw-lev-none">No open position on Hyperliquid</div>'}
    <div class="cw-drawer-ft">${r.transfers} transfer${r.transfers === 1 ? '' : 's'} ·
      ${escapeHtml(r.chains.map(chainLabel).join(', '))} ·
      total ${escapeHtml((r.walletNetUsd > 0 ? '+' : '') + money(r.walletNetUsd))}${href
    ? ` · <a class="cw-hash" href="${escapeHtml(href)}" target="_blank"
           rel="noopener noreferrer">open on the explorer</a>` : ''}</div>
  </div>` : '';

  return `<div class="cw-row-wrap${open ? ' is-open' : ''}">
    <div class="gam-row cw-rank-grid cw-clickable" data-rank="${r.rank}"
         title="Click to see everything this whale moved">
      <div class="cw-num">${r.rank}</div>
      <div class="gam-who">
        <span class="gam-name">${escapeHtml(name)}</span>
        <span class="cw-arrow">${escapeHtml(chainLabel(chain))}${
  more > 0 ? ` · also in ${more} other coin${more === 1 ? '' : 's'}` : ''}</span>
      </div>
      <div class="cw-asset">${escapeHtml(r.symbol)}</div>
      <div class="cw-amount ${buying ? 'cw-in' : 'cw-out'}">
        ${escapeHtml((buying ? '+' : '') + money(r.netUsd))}
        <span class="cw-tokens">${escapeHtml(tokens(Math.abs(r.netUnits), r.symbol))}${
  moved > 0.01 ? ` · ${escapeHtml(moved > 0 ? `cost ${money(Math.abs(r.costUsd))}` : '')}` : ''}</span>
      </div>
      <div class="gam-when" title="${escapeHtml(`last seen ${stamp(r.lastAt)}`)}">${
  escapeHtml(ago(r.lastAt))}<span class="cw-span">${r.transfers} tx</span></div>
    </div>${drawer}
  </div>`;
}

/**
 * The coin picker.
 *
 * Every one of the top fifty is listed, including the ones that cannot be
 * watched — which is the point of showing them. Being told that AVAX is top ten
 * and has no on-chain whale coverage is information; silently omitting it looks
 * like the app forgot about it.
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
    load();
  };
}

/**
 * Holders whose balance moved, insiders first.
 *
 * A team multisig shedding tokens and an anonymous whale shedding tokens look
 * identical in a list sorted by size, and they do not mean remotely the same
 * thing — so insiders sort to the top regardless of how much they moved.
 */
function holderRows() {
  const moves = holders?.moves ?? [];
  if (!moves.length) {
    return `<div class="empty">${loading ? 'Loading…' : `No holder balance has moved
      enough to report yet. This compares snapshots taken a day apart, so it says
      nothing until the collector has run across two days.`}</div>`;
  }

  const sorted = [...moves].sort((a, b) => (b.insider ? 1 : 0) - (a.insider ? 1 : 0)
    || Math.abs(b.usdDelta) - Math.abs(a.usdDelta));

  return `<div class="gam-head cw-hold-grid">
      <div>Holder</div><div>Kind</div><div>Coin</div><div>Change</div><div>Holds now</div>
    </div>${sorted.map((m) => {
    const selling = m.usdDelta < 0;
    const kind = HOLDER_KIND[m.kind] ?? HOLDER_KIND.wallet;
    const href = explorerAddress(m.chain, m.holder);
    const name = m.name || shortAddress(m.holder);
    return `<div class="gam-row cw-hold-grid${m.insider ? ' is-insider-row' : ''}">
      <div class="gam-who">
        <span class="gam-name">${href
    ? `<a class="cw-party${m.name ? ' is-known' : ''}" href="${escapeHtml(href)}"
           target="_blank" rel="noopener noreferrer"
           title="${escapeHtml(m.holder)}">${escapeHtml(name)}</a>`
    : escapeHtml(name)}</span>
        <span class="cw-arrow">${escapeHtml(chainLabel(m.chain))} · ${
  escapeHtml(m.from)} → ${escapeHtml(m.to)}</span>
      </div>
      <div><span class="cw-kindtag ${kind.tone}" title="${escapeHtml(kind.title)}">${
  escapeHtml(kind.label)}</span></div>
      <div class="cw-asset">${escapeHtml(m.symbol)}</div>
      <div class="cw-amount ${selling ? 'cw-out' : 'cw-in'}">
        ${escapeHtml((selling ? '' : '+') + money(m.usdDelta))}
        <span class="cw-tokens">${m.pct > 0 ? '+' : ''}${m.pct.toFixed(1)}% of holding</span>
      </div>
      <div class="cw-amount cw-hold-now">${escapeHtml(money(m.usdNow))}
        <span class="cw-tokens">${escapeHtml(tokens(m.unitsAfter, m.symbol))}</span>
      </div>
    </div>`;
  }).join('')}`;
}

/**
 * The answer, and the working behind it.
 *
 * This replaced a summary line that reported one number — how one-sided the
 * whale flow was — and called it a trend. That was one signal wearing a
 * verdict's clothes. This counts four independent ones and shows each, so a
 * call built on two can never look like a call built on four.
 */
/**
 * The ranking, as a card.
 *
 * Only the top few, because this is the headline — who is biggest right now —
 * and the full table underneath is where you go to read it properly. Putting
 * fifty rows in a card next to two other cards was how the page got confusing
 * in the first place.
 */
/**
 * Exchange netflow for the whole market.
 *
 * Independent of everything else on the page — no coin filter, no window
 * picker, five fixed periods. It answers one question and it is the only thing
 * here that answers it: across every asset, is crypto capital moving onto
 * exchanges or off them?
 *
 * Nothing here says bought or sold. Coins arriving on an exchange have not been
 * sold and may never be; they have only been put where selling is possible.
 */
function drawNetflow() {
  const box = el('cwNetflow');
  if (!box) return;

  const periods = netflow?.periods ?? [];
  if (!periods.length) {
    box.innerHTML = `<div class="cw-card-hd">Exchange netflow<span>whole market ·
      all assets in USD</span></div>
      <div class="cw-card-empty">${loading ? 'Reading the exchanges…'
  : 'No exchange-tagged flow recorded yet.'}</div>`;
    return;
  }

  const since = netflow?.since ?? null;
  const recordHours = since ? (Date.now() / 1000 - since) / 3600 : 0;
  const HOURS = { '24h': 24, '7d': 168, '1m': 744, '6m': 4392, '1y': 8784 };

  const row = (p) => {
    const open = openPeriod === p.id;
    const tone = SIGNAL_TONE[p.signal] ?? '';
    const short = recordHours && recordHours < (HOURS[p.id] ?? 0);

    /** The per-exchange split, so a market call built on one venue shows it. */
    const drawer = open ? `<div class="cw-nf-drawer">
      ${p.venues.length ? p.venues.map((x) => `<div class="cw-nf-vrow">
          <span class="cw-nf-venue">${escapeHtml(x.venue)}</span>
          <span class="cw-nf-in">${escapeHtml(money(x.inUsd))}</span>
          <span class="cw-nf-out">${escapeHtml(money(x.outUsd))}</span>
          <span class="cw-nf-net ${SIGNAL_TONE[x.signal] ?? ''}">${
  escapeHtml((x.netUsd > 0 ? '+' : x.netUsd < 0 ? '−' : '') + money(Math.abs(x.netUsd)))}</span>
          <span class="cw-nf-sig ${SIGNAL_TONE[x.signal] ?? ''}">${escapeHtml(x.signal)}</span>
        </div>`).join('')
    : '<div class="cw-card-empty">No exchange moved anything in this period.</div>'}
    </div>` : '';

    return `<div class="cw-nf-wrap${open ? ' is-open' : ''}">
      <div class="cw-nf-row cw-clickable" data-period="${p.id}"
           title="Click for the split by exchange">
        <span class="cw-nf-period">${escapeHtml(p.label)}${
  short ? '<span class="cw-nf-partial" title="The record does not reach back this far yet">*</span>' : ''}</span>
        <span class="cw-nf-in">${escapeHtml(money(p.inUsd))}</span>
        <span class="cw-nf-out">${escapeHtml(money(p.outUsd))}</span>
        <span class="cw-nf-net ${tone}">${
  escapeHtml((p.netUsd > 0 ? '+' : p.netUsd < 0 ? '−' : '') + money(Math.abs(p.netUsd)))}</span>
        <span class="cw-nf-sig ${tone}">${escapeHtml(p.signal)}</span>
      </div>${drawer}
    </div>`;
  };

  const stamp = netflow?.at ? new Date(netflow.at).toLocaleTimeString() : '—';

  box.innerHTML = `<div class="cw-card-hd">Exchange netflow<span>whole market · all
      assets in USD · not filtered by coin</span></div>
    <div class="cw-nf-head">
      <span>Period</span><span>Inflow</span><span>Outflow</span><span>Netflow</span><span>Signal</span>
    </div>
    ${periods.map(row).join('')}
    <div class="cw-nf-foot">
      Onto exchanges is selling pressure · off them is accumulation. Neither is a
      confirmed trade.${recordHours && recordHours < 8784
  ? ` <span class="cw-nf-partial">*</span> record reaches ${recordHours < 48
    ? `${Math.max(1, Math.round(recordHours))}h` : `${Math.round(recordHours / 24)}d`}` : ''}
      <br>Updated ${escapeHtml(stamp)} · ${netflow?.labels ?? 0} exchange addresses
      across ${(netflow?.venues ?? []).length} venues
    </div>`;

  box.onclick = (e) => {
    const hit = e.target.closest('[data-period]');
    if (!hit) return;
    openPeriod = openPeriod === hit.dataset.period ? null : hit.dataset.period;
    drawNetflow();
  };
}

function drawRankCard() {
  const box = el('cwRank');
  if (!box) return;
  const list = (reading?.ranked ?? []).slice(0, 5);

  box.innerHTML = `<div class="cw-card-hd">Top whales<span>${
  escapeHtml(bandDef(band).label)} · ${escapeHtml(windowNote())}</span></div>${
  list.length
    ? `<div class="cw-mini">${list.map((r, i) => `<div class="cw-mini-row">
        <span class="cw-mini-n">${i + 1}</span>
        <span class="cw-mini-who">${escapeHtml(r.owner || shortAddress(r.address))}</span>
        <span class="cw-mini-sym">${escapeHtml(r.symbol)}</span>
        <span class="cw-mini-amt ${r.netUsd > 0 ? 'cw-in' : 'cw-out'}">${
  escapeHtml((r.netUsd > 0 ? '+' : '') + money(r.netUsd))}</span>
      </div>`).join('')}</div>`
    : `<div class="cw-card-empty">${loading ? 'Loading…'
      : `Nothing in the ${escapeHtml(bandDef(band).label)} range over this window yet.`}</div>`}`;
}

function drawSummary() {
  const box = el('cwSummary');
  if (!box) return;

  const v = reading?.verdict;
  if (!v) {
    box.innerHTML = loading ? '<div class="cw-note">Reading the chains…</div>' : '';
    return;
  }

  const tone = VERDICT_TONE[v.trend] ?? '';
  const s = reading?.stealth;

  const rows = v.signals.map((sg) => {
    const quiet = sg.vote === 0;
    const amount = Number.isFinite(sg.value) && !quiet
      ? (sg.value > 0 ? '+' : '') + money(sg.value) : '—';
    return `<div class="cw-sig${quiet ? ' is-quiet' : ''}">
      <span class="cw-sig-dot ${quiet ? '' : sg.vote > 0 ? 'cw-in' : 'cw-out'}">${
  quiet ? '·' : sg.vote > 0 ? '▲' : '▼'}</span>
      <span class="cw-sig-name">${escapeHtml(sg.label)}</span>
      <span class="cw-sig-val ${quiet ? '' : sg.vote > 0 ? 'cw-in' : 'cw-out'}">${escapeHtml(amount)}</span>
      <span class="cw-sig-note">${escapeHtml(quiet ? 'nothing to say yet' : sg.detail ?? sg.reads)}</span>
    </div>`;
  }).join('');

  box.innerHTML = `
    <div class="cw-card-hd">What is happening<span>4 independent signals</span></div>
    <div class="cw-verdict">
      <div class="cw-verdict-hd">
        <span class="cw-verdict-word ${tone}">${escapeHtml(v.trend)}</span>
        <span class="cw-verdict-count">${v.heard
    ? `${Math.max(v.bullish, v.bearish)} of ${v.heard} signals agree`
    : 'no signal has enough data yet'}${v.heard && v.heard < 3 ? ' · thin' : ''}</span>
        ${v.insiderSelling ? '<span class="cw-flag">insider selling</span>' : ''}
      </div>
      <div class="cw-sigs">${rows}</div>
    </div>
    ${s ? `<div class="cw-stealth">
      <div class="cw-stealth-hd">Stealth accumulation</div>
      <div class="cw-stealth-body"><b>${s.wallets}</b> wallets · <b>${s.transfers}</b> transfers ·
        net <b class="cw-in">+${escapeHtml(money(s.netUsd))}</b><br>largest single transfer only
        ${escapeHtml(money(s.largestUsd))}</div>
    </div>` : ''}`;
}

/**
 * What the chosen window actually reached back over.
 *
 * A window longer than the record returns exactly what the shorter one did, and
 * with nothing said the buttons look broken. Saying how far back the collecting
 * goes turns an apparently dead button into an honest one.
 */
function windowNote() {
  const label = FLOW_WINDOWS.find((w) => w.id === win)?.label ?? win;
  const since = reading?.observed?.since ?? flow?.observed?.since;
  if (!since) return `over ${label}`;
  const secs = Date.now() / 1000 - since;
  const days = Math.floor(secs / 86400);
  const span = days >= 1 ? `${days}d` : `${Math.max(1, Math.round(secs / 3600))}h`;
  const covered = { '1w': 7, '1m': 31, '3m': 92, '1y': 366, all: Infinity }[win] ?? 31;
  return days < covered ? `over ${label} — record goes back ${span}` : `over ${label}`;
}

function drawWindow() {
  const picker = el('cwWindow');
  if (!picker) return;
  picker.style.display = '';
  picker.innerHTML = FLOW_WINDOWS.map((w) =>
    `<button class="opt-tab${w.id === win ? ' active' : ''}"
      data-win="${w.id}">${escapeHtml(w.label)}</button>`).join('');
  picker.onclick = (e) => {
    const id = e.target?.dataset?.win;
    if (!id || id === win) return;
    win = id;
    load();
  };
}

function drawBands() {
  const picker = el('cwBand');
  if (!picker) return;
  // The bands filter a whale's position now, so they always apply.
  picker.style.display = '';
  picker.innerHTML = BANDS.map((b) =>
    `<button class="opt-tab${b.id === band ? ' active' : ''}"
      data-band="${b.id}">${escapeHtml(b.label)}</button>`).join('');
  picker.onclick = (e) => {
    const id = e.target?.dataset?.band;
    if (!id || id === band) return;
    band = id;
    openRank = null;
    load();
  };
}

/**
 * What the panel says when it has no rows — which is four different sentences,
 * because there are four different reasons and only some of them are anything
 * the reader can do something about.
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
  const where = symbol ? `${escapeHtml(symbol)} ` : '';
  return `No ${where}transfers in the ${escapeHtml(bandDef(band).label)} range yet.
    The chains are read once a minute and the record grows from there —
    transfers this large are rare, which is what makes them worth watching.`;
}

function draw() {
  const rows = el('cwRows');
  if (!rows) return;

  drawWindow();
  drawBands();
  drawCoins();
  drawSummary();
  drawRankCard();
  drawNetflow();

  const name = el('cwName');
  if (name) name.textContent = symbol ? symbol : 'all coins';

  const transfers = selectTransfers(feed?.rows, { band });
  const list = flow?.ranked ?? [];

  const tape = transfers.length
    ? `<div class="gam-head gam-grid cw-grid">
         <div>Size</div><div>From → To</div><div>Direction</div>
         <div>Traded · chain</div><div>When</div>
       </div>${transfers.map(row).join('')}`
    : `<div class="empty">${loading ? 'Loading…' : `No ${escapeHtml(bandDef(band).label)}
       transfers recorded yet.`}</div>`;

  const standings = list.length
    ? `<div class="gam-head cw-rank-grid">
         <div>#</div><div>Whale</div><div>Coin</div><div>Value now</div><div>Last</div>
       </div>${list.map(walletRow).join('')}`
    : `<div class="empty">${loading ? 'Loading…' : `No whale holds a position in the ${escapeHtml(bandDef(band).label)} range over
       this window yet. Try a wider band or a longer window — the record only goes
       back as far as the app has been collecting.`}</div>`;

  rows.innerHTML = `
    <div class="cw-section">
      <div class="cw-section-hd">Whale transactions<span>as they land</span></div>
      ${tape}
    </div>
    <div class="cw-section">
      <div class="cw-section-hd">Whale ranking<span>ranked on today's value · ${
  escapeHtml(windowNote())}</span></div>
      ${standings}
    </div>
    <div class="cw-section">
      <div class="cw-section-hd">Holder changes<span>balances rather than transfers —
        this catches a sale however it was made</span></div>
      ${holderRows()}
    </div>`;

  // One handler on the container, so redrawing cannot leave a stale one behind.
  rows.onclick = (e) => {
    const row = e.target.closest('[data-rank]');
    // A link inside a row is a link, not a request to open the row.
    if (!row || e.target.closest('a')) return;
    const r = Number(row.dataset.rank);
    openRank = openRank === r ? null : r;
    openLeverage = null;
    draw();

    // Asked only for the row actually opened, and only once.
    const opened = (flow?.ranked ?? []).find((x) => x.rank === openRank);
    if (opened) {
      fetchLeverage(opened.address).then((answer) => {
        // The row may have been closed, or another opened, while this was away.
        if (openRank === r) { openLeverage = answer ?? { positions: [] }; draw(); }
      });
    }
  };

  const src = el('cwSrc');
  if (src) {
    // Named individually rather than counted, because "5 chains" tells nobody
    // whether the one they care about is among them.
    const names = (coins?.chains ?? []).map((c) => c.label + (c.complete ? '' : '*'));
    const watchable = coins?.watchable ?? 0;
    src.innerHTML = lastAt
      ? `${escapeHtml(names.join(' · ') || 'on-chain')}${
        feed?.provider?.whaleAlert ? ' · Whale Alert' : ''} — ${watchable} of the top 50
         watchable · $1M floor · updated ${escapeHtml(new Date(lastAt).toLocaleTimeString())}
         ${names.some((n) => n.endsWith('*')) ? '<br>* sampled each poll rather than swept in full' : ''}`
      : 'Reading the chains…';
  }
}

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

async function load() {
  loading = !flow && !feed;
  draw();

  const [read, next, market] = await Promise.all([
    fetchVerdict({ symbol, window: win, band }),
    fetchTransfers({ symbol, band }),
    // No symbol: this one is about the market, whatever coin is selected.
    fetchNetflow(),
  ]);
  loading = false;
  if (next?.rows?.length || !feed || next?.provider) feed = next;
  if (read?.error == null || !reading) reading = read;
  if (market?.error == null || !netflow) netflow = market;
  /**
   * One request now carries what three used to.
   *
   * A refresh that came back empty replaces what was there, and it should: the
   * band or the window may have just changed, and holding the previous answer
   * would show one filter's results under another filter's label.
   */
  flow = reading ? { ranked: reading.ranked, observed: reading.observed } : flow;
  holders = reading ? { moves: reading.holders } : holders;
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
 * Sixty seconds, matching the rate at which the server actually asks the
 * provider — polling faster would only re-read the same store. An off-screen or
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
