/**
 * GEX and DEX as they stand now, in the same format as the history below them.
 *
 * Until October 2026 the panel drew these as two line charts across strikes,
 * in a different style from the history block, and Romy asked for one format.
 * Both read the same numbers — checked against Deribit's own published greeks
 * on all 817 BTC contracts with open interest, net GEX agreed to 0.01% and net
 * DEX to 1.6% — so the choice was only the look, and the look is the reference
 * the history was built from:
 *
 *   GEX  the total, how unusual it is against the last 90 days, whether
 *        hedging dampens or amplifies moves, max pain, and bars by strike —
 *        blue where gamma is positive, red where it is negative.
 *   DEX  the total, its 90-day percentile, and which way it pushes dealers to
 *        trade the coin to stay hedged.
 *
 * Pure builders exported for the tests; renderExposureNow only fills the page.
 */
import { escapeHtml } from '../format.js';
import { DEX_COLOUR, dailyPoints, axisMoney, tipMoney, yRange } from './exposureHistory.js';

const RED = '#e05561';

/* ── the numbers ─────────────────────────────────────────────────────── */

/** "+$271.0M", "−$9.5M" — the headline figure. */
export const headlineMoney = (v) => (v < 0 ? axisMoney(v) : `+${axisMoney(v)}`);

/** Strikes as the axis writes them: "82.5k" for a coin, "7,600" for an index. */
export function strikeText(v) {
  if (v >= 10_000) return `${+(v / 1000).toFixed(1)}k`;
  return Math.round(v).toLocaleString('en-US');
}

/**
 * Where today's figure sits among the last 90 days' daily averages: the share
 * of those days at or below it, 0–100. Null with fewer than ten days recorded,
 * because a percentile of a handful of days is a guess wearing a number.
 */
export function percentileOf(value, history, key, now = Date.now()) {
  const days = dailyPoints(history, 90, now).map((d) => d[key]);
  if (days.length < 10 || !Number.isFinite(value)) return null;
  return Math.round((days.filter((v) => v <= value).length / days.length) * 100);
}

/* ── GEX by strike ───────────────────────────────────────────────────── */

const W = 900;
const H = 260;
const PLOT = { x0: 84, x1: W - 18, y0: 14, y1: H - 34 };

function barGeometry(strikes) {
  const values = strikes.map((r) => r.gex);
  // Bars stand on zero, so zero has to be inside the range.
  const range = yRange([...values, 0]);
  const y = (v) => PLOT.y1 - ((v - range.lo) / (range.hi - range.lo)) * (PLOT.y1 - PLOT.y0);
  const slot = (PLOT.x1 - PLOT.x0) / strikes.length;
  return { range, y, slot, x: (i) => PLOT.x0 + slot * (i + 0.5) };
}

/** Every k-th strike gets a label, about ten across the axis. */
export function labelStride(n, want = 10) {
  return Math.max(1, Math.ceil(n / want));
}

/** The GEX bars: one per strike bucket, rising or falling from zero. */
export function gexBars(strikes) {
  if (!strikes?.length) return '';
  const g = barGeometry(strikes);
  const zero = g.y(0);
  const width = Math.max(2, g.slot * 0.62);

  const grid = g.range.ticks.map((v) => {
    const y = g.y(v).toFixed(1);
    return `<line class="xh-grid" x1="${PLOT.x0}" x2="${PLOT.x1}" y1="${y}" y2="${y}" />
      <text class="xh-ytick" x="${PLOT.x0 - 12}" y="${y}" text-anchor="end" dominant-baseline="middle">${escapeHtml(axisMoney(v))}</text>`;
  }).join('');

  const bars = strikes.map((r, i) => {
    const top = Math.min(g.y(r.gex), zero);
    const height = Math.max(1, Math.abs(g.y(r.gex) - zero));
    return `<rect class="xn-bar" data-i="${i}" x="${(g.x(i) - width / 2).toFixed(1)}" y="${top.toFixed(1)}"
      width="${width.toFixed(1)}" height="${height.toFixed(1)}" rx="2" fill="${r.gex >= 0 ? DEX_COLOUR : RED}" />`;
  }).join('');

  const stride = labelStride(strikes.length);
  const labels = strikes.map((r, i) => (i % stride === 0
    ? `<text class="xh-xtick" x="${g.x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${escapeHtml(strikeText(r.strike))}</text>`
    : '')).join('');

  return `<div class="xh-plot">
      <svg class="xh-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="GEX by strike">
        ${grid}${bars}${labels}
      </svg>
      <div class="xh-tip" hidden></div>
    </div>`;
}

function bindBarHover(host, strikes) {
  const plot = host?.querySelector('.xh-plot');
  const svg = plot?.querySelector('svg');
  if (!svg) return;
  const g = barGeometry(strikes);
  const tip = plot.querySelector('.xh-tip');
  const bars = [...svg.querySelectorAll('.xn-bar')];

  const hide = () => {
    tip.hidden = true;
    for (const b of bars) b.classList.remove('is-dim');
  };
  plot.onpointerleave = hide;
  plot.onpointermove = (e) => {
    const box = svg.getBoundingClientRect();
    if (!box.width) return;
    const scale = box.width / W;
    const x = (e.clientX - box.left) / scale;
    if (x < PLOT.x0 || x > PLOT.x1) { hide(); return; }
    const i = Math.max(0, Math.min(strikes.length - 1, Math.floor((x - PLOT.x0) / g.slot)));
    for (const b of bars) b.classList.toggle('is-dim', Number(b.dataset.i) !== i);

    const r = strikes[i];
    tip.innerHTML = `<div class="xh-tip-title">GEX · Gamma exposure ($)</div>
      <div class="xh-tip-row"><span>Strike</span><strong>${escapeHtml(strikeText(r.strike))}</strong></div>
      <div class="xh-tip-row"><span>Value</span><strong>${escapeHtml(tipMoney(r.gex))}</strong></div>`;
    tip.hidden = false;
    const px = g.x(i) * scale;
    let left = px + 14;
    if (left + tip.offsetWidth > plot.clientWidth - 4) left = px - tip.offsetWidth - 14;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${Math.max(0, Math.min(g.y(r.gex), g.y(0)) * scale - tip.offsetHeight - 10)}px`;
  };
}

/* ── the sections ────────────────────────────────────────────────────── */

const badge = (text, tone = 'gold') => `<span class="xn-badge is-${tone}">${escapeHtml(text)}</span>`;

/** The GEX section: headline, what it means, max pain, bars. */
export function gexSection(profile, pct) {
  const positive = profile.netGex >= 0;
  const pain = profile.maxPain;
  const painGap = pain && profile.spot ? ` (${((pain / profile.spot - 1) * 100).toFixed(1)}% from price)` : '';
  const band = profile.band?.pct ?? 20;
  return `<div class="xn-head">
      <span class="xn-title">GEX · Gamma exposure</span>
      <strong class="xn-val">${escapeHtml(headlineMoney(profile.netGex))}</strong>
      ${pct == null ? '' : badge(`P${pct} · 90D`)}
      ${positive ? badge('Anchoring') : badge('Accelerating', 'red')}
    </div>
    <p class="xn-say">${positive
    ? 'Positive gamma: dealer hedging can dampen price moves.'
    : 'Negative gamma: dealer hedging can amplify price moves.'}${
  pain ? ` Max pain: <strong>${escapeHtml(strikeText(pain))}</strong>${escapeHtml(painGap)}.` : ''}</p>
    <p class="xn-say">Max pain is the strike where the options outstanding are worth least at expiry; it is not a guaranteed target.</p>
    <p class="xn-fine">Strikes within ±${escapeHtml(String(band))}% of price · the total covers the whole chain</p>
    ${gexBars(profile.strikes)}
    <p class="xn-fine">Strikes and values · USD</p>`;
}

/**
 * The DEX section: headline, and the hedging flow it implies.
 *
 * The open interest's net delta is the market's; dealers on the other side
 * hold the opposite and trade the coin to cancel it. Positive DEX leaves them
 * short, so they buy; negative leaves them long, so they sell. The bar says
 * which side of the centre that pushes, as the reference does — direction,
 * not size.
 */
export function dexSection(profile, pct) {
  const buying = profile.netDex >= 0;
  return `<div class="xn-head">
      <span class="xn-title">DEX · Delta exposure</span>
      <strong class="xn-val">${escapeHtml(headlineMoney(profile.netDex))}</strong>
      ${pct == null ? '' : badge(`P${pct} · 90D`)}
    </div>
    <p class="xn-say">Aggregate delta of the options book. A structural exposure, not a price signal.</p>
    <div class="xn-flow-lbl">${buying ? 'Mechanical buying' : 'Mechanical selling'} — spot hedging</div>
    <div class="xn-flow" role="img" aria-label="${buying ? 'buying' : 'selling'} pressure from hedging">
      <div class="xn-flow-fill ${buying ? 'is-buy' : 'is-sell'}"></div>
    </div>`;
}

/** Fill the price line and both sections. */
export function renderExposureNow(profile) {
  const spot = document.getElementById('optSpot');
  if (spot) {
    spot.innerHTML = `<span class="xn-sym">${escapeHtml(profile.market ?? '')}</span>
      <strong class="xn-price">$${escapeHtml(Math.round(profile.spot).toLocaleString('en-US'))}</strong>
      <span class="xn-fine">spot</span>`;
  }
  const gex = document.getElementById('optGexNow');
  const dex = document.getElementById('optDexNow');
  if (gex) {
    gex.innerHTML = gexSection(profile, percentileOf(profile.netGex, profile.history, 'gex'));
    bindBarHover(gex, profile.strikes);
  }
  if (dex) dex.innerHTML = dexSection(profile, percentileOf(profile.netDex, profile.history, 'dex'));
}
