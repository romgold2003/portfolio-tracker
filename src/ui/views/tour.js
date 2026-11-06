/**
 * The tutorial (November 2026): a few slides, each a real screen of Riskbook
 * with red circles and arrows on the buttons that matter, and a line or two on
 * what they do. It opens by itself the first time someone signs in, and from
 * ❔ Help & tutorial in the menu any time after. Swipe, the arrows or the
 * keyboard move through it.
 *
 * The pictures are assets/tour-*.webp and where their buttons sit is
 * tourShots.js, both written by scripts/tour-shots.mjs from the same screens.
 */
import { state, setTourSeen, aboutDue, legalDue, onJournalLoaded } from '../../core/store.js';
import { isUnlocked, isGuest } from '../../core/profiles.js';
import { cloudEnabled } from '../../services/cloud.js';
import { notePage } from '../../services/usage.js';
import { SHOTS } from './tourShots.js';
import { escapeHtml } from '../format.js';

/** Each slide: a picture, the buttons marked on it in order, and what to say. */
export const SLIDES = [
  {
    shot: 'home',
    title: 'Welcome to Riskbook',
    text: 'Your whole portfolio on one screen.',
    marks: [
      ['account', 'Account value', 'What everything is worth right now, cash included.'],
      ['today', 'Today', 'How much your account moved today, in % and $.'],
      ['graph', 'Graph', 'Your account over time. Pick the period above it, and switch between $ and %.'],
      ['allocation', 'Allocation', 'Where your money is, by sector. Point at it to see the holdings inside.'],
    ],
  },
  {
    shot: 'settings',
    title: 'Import from your broker',
    text: 'The fastest way to start: bring in the statement your broker gives you. Every trade, position and deposit comes with it.',
    marks: [
      ['settings', 'Settings & import', 'Open it from the menu on the left.'],
      ['importButton', 'Import my broker file', 'Press it, then pick your broker.'],
    ],
  },
  {
    shot: 'import',
    title: 'Pick your broker',
    text: 'Interactive Brokers, Robinhood, Schwab, eToro, the Israeli banks and more.',
    note: 'Not in the list? Choose Another broker: any CSV or Excel file works, in any language.',
    marks: [
      ['search', 'Find it', 'Type its name, in English or Hebrew.'],
      ['brokerTile', 'Pick it', 'Riskbook shows the exact steps to get your file.'],
    ],
  },
  {
    shot: 'guide',
    title: 'Follow the steps, then add the file',
    text: 'Your broker is remembered, so next time it opens straight here.',
    marks: [
      ['steps', 'Get your file', 'The steps for your broker, one by one.'],
      ['firstYear', 'A year', 'Click the year your file covers. Add earlier years the same way.'],
      ['whole', 'Whole history', 'Or one file that covers every year at once.'],
    ],
  },
  {
    shot: 'home',
    title: 'Add trades and money moves',
    text: 'Keep your journal up to date in a click.',
    marks: [
      ['newTrade', '+ New trade', 'Log a buy or a short by hand, with why you took it.'],
      ['withdraw', '↓ Withdraw', 'Record money you took out of your broker, so it is not counted as a loss.'],
      ['daily', 'Daily returns', 'Every trading day of the year, green and red. Open a day to see each holding.'],
    ],
  },
  {
    shot: 'positions',
    title: 'Your positions',
    text: 'Everything you hold, with live prices.',
    marks: [
      ['card', 'Open a position', 'Click any row to see its price, shares, amount invested and profit.'],
      ['dca', '+ DCA', 'Add to it, and see your new average price before you confirm.'],
      ['close', 'Close', 'Sell all of it, or only part — 25%, 50%, any amount.'],
      ['columns', 'Columns', 'Pick the columns you want, drag them in order, and click any heading to sort.'],
    ],
  },
  {
    shot: 'monthly',
    title: 'Month by month',
    text: 'See what you actually made.',
    marks: [
      ['chart', 'The year', 'What the trades closed each month made, in green and red.'],
      ['months', 'Every month', 'What your trades made, and what the whole account did. Open a month for its trades.'],
    ],
  },
  {
    shot: 'news',
    title: 'Markets and friends',
    text: 'Everything around your portfolio, a click away.',
    marks: [
      ['navNews', 'News', 'The Fed’s next decision, earnings of the companies you follow, economic data and prediction markets.'],
      ['navCrypto', 'Crypto', 'Large transfers, ETF flows and your crypto journal.'],
      ['navFriends', 'Friends', 'Add friends by email, see what they invest in if they share it, and chat.'],
    ],
  },
  {
    shot: 'home',
    title: 'Make it yours',
    text: 'Show only what you use, and find this guide again any time.',
    marks: [
      ['customize', 'Customize', 'Switch off any page or panel you do not need. Switch it back on whenever you like.'],
      ['help', 'Help & tutorial', 'Opens this guide again, from the menu. On a phone it is under ⚙.'],
    ],
  },
];

const el = (id) => document.getElementById(id);
let index = 0;

/**
 * The red marks drawn over a picture, in its own pixels: a ring round each
 * button and an arrow to it from a numbered badge placed toward the middle of
 * the picture, where there is room. Exported for the tests.
 */
export function marksSvg(shotName, marks) {
  const shot = SHOTS[shotName];
  if (!shot) return '';
  const { w, h } = shot;
  const parts = [];
  const placed = [];
  const clampX = (v) => Math.min(w - 26, Math.max(26, v));
  const clampY = (v) => Math.min(h - 26, Math.max(26, v));
  marks.forEach(([key], i) => {
    const r = shot.rects[key];
    if (!r) return;
    // Tight round menu rows, so neighbouring rings do not cross.
    const pad = r[3] < 40 ? 3 : 7;
    const [x, y, bw, bh] = [r[0] - pad, r[1] - pad, r[2] + pad * 2, r[3] + pad * 2];
    const ring = `<rect class="tour-ring" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="${Math.min(14, bh / 2).toFixed(1)}"/>`;
    const badge = (bx, by) => `<circle class="tour-badge" cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="17"/>
      <text class="tour-num" x="${bx.toFixed(1)}" y="${(by + 6).toFixed(1)}">${i + 1}</text>`;
    // A big area needs no arrow: its number sits on its top-left corner.
    if (bw > w * 0.4 || bh > h * 0.3) {
      const bx = clampX(x);
      const by = clampY(y);
      placed.push([bx, by]);
      parts.push(ring + badge(bx, by));
      return;
    }
    const cx = x + bw / 2;
    const cy = y + bh / 2;
    // Toward the middle of the picture; straight down for something at the very top.
    let ux = w / 2 - cx;
    let uy = h * 0.55 - cy;
    const len = Math.hypot(ux, uy) || 1;
    ux /= len;
    uy /= len;
    // Where that line leaves the ring, then the badge a little further out.
    const t = Math.min(Math.abs(ux) > 1e-6 ? bw / 2 / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-6 ? bh / 2 / Math.abs(uy) : Infinity);
    const hx = cx + ux * (t + 6);
    const hy = cy + uy * (t + 6);
    const reach = Math.min(110, Math.max(70, len * 0.45));
    const bx = clampX(hx + ux * reach);
    let by = clampY(hy + uy * reach);
    // Buttons side by side would put their numbers on top of each other: step down.
    while (placed.some(([px, py]) => Math.hypot(px - bx, py - by) < 44) && by < h - 26) by = clampY(by + 46);
    placed.push([bx, by]);
    parts.push(`${ring}
      <line class="tour-arrow" x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}" marker-end="url(#tourHead)"/>
      ${badge(bx, by)}`);
  });
  return `<svg class="tour-marks" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <defs><marker id="tourHead" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#ff3b30"/></marker></defs>
    ${parts.join('')}
  </svg>`;
}

/** One slide, picture and words. Exported for the tests. */
export function slideHtml(i) {
  const s = SLIDES[i];
  const last = i === SLIDES.length - 1;
  return `<div class="tour-head">
      <span class="tour-step">${i + 1} of ${SLIDES.length}</span>
      <button class="tour-skip" data-tour-close>${last ? 'Close' : 'Skip tutorial'}</button>
    </div>
    <div class="tour-stage" data-tour-stage>
      <div class="tour-pic">
        <img src="assets/tour-${s.shot}.webp" alt="" width="1280" height="800" draggable="false">
        ${marksSvg(s.shot, s.marks)}
      </div>
    </div>
    <div class="tour-copy" aria-live="polite">
      <h3 class="tour-title">${escapeHtml(s.title)}</h3>
      <p class="tour-text">${escapeHtml(s.text)}</p>
      <ol class="tour-list">${s.marks.map(([, label, what]) => `<li><b>${escapeHtml(label)}</b> ${escapeHtml(what)}</li>`).join('')}</ol>
      ${s.note ? `<p class="tour-note">${escapeHtml(s.note)}</p>` : ''}
    </div>
    <div class="tour-foot">
      <button class="tour-nav" data-tour-prev${i === 0 ? ' disabled' : ''} aria-label="Previous">‹ Back</button>
      <div class="tour-dots">${SLIDES.map((_, d) => `<button class="tour-dot${d === i ? ' on' : ''}" data-tour-go="${d}" aria-label="Slide ${d + 1}"${d === i ? ' aria-current="step"' : ''}></button>`).join('')}</div>
      <button class="tour-nav tour-next" data-tour-next>${last ? 'Get started' : 'Next ›'}</button>
    </div>`;
}

function draw(direction = 0) {
  const box = el('tourCard');
  if (!box) return;
  box.innerHTML = slideHtml(index);
  if (direction) {
    const pic = box.querySelector('.tour-pic');
    pic?.classList.add(direction > 0 ? 'from-right' : 'from-left');
  }
  // The next picture is fetched ahead, so moving on never waits for it.
  const next = SLIDES[index + 1];
  if (next) new Image().src = `assets/tour-${next.shot}.webp`;
}

function go(to) {
  const target = Math.max(0, Math.min(SLIDES.length - 1, to));
  if (target === index) return;
  const direction = target > index ? 1 : -1;
  index = target;
  draw(direction);
}

export function openTour() {
  notePage('tutorial');
  const tour = el('tour');
  if (!tour) return;
  bind();
  index = 0;
  draw();
  tour.hidden = false;
  document.body.classList.add('tour-open');
  el('tourCard').querySelector('[data-tour-next]')?.focus();
}

export function closeTour() {
  const tour = el('tour');
  if (!tour || tour.hidden) return;
  tour.hidden = true;
  document.body.classList.remove('tour-open');
  // Seen: it will not open by itself again, on any device.
  setTourSeen();
}

function bind() {
  const tour = el('tour');
  if (tour.dataset.bound === '1') return;
  tour.dataset.bound = '1';
  tour.addEventListener('click', (e) => {
    const t = (sel) => e.target.closest(sel);
    if (e.target === tour || t('[data-tour-close]')) return closeTour();
    if (t('[data-tour-prev]')) return go(index - 1);
    if (t('[data-tour-next]')) return index === SLIDES.length - 1 ? closeTour() : go(index + 1);
    if (t('[data-tour-go]')) return go(Number(t('[data-tour-go]').dataset.tourGo));
    return undefined;
  });
  document.addEventListener('keydown', (e) => {
    if (tour.hidden) return;
    if (e.key === 'ArrowRight') go(index + 1);
    else if (e.key === 'ArrowLeft') go(index - 1);
    else if (e.key === 'Escape') closeTour();
  });
  // Swiped, on a phone or with a mouse dragged across the picture.
  let startX = null;
  let startY = null;
  tour.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('[data-tour-stage]')) return;
    startX = e.clientX;
    startY = e.clientY;
  });
  tour.addEventListener('pointerup', (e) => {
    if (startX == null) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    startX = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) go(index + (dx < 0 ? 1 : -1));
  });
}

/**
 * The first time someone is signed in, the tutorial opens by itself — once:
 * closing it marks it seen with the sign-in.
 */
onJournalLoaded(() => {
  // "About you" comes first where it is asked; that window opens the tutorial when it closes.
  // A guest's tutorial follows the guest notice instead (ui/views/guest.js).
  if (state.tourSeen || !isUnlocked() || isGuest() || legalDue() || (aboutDue() && cloudEnabled())) return;
  setTimeout(() => {
    if (!state.tourSeen && isUnlocked() && el('tour')?.hidden) openTour();
  }, 900);
});
