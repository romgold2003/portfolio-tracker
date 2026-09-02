/**
 * Options exposure by strike, and daily ETF flows.
 *
 * Both are SVG drawn by hand. Each is one series against one axis with a zero
 * line through it, which is a path and a handful of ticks; a charting library
 * would bring a canvas, a resize observer and a theme hook to draw the same
 * thing, and this app already carries one it would rather not use twice.
 */
import { escapeHtml } from '../format.js';

const el = (id) => document.getElementById(id);

/** Which market the exposure panel is showing. Survives a re-render. */
let market = 'BTC';
export function currentMarket() { return market; }
export function setMarket(next) { market = String(next || 'BTC').toUpperCase(); }

/** Billions, millions, thousands — whichever keeps it to three or four glyphs. */
function short(n) {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${Math.round(abs)}`;
}

const strikeLabel = (v) => (v >= 10000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)));

/* ── the plot area, shared by both charts ──────────────────────────────── */

const W = 900;
const H = 190;
const PAD = { left: 60, right: 12, top: 14, bottom: 24 };
const PLOT = {
  x0: PAD.left,
  x1: W - PAD.right,
  y0: PAD.top,
  y1: H - PAD.bottom,
};

/**
 * A y scale that always contains zero.
 *
 * Both of these are signed quantities whose sign is the point, so an axis that
 * floated to fit the data and left zero off it would hide the one thing worth
 * seeing.
 */
function scaleFor(values) {
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  return {
    max,
    min,
    y: (v) => PLOT.y1 - ((v - min) / span) * (PLOT.y1 - PLOT.y0),
  };
}

const xAt = (i, n) => (n <= 1
  ? (PLOT.x0 + PLOT.x1) / 2
  : PLOT.x0 + (i / (n - 1)) * (PLOT.x1 - PLOT.x0));

/**
 * One line chart with the area under it filled.
 *
 * Points are joined straight rather than smoothed: a spline through option
 * strikes invents gamma at prices where no contract trades, and the kinks are
 * real — they are where the open interest sits.
 */
function lineChart({ points, colour, markIndex, markLabel, title }) {
  if (!points.length) return '';
  const values = points.map((p) => p.value);
  const s = scaleFor(values);
  const n = points.length;

  const coords = points.map((p, i) => ({ x: xAt(i, n), y: s.y(p.value) }));
  const line = coords.map((c, i) => `${i ? 'L' : 'M'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  const zeroY = s.y(0);
  const area = `${line} L ${coords[n - 1].x.toFixed(1)} ${zeroY.toFixed(1)}`
    + ` L ${coords[0].x.toFixed(1)} ${zeroY.toFixed(1)} Z`;

  // Three labels is enough to read the scale and leaves the plot uncluttered.
  const ticks = [s.max, 0, s.min].filter((v, i, a) => a.indexOf(v) === i);
  const gridlines = ticks.map((v) => {
    const y = s.y(v).toFixed(1);
    return `<line x1="${PLOT.x0}" y1="${y}" x2="${PLOT.x1}" y2="${y}"
        class="cv-grid${v === 0 ? ' is-zero' : ''}" />
      <text x="${PLOT.x0 - 8}" y="${y}" class="cv-ytick" text-anchor="end"
        dominant-baseline="middle">${short(v)}</text>`;
  }).join('');

  // Every few points, so the axis is readable at any number of strikes.
  const step = Math.max(1, Math.ceil(n / 8));
  const xLabels = points.map((p, i) =>
    (i % step === 0 || i === n - 1
      ? `<text x="${xAt(i, n).toFixed(1)}" y="${H - 6}" class="cv-xtick"
          text-anchor="middle">${escapeHtml(p.label)}</text>`
      : '')).join('');

  const mark = markIndex >= 0 ? `
    <line x1="${xAt(markIndex, n).toFixed(1)}" y1="${PLOT.y0}"
          x2="${xAt(markIndex, n).toFixed(1)}" y2="${PLOT.y1}" class="cv-mark" />
    <text x="${xAt(markIndex, n).toFixed(1)}" y="${PLOT.y0 - 3}" class="cv-marklbl"
          text-anchor="middle">${escapeHtml(markLabel ?? '')}</text>` : '';

  const dots = coords.map((c) =>
    `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="2.4" fill="${colour}" />`).join('');

  return `<div class="cv-title">${escapeHtml(title)}</div>
    <svg class="cv" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
         aria-label="${escapeHtml(title)}">
      ${gridlines}${mark}
      <path d="${area}" fill="${colour}" opacity="0.14" />
      <path d="${line}" fill="none" stroke="${colour}" stroke-width="2"
            stroke-linejoin="round" vector-effect="non-scaling-stroke" />
      ${dots}${xLabels}
    </svg>`;
}

/**
 * One column chart: time along the bottom, value up or down from zero.
 *
 * Money in is green above the line and money out red below it, which is the
 * shape everyone draws these in and the reason it reads without a legend.
 */
function columnChart({ points, title, note }) {
  if (!points.length) return '';
  const values = points.map((p) => p.value);
  const s = scaleFor(values);
  const n = points.length;
  const slot = (PLOT.x1 - PLOT.x0) / n;
  const width = Math.max(2, slot * 0.62);
  const zeroY = s.y(0);

  const ticks = [s.max, 0, s.min].filter((v, i, a) => a.indexOf(v) === i);
  const gridlines = ticks.map((v) => {
    const y = s.y(v).toFixed(1);
    return `<line x1="${PLOT.x0}" y1="${y}" x2="${PLOT.x1}" y2="${y}"
        class="cv-grid${v === 0 ? ' is-zero' : ''}" />
      <text x="${PLOT.x0 - 8}" y="${y}" class="cv-ytick" text-anchor="end"
        dominant-baseline="middle">${v.toFixed(0)}M</text>`;
  }).join('');

  const bars = points.map((p, i) => {
    const x = PLOT.x0 + slot * i + (slot - width) / 2;
    const y = s.y(p.value);
    const top = Math.min(y, zeroY);
    const height = Math.max(1, Math.abs(y - zeroY));
    return `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${width.toFixed(1)}"
      height="${height.toFixed(1)}" rx="1"
      class="${p.value >= 0 ? 'cv-bar-up' : 'cv-bar-down'}"><title>${
  escapeHtml(p.label)}: ${p.value >= 0 ? '+' : ''}${p.value.toFixed(1)}M</title></rect>`;
  }).join('');

  const step = Math.max(1, Math.ceil(n / 8));
  const xLabels = points.map((p, i) =>
    (i % step === 0 || i === n - 1
      ? `<text x="${(PLOT.x0 + slot * i + slot / 2).toFixed(1)}" y="${H - 6}"
          class="cv-xtick" text-anchor="middle">${escapeHtml(p.label)}</text>`
      : '')).join('');

  return `<div class="cv-title">${escapeHtml(title)}${
  note ? `<span class="cv-note">${escapeHtml(note)}</span>` : ''}</div>
    <svg class="cv" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
         aria-label="${escapeHtml(title)}">
      ${gridlines}${bars}${xLabels}
    </svg>`;
}

/* ── the two panels ────────────────────────────────────────────────────── */

/** The index of the strike nearest spot, so the curve can be marked at price. */
function spotIndex(strikes, spot) {
  let best = -1;
  let gap = Infinity;
  strikes.forEach((r, i) => {
    const d = Math.abs(r.strike - spot);
    if (d < gap) { gap = d; best = i; }
  });
  return best;
}

export function renderExposure(profile, onPick) {
  const card = el('optionsCard');
  if (!card) return;
  card.style.display = profile ? '' : 'none';
  if (!profile) return;

  const name = el('optMarketName');
  if (name) name.textContent = profile.label ?? profile.market;

  const picker = el('optPicker');
  if (picker) {
    picker.innerHTML = (profile.markets ?? []).map((m) =>
      `<button class="opt-tab${m.id === profile.market ? ' active' : ''}"
        data-market="${escapeHtml(m.id)}">${escapeHtml(m.label)}</button>`).join('');
    picker.onclick = (e) => {
      const id = e.target?.dataset?.market;
      if (id) onPick(id);
    };
  }

  const stats = el('optStats');
  if (stats) {
    // The flip is absent when cumulative gamma never crosses zero inside the
    // strikes drawn, and saying so beats printing a strike that crossed nothing.
    stats.innerHTML = `
      <div class="opt-stat"><span>Spot</span><strong>${strikeLabel(profile.spot)}</strong></div>
      <div class="opt-stat"><span>Net GEX</span><strong class="${profile.netGex >= 0 ? 'is-up' : 'is-down'}">${short(profile.netGex)}</strong></div>
      <div class="opt-stat"><span>Net DEX</span><strong class="${profile.netDex >= 0 ? 'is-up' : 'is-down'}">${short(profile.netDex)}</strong></div>
      <div class="opt-stat"><span>Gamma flip</span><strong>${
  profile.gammaFlip ? strikeLabel(profile.gammaFlip) : '—'}</strong></div>`;
  }

  const at = spotIndex(profile.strikes, profile.spot);
  const points = (key) => profile.strikes.map((r) => ({
    label: strikeLabel(r.strike), value: r[key],
  }));

  const gex = el('optGex');
  const dex = el('optDex');
  if (gex) {
    gex.innerHTML = lineChart({
      points: points('gex'),
      colour: '#e0a13c',
      markIndex: at,
      markLabel: 'spot',
      title: 'GEX · Gamma exposure ($)',
    });
  }
  if (dex) {
    dex.innerHTML = lineChart({
      points: points('dex'),
      colour: '#4a9ae8',
      markIndex: at,
      markLabel: 'spot',
      title: 'DEX · Delta exposure ($)',
    });
  }
}

/** "2 Sep" under a bar. */
function dayLabel(iso) {
  const [, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]}`;
}

export function renderEtfFlows(data) {
  const card = el('etfCard');
  const body = el('etfBody');
  if (!card || !body) return;
  card.style.display = data ? '' : 'none';
  if (!data) return;

  body.innerHTML = ['BTC', 'ETH'].map((id) => {
    const set = data[id];
    if (!set?.flows?.length) return '';
    // Six weeks. Enough to see a run of inflows turn into a run of outflows,
    // narrow enough that a day is still a distinguishable bar.
    const recent = set.flows.slice(-30);
    const s = set.summary;
    return `<div class="etf-block">
      <div class="etf-head">
        <span class="etf-name">${escapeHtml(set.label)}</span>
        <span class="etf-sum">
          <span class="${s.latest >= 0 ? 'is-up' : 'is-down'}">${s.latest >= 0 ? '+' : ''}${s.latest.toFixed(1)}M</span>
          <span class="etf-sub">latest · week ${s.week >= 0 ? '+' : ''}${s.week.toFixed(0)}M
            · month ${s.month >= 0 ? '+' : ''}${s.month.toFixed(0)}M</span>
        </span>
      </div>
      ${columnChart({
    points: recent.map((r) => ({ label: dayLabel(r.date), value: r.flow })),
    title: 'Net flow',
    note: '$ millions',
  })}
    </div>`;
  }).join('');
}
