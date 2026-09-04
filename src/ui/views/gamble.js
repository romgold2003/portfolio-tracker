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
import {
  BANDS, bandDef, TOPIC_TABS, countByTopic, selectTrades, whaleTrades,
} from '../../services/gamble.js';

const el = (id) => document.getElementById(id);

/** Subject and size. Both survive a re-render, like the other panels. */
let band = 'small';
let topic = 'all';
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

  const bandPicker = el('gamBand');
  if (bandPicker) {
    bandPicker.innerHTML = BANDS.map((b) =>
      `<button class="opt-tab${b.id === band ? ' active' : ''}"
        data-band="${b.id}">${escapeHtml(b.label)}</button>`).join('');
    bandPicker.onclick = (e) => {
      const id = e.target?.dataset?.band;
      if (!id || id === band) return;
      band = id;
      draw();
    };
  }

  /**
   * The subjects, each carrying how many trades it holds at the chosen size.
   *
   * Counted against the current band rather than the whole feed, so switching
   * to $500k+ shows straight away which subjects anyone is actually betting
   * that big on — usually one, sometimes none.
   */
  const counts = countByTopic(lastRows, band);
  const topics = el('gamTopics');
  if (topics) {
    /**
     * An empty subject stays selected. Bouncing back to "all macro" was worse
     * than the emptiness it was avoiding: pressing Economy and landing on
     * everything reads as the button being broken, and the count on the button
     * has already said there is nothing there.
     */
    topics.innerHTML = TOPIC_TABS.map((t) => {
      const n = counts.get(t.id) ?? 0;
      return `<button class="opt-tab${t.id === topic ? ' active' : ''}${n ? '' : ' is-empty'}"
        data-topic="${t.id}">${escapeHtml(t.label)}<span class="gam-count">${n}</span></button>`;
    }).join('');
    topics.onclick = (e) => {
      const id = e.target?.closest('[data-topic]')?.dataset?.topic;
      if (!id || id === topic) return;
      topic = id;
      draw();
    };
  }

  const name = el('gamTopicName');
  if (name) name.textContent = (TOPIC_TABS.find((t) => t.id === topic) ?? TOPIC_TABS[0]).label.toLowerCase();

  const trades = selectTrades(lastRows, { band, topic });

  /**
   * An empty combination is a real answer and says so. The largest band is
   * empty most of the time — that is what makes it worth watching — and
   * "nothing this big has traded" must not read as a panel that failed to load.
   */
  rows.innerHTML = trades.length
    ? `<div class="gam-head gam-grid">
         <div>Size</div><div>Whale</div><div>Bet</div><div>Market</div><div>When</div>
       </div>${trades.map(row).join('')}`
    : `<div class="empty">No ${escapeHtml(bandDef(band).label)} bets on
       ${escapeHtml((TOPIC_TABS.find((t) => t.id === topic) ?? TOPIC_TABS[0]).label.toLowerCase())}
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
 * The two halves of the News page.
 *
 * Bound once, on the tab strip rather than on each button, so re-rendering
 * either pane cannot leave a stale handler behind.
 */
export function installNewsTabs() {
  const strip = el('newsTabs');
  if (!strip || strip.dataset.bound === '1') return;
  strip.dataset.bound = '1';

  strip.addEventListener('click', (e) => {
    const button = e.target.closest('[data-tab]');
    if (!button) return;
    const wanted = button.dataset.tab;

    for (const b of strip.querySelectorAll('[data-tab]')) {
      b.classList.toggle('active', b.dataset.tab === wanted);
    }
    // `hidden` rather than display, so nothing here has to know what each pane
    // is laid out as.
    el('newsMarket').hidden = wanted !== 'market';
    el('newsGamble').hidden = wanted !== 'gamble';

    // Coming back to a pane that has been sitting behind another for a while
    // should not show what was true when it was last on screen.
    if (wanted === 'gamble') renderGamble();
  });
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
