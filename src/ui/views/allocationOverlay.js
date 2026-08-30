/**
 * The allocation, opened up.
 *
 * Hovering the small doughnut lifts it into the middle of the screen; hovering
 * a wedge there lists what is actually inside that sector. No clicking, which
 * is the whole appeal — and also the whole difficulty, because a thing that
 * opens on hover and then covers the screen has moved the cursor onto itself.
 *
 * So opening and closing are asked of different elements: the small card opens
 * it, the overlay closes it, and a short grace period covers the gap between
 * them while the panel is still fading in. Without that the overlay flickers
 * open and shut as the mouse crosses the seam.
 *
 * Built on the Chart.js already here rather than the React chart library the
 * design came from. This app has no build step and one runtime dependency; the
 * animation is CSS and the interaction is four listeners.
 */
import { state } from '../../core/store.js';
import { sectorBreakdown, unreal, costOf, posValue, pctD } from '../../core/portfolio.js';
import { sectorOf } from '../../config/sectors.js';
import { amountsHidden, MASK } from './home.js';
import {
  money as $u, signedMoney as $s, pctText as fp, pnlColor as clr, escapeHtml,
} from '../format.js';

/** Long enough to cross the gap between card and overlay, short enough not to stick. */
const GRACE_MS = 220;

const CAN_HOVER = typeof matchMedia === 'function'
  && matchMedia('(hover: hover) and (pointer: fine)').matches;

let chart = null;
let rows = [];
let closeTimer = null;
let openIndex = -1;

const el = (id) => document.getElementById(id);

/** Every open holding in one sector, biggest first. */
function holdingsIn(name) {
  return state.positions
    .filter((p) => p.status === 'Open' && sectorOf(p) === name)
    .map((p) => ({
      ticker: p.ticker,
      value: Math.abs(posValue(p)),
      pnl: unreal(p),
      pct: pctD(unreal(p), costOf(p)),
      dir: p.dir,
    }))
    .sort((a, b) => b.value - a.value);
}

/**
 * The panel beside the chart.
 *
 * With nothing hovered it shows the whole book, so the overlay says something
 * the moment it opens rather than waiting to be pointed at.
 */
function renderDetail(index) {
  const host = el('allocDetail');
  const centre = el('allocCentre');
  if (!host || !centre) return;

  const hidden = amountsHidden();
  const money = (n) => (hidden ? MASK : $u(n));
  const total = rows.reduce((sum, r) => sum + r.value, 0);

  if (index < 0 || !rows[index]) {
    centre.innerHTML = `<div class="alloc-centre-val">${money(total)}</div>
      <div class="alloc-centre-lbl">${rows.length} sector${rows.length === 1 ? '' : 's'}</div>`;
    host.innerHTML = `<div class="alloc-detail-head">
        <span class="alloc-detail-title">Allocation</span>
        <span class="alloc-detail-hint">Point at a sector</span>
      </div>
      ${rows.map((r, i) => `<div class="alloc-row-lg" data-index="${i}">
        <span class="alloc-dot" style="background:${r.colour}"></span>
        <span class="alloc-name">${escapeHtml(r.name)}</span>
        <span class="alloc-lg-val">${money(r.value)}</span>
        <span class="alloc-pct">${r.pct.toFixed(1)}%</span>
      </div>`).join('')}`;
    return;
  }

  const row = rows[index];
  const holdings = holdingsIn(row.name);
  const sectorPnl = holdings.reduce((sum, h) => sum + h.pnl, 0);

  centre.innerHTML = `<div class="alloc-centre-val" style="color:${row.colour}">${row.pct.toFixed(1)}%</div>
    <div class="alloc-centre-lbl">${escapeHtml(row.name)}</div>`;

  host.innerHTML = `<div class="alloc-detail-head">
      <span class="alloc-detail-title" style="color:${row.colour}">${escapeHtml(row.name)}</span>
      <span class="alloc-detail-hint">${money(row.value)} · ${row.pct.toFixed(1)}%</span>
    </div>
    ${holdings.length
    ? holdings.map((h, i) => `<div class="alloc-row-lg alloc-in" style="animation-delay:${i * 34}ms">
        <span class="alloc-tk">${escapeHtml(h.ticker)}</span>
        ${h.dir === 'Short' ? '<span class="mini-dir d-short">Short</span>' : ''}
        <span class="alloc-lg-val">${money(h.value)}</span>
        <span class="alloc-lg-pnl" style="color:${clr(h.pnl)}">${hidden ? MASK : $s(h.pnl)}</span>
        <span class="alloc-pct" style="color:${clr(h.pct)}">${fp(h.pct)}</span>
      </div>`).join('')
    // Cash is a real answer to "where is my money", and has no holdings.
    : `<div class="alloc-empty">Not invested — this is cash sitting in the account.</div>`}
    ${holdings.length ? `<div class="alloc-row-lg alloc-total">
      <span class="alloc-tk">Sector P&L</span>
      <span class="alloc-lg-pnl" style="color:${clr(sectorPnl)}">${hidden ? MASK : $s(sectorPnl)}</span>
    </div>` : ''}`;

  host.querySelectorAll('.alloc-row-lg').forEach((r) => r.classList.add('alloc-in'));
}

function highlight(index) {
  if (index === openIndex) return;
  openIndex = index;
  renderDetail(index);
  if (!chart) return;
  // Lift the hovered wedge out of the ring rather than recolouring it: the
  // colours already mean something, and moving is easier to follow than a tint.
  chart.data.datasets[0].offset = rows.map((_, i) => (i === index ? 18 : 0));
  chart.update('none');
}

function buildChart() {
  const canvas = el('allocBigChart');
  if (!canvas || typeof Chart === 'undefined') return;
  chart?.destroy();

  const panel = getComputedStyle(document.body).getPropertyValue('--panel').trim() || '#131313';
  chart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: rows.map((r) => r.name),
      datasets: [{
        data: rows.map((r) => r.value),
        backgroundColor: rows.map((r) => r.colour),
        borderColor: panel,
        borderWidth: 3,
        offset: rows.map(() => 0),
        hoverOffset: 18,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      layout: { padding: 24 },
      // The wedges sweep in rather than appearing, which is most of why the
      // overlay reads as opening rather than switching on.
      animation: { animateRotate: true, animateScale: true, duration: 620, easing: 'easeOutQuart' },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      onHover: (event, active) => {
        highlight(active.length ? active[0].index : -1);
      },
    },
  });
}

export function isAllocationOpen() {
  return el('allocOverlay')?.classList.contains('show') ?? false;
}

export function openAllocation() {
  clearTimeout(closeTimer);
  const overlay = el('allocOverlay');
  if (!overlay || isAllocationOpen()) return;

  rows = sectorBreakdown(state.positions, state.cash);
  if (!rows.length) return;

  openIndex = -1;
  overlay.classList.add('show');
  renderDetail(-1);
  buildChart();
}

export function closeAllocation() {
  clearTimeout(closeTimer);
  const overlay = el('allocOverlay');
  if (!overlay) return;
  overlay.classList.remove('show');
  openIndex = -1;
  // Destroyed rather than hidden: a chart kept alive behind an invisible
  // overlay still redraws on every resize.
  chart?.destroy();
  chart = null;
}

/** Leaving starts a countdown instead of closing, so crossing a seam is safe. */
function scheduleClose() {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(closeAllocation, GRACE_MS);
}

export function initAllocationOverlay() {
  const card = el('allocCard');
  const overlay = el('allocOverlay');
  if (!card || !overlay) return;

  if (CAN_HOVER) {
    card.addEventListener('mouseenter', openAllocation);
    card.addEventListener('mouseleave', scheduleClose);
    overlay.addEventListener('mouseenter', () => clearTimeout(closeTimer));
    overlay.addEventListener('mouseleave', closeAllocation);
  } else {
    // No hover to speak of, so a tap opens it and a tap outside closes it.
    card.addEventListener('click', () => (isAllocationOpen() ? closeAllocation() : openAllocation()));
  }

  // A pointer is not the only way to reach this.
  card.addEventListener('focus', openAllocation);
  card.addEventListener('blur', scheduleClose);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAllocation(); }
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeAllocation(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllocation(); });
}
