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
  shortAddress, money, tokens,
} from '../../services/cryptoWhales.js';

const el = (id) => document.getElementById(id);

/** Survives a re-render, like the other panels. */
let band = 'all';
let symbol = '';
let coins = null;
let feed = null;
let loading = false;
let lastAt = 0;

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
    const title = watchable
      ? `${c.name} · ${c.chains.map(chainLabel).join(', ')}`
      : `${c.name} · no on-chain whale coverage`;

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
  if (provider?.configured === false) {
    return `No on-chain provider is configured on this deployment. Set
      <code>WHALE_ALERT_KEY</code> in the Vercel environment and the feed starts
      filling on the next refresh.`;
  }
  if (provider?.configured === null) {
    return 'Could not reach the tracker. It will try again shortly.';
  }
  if (provider?.error) {
    return `The on-chain provider is not answering right now (${escapeHtml(provider.error)}).
      Anything already recorded is still shown.`;
  }
  const where = symbol ? `${escapeHtml(symbol)} ` : '';
  return `No ${where}transfers in the ${escapeHtml(bandDef(band).label)} range yet.
    The record starts when the panel is first opened and grows from there.`;
}

function draw() {
  const rows = el('cwRows');
  if (!rows) return;

  drawBands();
  drawCoins();

  const name = el('cwName');
  if (name) name.textContent = symbol ? symbol : 'all coins';

  const transfers = selectTransfers(feed?.rows, { band });

  rows.innerHTML = transfers.length
    ? `<div class="gam-head gam-grid cw-grid">
         <div>Size</div><div>From → To</div><div>Direction</div><div>Asset · chain</div><div>When</div>
       </div>${transfers.map(row).join('')}`
    : `<div class="empty">${loading ? 'Loading…' : emptyMessage()}</div>`;

  const src = el('cwSrc');
  if (src) {
    const chains = coins?.chains?.length ?? 0;
    const watchable = coins?.watchable ?? 0;
    src.innerHTML = lastAt
      ? `Whale Alert · ${chains} chains, ${watchable} of the top 50 watchable ·
         $20M floor · updated ${escapeHtml(new Date(lastAt).toLocaleTimeString())}`
      : 'Whale Alert · on-chain';
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
  loading = !feed;
  draw();
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
