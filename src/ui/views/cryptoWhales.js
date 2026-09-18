/**
 * Crypto whales: big buys and sells of the top-fifty coins, in two parts.
 *
 *   Spot       real purchases and sales — trades on decentralised exchanges,
 *              plus coins withdrawn from or deposited to exchanges, which is
 *              how buying and selling on Binance or Coinbase shows on-chain.
 *              From this app's server, which collects every ten minutes.
 *   Leveraged  Hyperliquid, live. Every trade there is public with both
 *              wallets, so a whale's order appears the moment it fills.
 *
 * Only buys and sells: no transfers between wallets, no internal moves.
 */
import {
  BANDS, bandOf, filterRows, summarise, countByBand, groupFills, hyperliquidMarkets,
  walletLink, shortAddress,
} from '../../services/whaleTrades.js';
import { escapeHtml } from '../format.js';

const el = (id) => document.getElementById(id);

const HL_INFO = 'https://api.hyperliquid.xyz/info';
const HL_WS = 'wss://api.hyperliquid.xyz/ws';
const LEVERAGED_KEY = 'pt_hl_orders';
const DAY = 86_400;

let mode = 'spot';
let coin = '';
let band = 'all';
let side = 'both';
let span = DAY;

let coins = [];
let spotRows = [];
let spotLoadedAt = 0;
let spotError = '';
let leveragedRows = readLeveraged();
let hl = { socket: null, markets: new Map(), status: 'idle', open: new Map(), sweep: null };

/* ── formatting ──────────────────────────────────────────────────────── */

function money(usd) {
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(2)}M`;
  return `$${Math.round(usd / 1e3).toLocaleString()}k`;
}

function amountText(n) {
  if (!(n > 0)) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return Math.round(n).toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: n >= 100 ? 1 : 3 });
}

function ago(at) {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - at);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < DAY) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / DAY)}d ago`;
}

const DEX_NAMES = {
  uniswap_v3: 'Uniswap', uniswap_v2: 'Uniswap', uniswap_v4: 'Uniswap', pancakeswap_v3: 'PancakeSwap',
  'pancakeswap-v3-bsc': 'PancakeSwap', raydium: 'Raydium', 'raydium-clmm': 'Raydium', orca: 'Orca',
  aerodrome: 'Aerodrome', 'aerodrome-slipstream': 'Aerodrome', curve: 'Curve', meteora: 'Meteora',
};
const dexName = (id) => DEX_NAMES[id] ?? (id ? String(id).split(/[_-]/)[0].replace(/^./, (c) => c.toUpperCase()) : 'DEX');

/** The action pill, and the line under it saying where the trade happened. */
function action(r) {
  if (r.side === 'withdraw') {
    return ['wt-pill is-buy is-flow', 'WITHDRAWN', `Left ${r.venue} — held`];
  }
  if (r.side === 'deposit') {
    return ['wt-pill is-sell is-flow', 'DEPOSITED', `Sent to ${r.venue} — may sell`];
  }
  const where = r.source === 'hyperliquid' ? 'Hyperliquid perp' : `${dexName(r.dex)} · ${r.network}`;
  return r.side === 'buy' ? ['wt-pill is-buy', 'BUY', where] : ['wt-pill is-sell', 'SELL', where];
}

function rowHtml(r) {
  const [pill, label, where] = action(r);
  const link = walletLink(r);
  const wallet = r.address
    ? (link
      ? `<a class="wt-wallet" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(r.address)}">${escapeHtml(shortAddress(r.address))}</a>`
      : `<span class="wt-wallet" title="${escapeHtml(r.address)}">${escapeHtml(shortAddress(r.address))}</span>`)
    : '<span class="wt-wallet">—</span>';
  const logo = coins.find((c) => c.symbol === r.symbol)?.logo;
  return `<div class="wt-row wt-grid">
    <div class="wt-when" title="${escapeHtml(new Date(r.at * 1000).toLocaleString())}">${escapeHtml(ago(r.at))}</div>
    <div class="wt-coin">${logo ? `<img src="${escapeHtml(logo)}" alt="" width="16" height="16" loading="lazy">` : ''}${escapeHtml(r.symbol)}</div>
    <div class="wt-act"><span class="${pill}">${label}</span><span class="wt-where">${escapeHtml(where)}</span></div>
    <div class="wt-amt">${escapeHtml(amountText(r.amount))} <span>${escapeHtml(r.symbol)}</span></div>
    <div class="wt-usd">${escapeHtml(money(r.usd))}</div>
    <div>${wallet}</div>
  </div>`;
}

/* ── drawing ─────────────────────────────────────────────────────────── */

function pickerHtml(items, current, attr) {
  return items.map(([id, label, count]) => `<button class="opt-tab${id === current ? ' active' : ''}${count === 0 ? ' is-empty' : ''}"
    data-${attr}="${escapeHtml(id)}">${escapeHtml(label)}${count == null ? '' : `<span class="gam-count">${count}</span>`}</button>`).join('');
}

function currentRows() {
  return mode === 'spot' ? spotRows : leveragedRows;
}

function draw() {
  const host = el('cwRows');
  if (!host) return;

  const since = Math.floor(Date.now() / 1000) - span;
  const base = { coin, side, since };
  const all = currentRows();

  el('cwMode').innerHTML = pickerHtml([['spot', 'Spot'], ['leveraged', 'Leveraged']], mode, 'mode');
  el('cwExplain').textContent = mode === 'spot'
    ? 'Real purchases and sales. BUY / SELL are trades on decentralised exchanges; WITHDRAWN / DEPOSITED are coins leaving or entering Binance, Coinbase and other exchanges — kept, or made ready to sell.'
    : 'Leveraged bets on Hyperliquid, live: a BUY is a bet the price rises, a SELL that it falls. Orders appear as they fill while this page is open.';

  const select = el('cwCoin');
  if (select) {
    const counts = new Map();
    for (const r of filterRows(all, { ...base, coin: '', band })) counts.set(r.symbol, (counts.get(r.symbol) ?? 0) + 1);
    const options = [`<option value="">All top-50 coins (${filterRows(all, { ...base, coin: '', band }).length})</option>`]
      .concat(coins.map((c) => {
        const noMarket = mode === 'leveraged' && hl.markets.size && !hl.markets.has(c.symbol);
        return `<option value="${escapeHtml(c.symbol)}"${c.symbol === coin ? ' selected' : ''}>#${c.rank} ${escapeHtml(c.symbol)} — ${escapeHtml(c.name)}${noMarket ? ' (not on Hyperliquid)' : ` (${counts.get(c.symbol) ?? 0})`}</option>`;
      }));
    select.innerHTML = options.join('');
  }

  const bandCounts = countByBand(all, base);
  el('cwBand').innerHTML = pickerHtml(BANDS.map((b) => [b.id, b.label, bandCounts.get(b.id)]), band, 'band');
  el('cwSide').innerHTML = pickerHtml([['both', 'Buys & sells'], ['buy', 'Buys'], ['sell', 'Sells']], side, 'side');
  el('cwSpan').innerHTML = pickerHtml(mode === 'spot' ? [[String(DAY), '24h'], [String(7 * DAY), '7d']] : [[String(DAY), '24h']], String(span), 'span');

  const rows = filterRows(all, { ...base, band });
  const s = summarise(rows);
  const net = s.net >= 0 ? `net buying ${money(s.net)}` : `net selling ${money(-s.net)}`;
  el('cwSummary').innerHTML = rows.length
    ? `<span class="cw-in">Buying ${money(s.buyUsd)} <small>(${s.buys})</small></span>
       <span class="cw-out">Selling ${money(s.sellUsd)} <small>(${s.sells})</small></span>
       <span class="wt-net ${s.net >= 0 ? 'cw-in' : 'cw-out'}">${net}</span>`
    : '';

  const shown = rows.slice(0, 200);
  host.innerHTML = shown.length
    ? `<div class="wt-head wt-grid"><div>When</div><div>Coin</div><div>Action</div><div>Amount</div><div>Value</div><div>Wallet</div></div>${shown.map(rowHtml).join('')}`
    : `<div class="empty">${escapeHtml(emptyText())}</div>`;

  el('cwSrc').textContent = mode === 'spot'
    ? (spotError || (spotLoadedAt ? `On-chain trades via GeckoTerminal · exchange flows from the chains · updated ${ago(Math.floor(spotLoadedAt / 1000))}` : 'Loading…'))
    : ({
      live: `Live from Hyperliquid · ${hl.markets.size} of ${coins.length} coins listed there`,
      connecting: 'Connecting to Hyperliquid…',
      closed: 'Connection to Hyperliquid lost — reconnecting…',
      idle: 'Opens a live connection to Hyperliquid while this page is on screen.',
    })[hl.status] ?? '';
}

function emptyText() {
  const b = bandOf(band).label;
  const what = coin || 'the top-50 coins';
  if (mode === 'leveraged') {
    if (coin && hl.markets.size && !hl.markets.has(coin)) return `${coin} is not traded on Hyperliquid.`;
    return `No ${b} leveraged orders on ${what} yet — they appear here as they happen.`;
  }
  if (spotError) return spotError;
  return `No ${b} spot buys or sells of ${what} in this period.${coin ? ' Coins that trade mostly on centralised exchanges show only exchange withdrawals and deposits here.' : ''}`;
}

/* ── spot: from the server ───────────────────────────────────────────── */

async function loadSpot() {
  try {
    const res = await fetch('/api/whales?resource=spot', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(res.status === 401 ? 'Sign in to see whale trades.' : `The server answered ${res.status}.`);
    const json = await res.json();
    coins = Array.isArray(json.coins) ? json.coins : coins;
    spotRows = Array.isArray(json.rows) ? json.rows : [];
    spotLoadedAt = Date.now();
    spotError = '';
  } catch (err) {
    spotError = err.message || 'Could not load the spot trades.';
  }
  draw();
}

/* ── leveraged: live from Hyperliquid ────────────────────────────────── */

function readLeveraged() {
  try {
    const rows = JSON.parse(localStorage.getItem(LEVERAGED_KEY) ?? '[]');
    const since = Math.floor(Date.now() / 1000) - DAY;
    return Array.isArray(rows) ? rows.filter((r) => r?.at >= since) : [];
  } catch {
    return [];
  }
}

function saveLeveraged() {
  try { localStorage.setItem(LEVERAGED_KEY, JSON.stringify(leveragedRows.slice(0, 1000))); } catch { /* ignore */ }
}

/**
 * Fills of one order arrive within a moment of each other, sometimes split
 * across messages. Each order is kept open and added to as its fills come in,
 * and judged against the $500k floor two seconds after its last fill.
 *
 * Not a quiet-period timer over all fills: with forty coins streaming there is
 * never a quiet period, and waiting for one meant no order was ever finished.
 */
const SETTLE_MS = 2_000;

function takeFills(fills) {
  const byMarket = new Map([...hl.markets].map(([symbol, m]) => [m.market, { symbol, scale: m.scale }]));
  const orders = groupFills(fills, {
    scaleOf: (m) => byMarket.get(m)?.scale ?? 1,
    symbolOf: (m) => byMarket.get(m)?.symbol ?? m,
  });
  const now = Date.now();
  for (const o of orders) {
    const open = hl.open.get(o.id);
    if (open) { open.amount += o.amount; open.usd += o.usd; open.seen = now; }
    else hl.open.set(o.id, { ...o, seen: now });
  }
  if (!hl.sweep) hl.sweep = setInterval(settleOrders, 1_000);
}

function settleOrders() {
  const now = Date.now();
  const done = [];
  for (const [id, o] of hl.open) {
    if (now - o.seen < SETTLE_MS) continue;
    hl.open.delete(id);
    if (o.usd >= BANDS[0].min) {
      const { seen, ...order } = o;
      done.push(order);
    }
  }
  if (!done.length) return;
  const known = new Set(leveragedRows.map((r) => r.id));
  const fresh = done.filter((o) => !known.has(o.id));
  if (!fresh.length) return;
  const since = Math.floor(now / 1000) - DAY;
  leveragedRows = [...fresh, ...leveragedRows].filter((r) => r.at >= since).sort((a, b) => b.at - a.at);
  saveLeveraged();
  if (mode === 'leveraged') draw();
}

async function connectLeveraged() {
  if (hl.socket || !coins.length) return;
  hl.status = 'connecting';
  try {
    const res = await fetch(HL_INFO, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'meta' }),
    });
    const meta = await res.json();
    hl.markets = hyperliquidMarkets(coins.map((c) => c.symbol), meta?.universe);
  } catch {
    hl.status = 'closed';
    setTimeout(connectLeveraged, 15_000);
    return;
  }

  const socket = new WebSocket(HL_WS);
  hl.socket = socket;
  socket.addEventListener('open', () => {
    hl.status = 'live';
    for (const { market } of hl.markets.values()) {
      socket.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'trades', coin: market } }));
    }
    if (mode === 'leveraged') draw();
  });
  socket.addEventListener('message', (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg?.channel === 'trades' && Array.isArray(msg.data)) takeFills(msg.data);
    } catch { /* not ours */ }
  });
  socket.addEventListener('close', () => {
    hl.socket = null;
    hl.status = 'closed';
    if (mode === 'leveraged') draw();
    setTimeout(connectLeveraged, 5_000);
  });
}

/* ── wiring ──────────────────────────────────────────────────────────── */

function bind() {
  const card = el('cryptoWhaleCard');
  if (!card || card.dataset.bound === '1') return;
  card.dataset.bound = '1';
  card.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode],button[data-band],button[data-side],button[data-span]');
    if (!b) return;
    if (b.dataset.mode) {
      mode = b.dataset.mode;
      if (mode === 'leveraged') { span = DAY; connectLeveraged(); }
    }
    if (b.dataset.band) band = b.dataset.band;
    if (b.dataset.side) side = b.dataset.side;
    if (b.dataset.span) span = Number(b.dataset.span);
    draw();
  });
  el('cwCoin')?.addEventListener('change', (e) => { coin = e.target.value; draw(); });
}

export async function renderCryptoWhales() {
  bind();
  draw();
  await loadSpot();
  // The live connection starts with the panel, so orders are gathered before Leveraged is opened.
  connectLeveraged();
}

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

/** Spot is re-read every minute while on screen; "ago" times tick with it. */
const EVERY_MS = 60_000;
let timer = null;

export function startCryptoWhales() {
  clearInterval(timer);
  timer = setInterval(() => {
    const card = el('cryptoWhaleCard');
    const onScreen = card && card.offsetParent !== null && document.visibilityState === 'visible';
    if (!onScreen) return;
    if (mode === 'spot') loadSpot();
    else draw();
  }, EVERY_MS);
}
