/**
 * Large bets on macro events — who placed them, and for how much.
 *
 * The data and the reasoning behind the source are in services/gamble.js. This
 * only draws it: one row per trade, newest first, inside whichever size band is
 * selected.
 *
 * Wallets are shown because they are the point — the same address turning up
 * three times in an hour is the thing worth seeing, and a pseudonym alone
 * cannot tell you that. They are public Polygon addresses, linked back to the
 * profile page they came from.
 */
import { escapeHtml } from '../format.js';
import { BANDS, bandDef, selectTrades, whaleTrades } from '../../services/gamble.js';

const el = (id) => document.getElementById(id);

/** Which band is showing. Survives a re-render, like the other panels. */
let band = 'small';
let lastRows = null;

/** "2m", "4h", "3d" — enough to place a trade without a full timestamp. */
function ago(seconds) {
  const secs = Math.max(0, Math.floor(Date.now() / 1000) - seconds);
  if (secs < 60) return 'now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const money = (n) => `$${n.toLocaleString('en-US')}`;

/**
 * One row.
 *
 * Buying "No" at eighty cents and selling "Yes" at twenty are the same trade
 * seen from either end, so the side and the outcome are shown together and
 * neither is coloured — which way a bet leans is the reader's inference, and a
 * green BUY on "No" would push them the wrong way.
 */
function row(t) {
  return `<div class="gam-row gam-grid">
    <div class="gam-size">${escapeHtml(money(t.usd))}</div>
    <div class="gam-who">
      <span class="gam-name">${escapeHtml(t.trader)}</span>
      <a class="gam-wallet" href="https://polymarket.com/profile/${escapeHtml(t.wallet)}"
         target="_blank" rel="noopener noreferrer"
         title="${escapeHtml(t.wallet)}">${escapeHtml(t.shortWallet)}</a>
    </div>
    <div class="gam-bet">
      <span class="gam-side">${escapeHtml(t.side)}</span>
      <span class="gam-outcome">${escapeHtml(t.outcome)}</span>
      <span class="gam-price">${(t.price * 100).toFixed(0)}¢</span>
    </div>
    <div class="gam-market">
      <span class="gam-title">${escapeHtml(t.title)}</span>
      <span class="gam-topic">${escapeHtml(t.topicLabel)}</span>
    </div>
    <div class="gam-when">${escapeHtml(ago(t.at))}</div>
  </div>`;
}

function draw() {
  const rows = el('gamRows');
  if (!rows) return;

  const picker = el('gamBand');
  if (picker) {
    picker.innerHTML = BANDS.map((b) =>
      `<button class="opt-tab${b.id === band ? ' active' : ''}"
        data-band="${b.id}">${escapeHtml(b.label)}</button>`).join('');
    picker.onclick = (e) => {
      const id = e.target?.dataset?.band;
      if (!id || id === band) return;
      band = id;
      draw();
    };
  }

  const trades = selectTrades(lastRows, { band });

  /**
   * An empty band is a real answer and says so. The largest band is empty most
   * of the time — that is what makes it worth watching — and "nothing this big
   * has traded" must not read as a panel that failed to load.
   */
  rows.innerHTML = trades.length
    ? `<div class="gam-head gam-grid">
         <div>Size</div><div>Whale</div><div>Bet</div><div>Market</div><div>When</div>
       </div>${trades.map(row).join('')}`
    : `<div class="empty">No ${escapeHtml(bandDef(band).label)} bets on macro
       in the last few hundred trades.</div>`;
}

/**
 * Fetch and draw. Null leaves whatever is on screen rather than blanking it —
 * a feed that missed one poll has not changed what was true a minute ago.
 */
export async function renderGamble() {
  const card = el('gambleCard');
  if (!card) return;

  const rows = await whaleTrades();
  if (rows) lastRows = rows;

  card.style.display = lastRows ? '' : 'none';
  if (lastRows) draw();
}

/**
 * Keep it live while it is on screen.
 *
 * Thirty seconds. The feed is public, cheap and unauthenticated, but it is
 * somebody else's and a panel nobody is looking at should not be polling it —
 * so an off-screen or backgrounded page skips the fetch and keeps the timer.
 */
const EVERY_MS = 30_000;
let timer = null;

export function startGamble() {
  clearInterval(timer);
  timer = setInterval(() => {
    const card = el('gambleCard');
    const onScreen = card && card.offsetParent !== null
      && document.visibilityState === 'visible';
    if (onScreen) renderGamble();
  }, EVERY_MS);
}
