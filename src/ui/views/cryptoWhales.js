/**
 * The crypto whale page.
 *
 * On top, unchanged: stablecoin dominance, exchange netflow and the top holders
 * of the chosen coin (whaleOverview.js), with the coin strip. Below them, in
 * place of the old transfer tape, two sections about the top-fifty coins,
 * stablecoins left out:
 *
 *   Leveraged  whales opening and closing leveraged positions — OPEN LONG,
 *              CLOSE SHORT and so on — on Hyperliquid (live, in the browser)
 *              and GMX (collected by the server every ten minutes).
 *   Spot       whales buying and selling on decentralised exchanges. Only
 *              buys and sells: no transfers between wallets or exchanges.
 *
 * The coin strip chooses the coin for the holder card and both sections.
 */
import {
  BANDS, SPOT_BANDS, bandOf, filterRows, summarise, groupFills, hyperliquidMarkets,
  hyperliquidAction, leveragedLabel, filterLeveraged, summariseLeveraged,
  leverageText, positionStory, walletLink, shortAddress,
} from '../../services/whaleTrades.js';
import {
  renderOverview, tickOverview, setCoinListener, overviewCoins,
} from './whaleOverview.js';
import { escapeHtml } from '../format.js';

const el = (id) => document.getElementById(id);

const HL_INFO = 'https://api.hyperliquid.xyz/info';
const HL_WS = 'wss://api.hyperliquid.xyz/ws';
const HL_KEY = 'pt_hl_orders_v2';
const DAY = 86_400;

let coin = '';
let coins = [];

/** Each section's own filters. */
const sections = {
  lev: { band: 'all', side: 'both', span: DAY },
  spot: { band: 'all', side: 'both', span: DAY },
};

let spotRows = [];
let gmxRows = [];
let hlRows = readHyperliquid();
/** What each opening is worth now, kept apart from the rows so a refresh cannot wipe it. */
const live = new Map();
let loadedAt = 0;
let loadError = '';
const hl = { socket: null, markets: new Map(), status: 'idle', open: new Map(), sweep: null };

/* ── formatting ──────────────────────────────────────────────────────── */

function money(usd) {
  const a = Math.abs(usd);
  const s = a >= 1e9 ? `$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : `$${Math.round(a / 1e3).toLocaleString()}k`;
  return usd < 0 ? `−${s}` : s;
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

function walletHtml(r) {
  if (!r.address) return '<span class="wt-wallet">—</span>';
  const link = walletLink(r);
  const text = escapeHtml(shortAddress(r.address));
  return link
    ? `<a class="wt-wallet" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(r.address)}">${text}</a>`
    : `<span class="wt-wallet" title="${escapeHtml(r.address)}">${text}</span>`;
}

function coinHtml(symbol) {
  const logo = coins.find((c) => c.symbol === symbol)?.logo;
  return `<div class="wt-coin">${logo ? `<img src="${escapeHtml(logo)}" alt="" width="16" height="16" loading="lazy">` : ''}${escapeHtml(symbol)}</div>`;
}

function rowHtml(r, pill, where, story = '') {
  return `<div class="wt-row${story ? '' : ' wt-grid'}">${story ? '<div class="wt-grid">' : ''}
    <div class="wt-when" title="${escapeHtml(new Date(r.at * 1000).toLocaleString())}">${escapeHtml(ago(r.at))}</div>
    ${coinHtml(r.symbol)}
    <div class="wt-act">${pill}<span class="wt-where">${escapeHtml(where)}</span></div>
    <div class="wt-usd">${escapeHtml(money(r.usd))}<span class="wt-amt">${escapeHtml(amountText(r.amount))} ${escapeHtml(r.symbol)}</span></div>
    <div>${walletHtml(r)}</div>
  ${story ? `</div><div class="wt-story">${escapeHtml(story)}</div>` : ''}</div>`;
}

function leveragedRow(r) {
  const { text, bullish, opening } = leveragedLabel(r);
  const lev = leverageText(r);
  const pill = `<span class="wt-pill ${bullish ? 'is-buy' : 'is-sell'}${opening ? '' : ' is-flow'}">${escapeHtml(text)}${
    lev ? `<span class="wt-lev">${escapeHtml(lev)}</span>` : ''}</span>`;
  const venue = r.source === 'hyperliquid' ? 'Hyperliquid' : `GMX · ${r.network === 'avalanche' ? 'Avalanche' : 'Arbitrum'}`;
  return rowHtml(r, pill, venue, positionStory({ ...r, live: live.get(r.id) }));
}

function spotRow(r) {
  const pill = r.side === 'buy'
    ? '<span class="wt-pill is-buy">BUY</span>'
    : '<span class="wt-pill is-sell">SELL</span>';
  return rowHtml(r, pill, `${dexName(r.dex)} · ${r.network}`);
}

const HEAD = '<div class="wt-head wt-grid"><div>When</div><div>Coin</div><div>Action</div><div>Value</div><div>Wallet</div></div>';

/* ── drawing ─────────────────────────────────────────────────────────── */

function pickerHtml(items, current) {
  return items.map(([id, label, count]) => `<button class="opt-tab${String(id) === String(current) ? ' active' : ''}${count === 0 ? ' is-empty' : ''}"
    data-value="${escapeHtml(String(id))}">${escapeHtml(label)}${count == null ? '' : `<span class="gam-count">${count}</span>`}</button>`).join('');
}

const leveragedRows = () => [...hlRows, ...gmxRows];

function drawSection(key) {
  const f = sections[key];
  const since = Math.floor(Date.now() / 1000) - f.span;
  const lev = key === 'lev';
  const all = lev ? leveragedRows() : spotRows;
  const pick = lev ? filterLeveraged : filterRows;
  const base = { coin, side: f.side, since };

  const bands = lev ? BANDS : SPOT_BANDS;
  const bandCounts = new Map(bands.map((b) => [b.id, pick(all, { ...base, band: b.id }).length]));
  el(`${key}Band`).innerHTML = pickerHtml(bands.map((b) => [b.id, b.label, bandCounts.get(b.id)]), f.band);
  el(`${key}Side`).innerHTML = pickerHtml(lev
    ? [['both', 'Longs & shorts'], ['long', 'Longs'], ['short', 'Shorts']]
    : [['both', 'Buys & sells'], ['buy', 'Buys'], ['sell', 'Sells']], f.side);
  el(`${key}Span`).innerHTML = pickerHtml([[DAY, '24h'], [7 * DAY, '7d']], f.span);

  const rows = pick(all, { ...base, band: f.band });
  const summary = el(`${key}Summary`);
  if (lev) {
    const s = summariseLeveraged(rows);
    summary.innerHTML = rows.length
      ? `<span class="cw-in">Opened long ${money(s.longUsd)} <small>(${s.longs})</small></span>
         <span class="cw-out">Opened short ${money(s.shortUsd)} <small>(${s.shorts})</small></span>
         <span class="wt-muted">Closed ${money(s.closedUsd)} <small>(${s.closes})</small></span>`
      : '';
  } else {
    const s = summarise(rows);
    const net = s.net >= 0 ? `net buying ${money(s.net)}` : `net selling ${money(-s.net)}`;
    summary.innerHTML = rows.length
      ? `<span class="cw-in">Bought ${money(s.buyUsd)} <small>(${s.buys})</small></span>
         <span class="cw-out">Sold ${money(s.sellUsd)} <small>(${s.sells})</small></span>
         <span class="wt-net ${s.net >= 0 ? 'cw-in' : 'cw-out'}">${net}</span>`
      : '';
  }

  const shown = rows.slice(0, 150);
  el(`${key}Rows`).innerHTML = shown.length
    ? HEAD + shown.map(lev ? leveragedRow : spotRow).join('')
    : `<div class="empty">${escapeHtml(emptyText(key))}</div>`;

  el(`${key}Src`).textContent = lev ? leveragedSource() : spotSource();
}

function emptyText(key) {
  const f = sections[key];
  const b = bandOf(f.band, key === 'lev' ? BANDS : SPOT_BANDS).label;
  const what = coin || 'the top-50 coins';
  if (key === 'lev') {
    return `No ${b} leveraged trades on ${what} in this period. Hyperliquid trades appear here the moment they fill.`;
  }
  if (loadError) return loadError;
  return `No ${b} spot buys or sells of ${what} in this period.${coin ? ' Some coins trade almost only on centralised exchanges, where wallets are not public.' : ''}`;
}

function leveragedSource() {
  const live = {
    live: `Hyperliquid live (${hl.markets.size} of ${coins.length} coins)`,
    connecting: 'Hyperliquid connecting…',
    closed: 'Hyperliquid reconnecting…',
    idle: 'Hyperliquid',
  }[hl.status] ?? 'Hyperliquid';
  return `${live} · GMX on Arbitrum and Avalanche, every 10 minutes · P&L is the profit or loss realised by a close`;
}

function spotSource() {
  return loadedAt
    ? `Uniswap, PancakeSwap, Raydium and other on-chain exchanges via GeckoTerminal · trading bots removed · updated ${ago(Math.floor(loadedAt / 1000))}`
    : 'Loading…';
}

function draw() {
  if (!el('levRows')) return;
  drawSection('lev');
  drawSection('spot');
}

/* ── the server's side: spot trades and GMX ──────────────────────────── */

async function loadServer() {
  try {
    const [spot, lev] = await Promise.all([
      fetch('/api/whales?resource=spot', { credentials: 'same-origin' }),
      fetch('/api/whales?resource=leveraged', { credentials: 'same-origin' }),
    ]);
    if (!spot.ok) throw new Error(spot.status === 401 ? 'Sign in to see whale trades.' : `The server answered ${spot.status}.`);
    const json = await spot.json();
    if (Array.isArray(json.coins) && json.coins.length) coins = json.coins;
    spotRows = Array.isArray(json.rows) ? json.rows : [];
    if (lev.ok) gmxRows = (await lev.json())?.rows ?? gmxRows;
    loadedAt = Date.now();
    loadError = '';
  } catch (err) {
    loadError = err.message || 'Could not load the whale trades.';
  }
  draw();
  // The rows are here; now ask what became of the positions they opened.
  refreshLive();
}

/* ── Hyperliquid, live ───────────────────────────────────────────────── */

function readHyperliquid() {
  try {
    const rows = JSON.parse(localStorage.getItem(HL_KEY) ?? '[]');
    const since = Math.floor(Date.now() / 1000) - 7 * DAY;
    return Array.isArray(rows) ? rows.filter((r) => r?.at >= since) : [];
  } catch {
    return [];
  }
}

function saveHyperliquid() {
  try { localStorage.setItem(HL_KEY, JSON.stringify(hlRows.slice(0, 200))); } catch { /* ignore */ }
}

/**
 * Fills of one order arrive within a moment of each other, sometimes split
 * across messages. Each order is kept open and added to as its fills come in,
 * and kept from $500k, two seconds after its last fill; the bands decide what shows.
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
    if (open) { open.amount += o.amount; open.usd += o.usd; open.tids.push(...o.tids); open.seen = now; } else hl.open.set(o.id, { ...o, seen: now });
  }
  if (!hl.sweep) hl.sweep = setInterval(settleOrders, 1_000);
}

function settleOrders() {
  const now = Date.now();
  for (const [id, o] of hl.open) {
    if (now - o.seen < SETTLE_MS) continue;
    hl.open.delete(id);
    if (o.usd >= 500_000 && !hlRows.some((r) => r.id === id)) classify(o);
  }
}

/**
 * What the wallet holds on Hyperliquid right now: the leverage it is running,
 * where it got in, and where it would be liquidated.
 */
async function hyperliquidPosition(address, symbol) {
  const res = await fetch(HL_INFO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'clearinghouseState', user: address }),
  });
  const state = await res.json();
  const market = hl.markets.get(symbol)?.market ?? symbol;
  const held = (state?.assetPositions ?? []).map((a) => a?.position).find((p) => p?.coin === market);
  if (!held) return null;
  return {
    leverage: Number(held.leverage?.value) || null,
    entry: Number(held.entryPx) || null,
    liq: Number(held.liquidationPx) || null,
    pnl: Number(held.unrealizedPnl),
    roe: Number(held.returnOnEquity),
  };
}

/**
 * Ask the wallet's own fills what the order did.
 *
 * The public trade says buy or sell. The wallet's fill says "Open Long",
 * "Close Short" and so on, and carries the profit a close realised. If the
 * lookup fails the order still shows, as the long or short side it bought or
 * sold into.
 */
async function classify(o) {
  const { seen, tids, ...order } = o;
  const ids = new Set(tids);
  let action = null;
  let pnl = null;
  try {
    const res = await fetch(HL_INFO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'userFillsByTime', user: o.address, startTime: o.at * 1000 - 60_000, endTime: o.at * 1000 + 60_000,
      }),
    });
    const fills = (await res.json()).filter((f) => ids.has(f.tid) || (o.hash && f.hash === o.hash));
    if (fills.length) {
      action = hyperliquidAction(fills[0], fills.reduce((sum, f) => sum + Number(f.sz), 0));
      pnl = fills.reduce((sum, f) => sum + (Number(f.closedPnl) || 0), 0);
    }
  } catch { /* shown by its side alone */ }
  const row = {
    ...order,
    verb: action?.verb ?? 'unknown',
    side: action?.side ?? (order.side === 'buy' ? 'long' : 'short'),
    pnl: action && action.verb !== 'open' && action.verb !== 'add' ? pnl : null,
  };

  // The position behind the order: its leverage, entry and liquidation price.
  if (row.verb === 'open' || row.verb === 'add' || row.verb === 'flip') {
    try {
      const held = await hyperliquidPosition(row.address, row.symbol);
      if (held) Object.assign(row, { leverage: held.leverage, entry: held.entry, liq: held.liq });
    } catch { /* the size and side still stand */ }
  }
  hlRows = [row, ...hlRows.filter((r) => r.id !== row.id)]
    .filter((r) => r.at >= Math.floor(Date.now() / 1000) - 7 * DAY)
    .sort((a, b) => b.at - a.at);
  saveHyperliquid();
  draw();
}

async function connectHyperliquid() {
  if (hl.socket || hl.status === 'connecting' || !coins.length) return;
  hl.status = 'connecting';
  try {
    const res = await fetch(HL_INFO, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'meta' }),
    });
    const meta = await res.json();
    hl.markets = hyperliquidMarkets(coins.map((c) => c.symbol), meta?.universe);
  } catch {
    hl.status = 'closed';
    setTimeout(connectHyperliquid, 15_000);
    return;
  }

  const socket = new WebSocket(HL_WS);
  hl.socket = socket;
  socket.addEventListener('open', () => {
    hl.status = 'live';
    for (const { market } of hl.markets.values()) {
      socket.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'trades', coin: market } }));
    }
    draw();
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
    draw();
    setTimeout(connectHyperliquid, 5_000);
  });
}

/* ── following the open positions ────────────────────────────────────── */

const GMX_GRAPHQL = {
  arbitrum: 'https://gmx.squids.live/gmx-synthetics-arbitrum:prod/api/graphql',
  avalanche: 'https://gmx.squids.live/gmx-synthetics-avalanche:prod/api/graphql',
};

const GMX_POSITIONS = `query($accounts: [String!]!) {
  positions(limit: 200, where: { account_in: $accounts, isSnapshot_eq: false }) {
    account market isLong unrealizedPnl sizeInUsd leverage
  }
}`;

/** GMX carries dollars with thirty decimals. */
const gmxUsd = (raw) => Number(BigInt(raw ?? 0) / 10n ** 24n) / 1e6;

/**
 * Keep the openings up to date: what each position is worth now, and whether
 * it is still there at all. Only the newest few are followed, so the panel
 * costs a handful of requests a minute however long the list is.
 */
const FOLLOWED = 12;

async function refreshLive() {
  const open = leveragedRows()
    .filter((r) => ['open', 'add', 'flip'].includes(r.verb))
    .slice(0, FOLLOWED);
  if (!open.length) return;
  let changed = false;

  for (const r of open.filter((x) => x.source === 'hyperliquid')) {
    try {
      const held = await hyperliquidPosition(r.address, r.symbol);
      live.set(r.id, held ? { pnl: held.pnl, roe: held.roe } : { gone: true });
      changed = true;
    } catch { /* leave the row as it was */ }
  }

  for (const [network, url] of Object.entries(GMX_GRAPHQL)) {
    const rows = open.filter((r) => r.source === 'gmx' && r.network === network && r.market);
    if (!rows.length) continue;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: GMX_POSITIONS, variables: { accounts: [...new Set(rows.map((r) => r.address))] } }),
      });
      const held = new Map(((await res.json())?.data?.positions ?? []).map((p) => [
        `${String(p.account).toLowerCase()}|${String(p.market).toLowerCase()}|${p.isLong ? 'long' : 'short'}`,
        { pnl: gmxUsd(p.unrealizedPnl), size: gmxUsd(p.sizeInUsd), leverage: Number(p.leverage) / 10_000 },
      ]));
      for (const r of rows) {
        const p = held.get(`${r.address.toLowerCase()}|${String(r.market).toLowerCase()}|${r.side}`);
        live.set(r.id, p ? { pnl: p.pnl, roe: p.leverage > 0 && p.size > 0 ? p.pnl / (p.size / p.leverage) : null } : { gone: true });
        changed = true;
      }
    } catch { /* leave those rows as they were */ }
  }

  if (changed) draw();
}

/* ── wiring ──────────────────────────────────────────────────────────── */

function bind() {
  const card = el('cryptoWhaleCard');
  if (!card || card.dataset.tradesBound === '1') return;
  card.dataset.tradesBound = '1';
  for (const key of Object.keys(sections)) {
    for (const [part, field, cast] of [['Band', 'band', String], ['Side', 'side', String], ['Span', 'span', Number]]) {
      el(`${key}${part}`)?.addEventListener('click', (e) => {
        const value = e.target.closest('button[data-value]')?.dataset.value;
        if (value == null) return;
        sections[key][field] = cast(value);
        drawSection(key);
      });
    }
  }
  setCoinListener((symbol) => { coin = symbol; draw(); });
}

export async function renderCryptoWhales() {
  bind();
  draw();
  renderOverview().then(() => {
    if (!coins.length) coins = overviewCoins().map((c) => ({ symbol: c.symbol, name: c.name, rank: c.rank, logo: c.logo }));
    connectHyperliquid();
    draw();
  });
  await loadServer();
  connectHyperliquid();
}

/**
 * The two trackers inside the Gamble tab.
 *
 * Bound once, on the strip rather than on each button, so redrawing either
 * panel cannot leave a stale handler behind.
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

/** Refreshed every minute while on screen; the cards above keep their own clocks. */
const EVERY_MS = 60_000;
let timer = null;

export function startCryptoWhales() {
  clearInterval(timer);
  timer = setInterval(() => {
    const card = el('cryptoWhaleCard');
    const onScreen = card && card.offsetParent !== null && document.visibilityState === 'visible';
    if (!onScreen) return;
    tickOverview();
    loadServer();
    refreshLive();
  }, EVERY_MS);
}
