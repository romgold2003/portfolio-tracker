/**
 * Very large on-chain transfers — who moved what, where, and when.
 *
 * Drawn to match the macro whale tracker beside it: the same band buttons, the
 * same grid, the same row rhythm, the same "an empty band is a real answer"
 * behaviour. Someone who has learned to read one should not have to learn to
 * read the other, so this reuses the gam-* classes rather than inventing a
 * second visual language for the same idea.
 *
 * What is genuinely different gets the extra room: a transfer has two ends and
 * a bet has one, so where the macro row shows a single wallet this one shows a
 * direction, and the size column carries the token amount under the dollars
 * because "eight hundred million dollars" and "ten thousand BTC" are two
 * different facts about the same movement.
 */
import { escapeHtml } from '../format.js';
import {
  BANDS, bandDef, selectTransfers, fetchCoins, fetchTransfers,
  explorerTx, explorerAddress, chainLabel, directionOf, partyName,
  shortAddress, money, tokens, isVoid, activeFor,
  fetchFlow, FLOW_WINDOWS, TREND_TONE,
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
let view = 'wallets';
let flow = null;
let win = '7d';

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
      <span class="gam-title">${escapeHtml(t.symbol)} on ${escapeHtml(chains)}${
  t.parts > 1 ? ` · ${t.parts} parts` : ''}</span>
      <span class="gam-topic">${kindBadge}${href
    ? `<a class="cw-hash" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"
          title="${escapeHtml(t.hash)}">${escapeHtml(shortAddress(t.hash))}</a>`
    : escapeHtml(shortAddress(t.hash))}</span>
    </div>
    <div class="gam-when" title="${escapeHtml(stamp(t.at))}">${escapeHtml(ago(t.at))}</div>
  </div>`;
}

/**
 * One wallet.
 *
 * Net first, because that is the number that means something: in minus out,
 * over the window. A wallet that received and returned the same amount sits at
 * zero and never reaches this list, which is exactly right — a router is not a
 * whale, and on a raw feed routers are most of what you see.
 */
function walletRow(w) {
  const buying = w.netUsd > 0;
  const chain = w.chains[0];
  const href = explorerAddress(chain, w.address);
  const name = w.owner ? w.owner : shortAddress(w.address);
  const held = w.symbols.slice(0, 3)
    .map((s) => `${s.symbol} ${s.netUsd > 0 ? '+' : '−'}${money(Math.abs(s.netUsd))}`).join(' · ');

  return `<div class="gam-row gam-grid cw-grid">
    <div class="gam-size">
      <span class="${buying ? 'cw-in' : 'cw-out'}">${escapeHtml((buying ? '+' : '−') + money(Math.abs(w.netUsd)))}</span>
      <span class="cw-tokens">${escapeHtml(buying ? 'accumulated' : 'distributed')}</span>
    </div>
    <div class="gam-who">
      <span class="gam-name">${href
    ? `<a class="cw-party${w.owner ? ' is-known' : ''}" href="${escapeHtml(href)}"
           target="_blank" rel="noopener noreferrer"
           title="${escapeHtml(w.address)}">${escapeHtml(name)}</a>`
    : escapeHtml(name)}</span>
      <span class="cw-arrow">in ${escapeHtml(money(w.inUsd))} · out ${escapeHtml(money(w.outUsd))}</span>
    </div>
    <div class="gam-bet">
      <span class="cw-dir">${w.transfers} transfer${w.transfers === 1 ? '' : 's'}${
  w.oneWay ? ' · one way' : ''}</span>
    </div>
    <div class="gam-market">
      <span class="gam-title">${escapeHtml(held)}</span>
      <span class="gam-topic">${escapeHtml(w.chains.map(chainLabel).join(' + '))}</span>
    </div>
    <div class="gam-when" title="${escapeHtml(`last seen ${stamp(w.lastAt)}${
  w.firstAt && w.firstAt !== w.lastAt ? ` · first seen ${stamp(w.firstAt)}` : ''}`)}">${
  escapeHtml(ago(w.lastAt))}<span class="cw-span">${escapeHtml(activeFor(w.firstAt, w.lastAt))}</span></div>
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
 * What the whales collectively did, above the list of who did it.
 *
 * The trend word is arithmetic, not a mood: it comes from how one-sided the
 * money was and how many wallets were on the heavy side. Both are shown beside
 * it so it can be argued with, and a reading built on fewer than three wallets
 * says so rather than presenting itself as a consensus.
 */
function drawSummary() {
  const box = el('cwSummary');
  if (!box) return;
  const c = flow?.consensus;
  const s = flow?.stealth;

  if (!c || !c.participants) {
    box.innerHTML = flow?.observed?.transfers
      ? `<div class="cw-note">Watching ${flow.observed.transfers} recorded transfers.
         No wallet has a net position over $1M in this window yet.</div>`
      : '';
    return;
  }

  const tone = TREND_TONE[c.trend] ?? '';
  const stealthBlock = s ? `
    <div class="cw-stealth">
      <div class="cw-stealth-hd">Stealth accumulation detected</div>
      <div class="cw-stealth-body">
        <b>${s.wallets}</b> wallet${s.wallets === 1 ? '' : 's'} ·
        <b>${s.transfers}</b> transfers ·
        combined net <b class="cw-in">+${escapeHtml(money(s.netUsd))}</b> ·
        largest single transfer only ${escapeHtml(money(s.largestUsd))}
        <div class="cw-stealth-note">Not one of them would have appeared in the
          transaction tracker. ${escapeHtml(s.symbols.slice(0, 3)
    .map((x) => `${x.symbol} ${money(x.usd)}`).join(' · '))}</div>
      </div>
    </div>` : '';

  box.innerHTML = `
    <div class="cw-summary">
      <div class="cw-trend ${tone}">${escapeHtml(c.trend)}${
  c.thin ? '<span class="cw-thin">thin — under 3 wallets</span>' : ''}</div>
      <div class="cw-stats">
        <span>Net flow <b class="${c.netUsd >= 0 ? 'cw-in' : 'cw-out'}">${
  escapeHtml((c.netUsd >= 0 ? '+' : '−') + money(Math.abs(c.netUsd)))}</b></span>
        <span>Accumulating <b>${c.accumulating}</b></span>
        <span>Distributing <b>${c.distributing}</b></span>
        <span>Still holding <b>${c.holding}</b></span>
        <span>Transfers <b>${c.transfers}</b></span>
        <span title="Net over gross: how one-sided the money was">Tilt <b>${
  (c.tilt * 100).toFixed(0)}%</b></span>
      </div>
    </div>${stealthBlock}`;
}

function drawWindow() {
  const picker = el('cwWindow');
  if (!picker) return;
  picker.hidden = view !== 'wallets';
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

function drawView() {
  const picker = el('cwView');
  if (!picker) return;
  const tabs = [
    { id: 'wallets', label: 'By whale' },
    { id: 'transfers', label: 'Transfers' },
  ];
  picker.innerHTML = tabs.map((t) =>
    `<button class="opt-tab${t.id === view ? ' active' : ''}"
      data-view="${t.id}">${escapeHtml(t.label)}</button>`).join('');
  picker.onclick = (e) => {
    const id = e.target?.dataset?.view;
    if (!id || id === view) return;
    view = id;
    load();
  };
}

function drawBands() {
  const picker = el('cwBand');
  if (!picker) return;
  // The size bands describe single transfers, so they only apply to that view.
  picker.hidden = view !== 'transfers';
  picker.innerHTML = BANDS.map((b) =>
    `<button class="opt-tab${b.id === band ? ' active' : ''}"
      data-band="${b.id}">${escapeHtml(b.label)}</button>`).join('');
  picker.onclick = (e) => {
    const id = e.target?.dataset?.band;
    if (!id || id === band) return;
    band = id;
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

  drawView();
  drawWindow();
  drawBands();
  drawCoins();
  if (view === 'wallets') drawSummary();
  else { const b = el('cwSummary'); if (b) b.innerHTML = ''; }

  const name = el('cwName');
  if (name) name.textContent = symbol ? symbol : 'all coins';

  if (view === 'wallets') {
    const list = flow?.wallets ?? [];
    rows.innerHTML = list.length
      ? `<div class="gam-head gam-grid cw-grid">
           <div>Net 30d</div><div>Wallet</div><div>Activity</div><div>What · where</div><div>Last</div>
         </div>${list.map(walletRow).join('')}`
      : `<div class="empty">${loading ? 'Loading…' : `No wallet has taken a net
         position over ${escapeHtml(money(500_000))} in this window yet. This view
         wants repeat activity that ends somewhere — a wallet seen once is an
         event rather than a position, and one that received and sent the same
         amount was passing money through, not taking a side. Both are in the
         Transfers view. This fills as the record grows.`}</div>`;
  } else {
    const transfers = selectTransfers(feed?.rows, { band });
    rows.innerHTML = transfers.length
      ? `<div class="gam-head gam-grid cw-grid">
           <div>Size</div><div>From → To</div><div>Direction</div><div>Asset · chain</div><div>When</div>
         </div>${transfers.map(row).join('')}`
      : `<div class="empty">${loading ? 'Loading…' : emptyMessage()}</div>`;
  }

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
  loading = view === 'wallets' ? !flow : !feed;
  draw();

  if (view === 'wallets') {
    const answer = await fetchFlow({ symbol, window: win });
    loading = false;
    if (answer?.wallets?.length || !flow || answer?.error == null) flow = answer;
    lastAt = Date.now();
    draw();
    return;
  }

  const next = await fetchTransfers({ symbol, band });
  loading = false;
  // A poll that failed leaves what was on screen: the feed missing one refresh
  // has not changed what was true a minute ago.
  if (next?.rows?.length || !feed || next?.provider?.configured === false) feed = next;
  else if (next) feed = { ...feed, counts: next.counts, provider: next.provider };
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
