/**
 * Net DEX and GEX through time — one point a day, two charts, one above the
 * other.
 *
 * Laid out after the history panel Romy picked as the model (October 2026):
 * its own block under the strike profile, rather than a view that replaces it,
 * with its own 7D / 30D / 90D switch; delta first in blue, gamma below it in
 * orange; a dot on every day; four dashed levels from the lowest reading to
 * the highest; dates along the bottom; and a readout on hover giving the date
 * and the value to the hundredth of a million, with a dashed line down to the
 * point being read.
 *
 * Each point is the day's average. Exposure is a standing position, not money
 * that moved, so a day of readings is summarised by the level that stood over
 * it — the same rule the panel has always used (see rollUpExposure).
 *
 * Days are placed by date rather than side by side. The record is only kept
 * from when exposure is read, so a day can be missing, and spacing points
 * evenly would quietly close the gap and draw a slope across a day nobody saw.
 *
 * The arithmetic is exported and tested without a browser; the view only draws.
 */
import { escapeHtml } from '../format.js';

export const DEX_COLOUR = '#5b84e8';
export const GEX_COLOUR = '#e6a33e';

export const FRAMES = [
  { id: '7d', label: '7D', days: 7 },
  { id: '30d', label: '30D', days: 30 },
  { id: '90d', label: '90D', days: 90 },
];

const DAY = 86_400_000;

/* ── the numbers ─────────────────────────────────────────────────────── */

/**
 * One point per UTC day, averaged, for the last `days` days including today.
 *
 * @param {{at: string, netGex: number, netDex: number}[]} history
 * @returns {{day: string, t: number, gex: number, dex: number, reads: number}[]}
 *   oldest first; days with no reading are absent, not zero
 */
export function dailyPoints(history, days, now = Date.now()) {
  const today = Math.floor(now / DAY) * DAY;
  const from = today - (days - 1) * DAY;
  const byDay = new Map();
  for (const r of history ?? []) {
    const at = Date.parse(r?.at);
    const gex = Number(r?.netGex);
    const dex = Number(r?.netDex);
    if (!Number.isFinite(at) || !Number.isFinite(gex) || !Number.isFinite(dex)) continue;
    const t = Math.floor(at / DAY) * DAY;
    if (t < from || t > today) continue;
    const d = byDay.get(t) ?? { gex: 0, dex: 0, reads: 0 };
    d.gex += gex;
    d.dex += dex;
    d.reads += 1;
    byDay.set(t, d);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, d]) => ({
      day: new Date(t).toISOString().slice(0, 10),
      t,
      gex: d.gex / d.reads,
      dex: d.dex / d.reads,
      reads: d.reads,
    }));
}

/** Billions, millions, thousands, to one decimal: the axis labels. */
export function axisMoney(v) {
  const abs = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

/** Signed, to the hundredth: the hover readout ("+$326.07M"). */
export function tipMoney(v) {
  const abs = Math.abs(v);
  const sign = v < 0 ? '−' : '+';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

/**
 * Four levels, evenly spaced from the lowest reading to the highest.
 *
 * Not anchored at zero. Net delta on a large book can sit in the billions and
 * move by a fraction of that, and an axis stretched down to zero flattens the
 * movement into a line along the top. The model draws its levels from the
 * lowest point to the highest, and the lowest and highest dots sit on them.
 */
export function yRange(values) {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) {
    const pad = Math.abs(lo) * 0.1 || 1;
    lo -= pad;
    hi += pad;
  }
  return { lo, hi, ticks: [0, 1, 2, 3].map((i) => lo + ((hi - lo) * i) / 3) };
}

/** "27/09" — day and month, as the model writes its dates. */
export const dayMonth = (day) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/**
 * Which points get a date under them: about eight, always the last, and never
 * two close enough to collide.
 */
export function xTickIndices(xs, { want = 8, minGap = 70 } = {}) {
  const n = xs.length;
  if (!n) return [];
  const stride = Math.max(1, Math.ceil(n / want));
  const picked = [];
  for (let i = 0; i < n; i += stride) picked.push(i);
  if (picked[picked.length - 1] !== n - 1) {
    // The last date always shows; the one before it gives way if they crowd.
    if (xs[n - 1] - xs[picked[picked.length - 1]] < minGap) picked.pop();
    picked.push(n - 1);
  }
  return picked;
}

/* ── one chart ───────────────────────────────────────────────────────── */

/**
 * A chart's drawing box, in units equal to the pixels it will occupy.
 *
 * Charts were drawn 900 units wide and scaled to fit, which is fine on a
 * desktop and ruinous on a phone: the drawing shrinks to a third, and so does
 * every label in it — thirteen-unit axis text came out at under eight pixels on
 * an iPhone. Drawn at the width it is shown at, a label is the size the
 * stylesheet says it is on every screen, and a narrow screen gets a shorter
 * plot, a narrower gutter and fewer dates.
 */
export function chartBox(width = 900) {
  const W = Math.max(280, Math.round(width));
  const narrow = W < 600;
  const H = narrow ? 220 : 260;
  return {
    W, H, narrow,
    PLOT: { x0: narrow ? 58 : 84, x1: W - (narrow ? 10 : 18), y0: 14, y1: H - 30 },
  };
}

/** The width a chart's host is drawn at; 900 where there is no layout (tests). */
export const widthOf = (host) => host?.clientWidth || 900;

function geometry(points, key, { PLOT } = chartBox()) {
  const values = points.map((p) => p[key]);
  const range = yRange(values);
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const x = (t) => (t1 === t0
    ? (PLOT.x0 + PLOT.x1) / 2
    : PLOT.x0 + ((t - t0) / (t1 - t0)) * (PLOT.x1 - PLOT.x0));
  const y = (v) => PLOT.y1 - ((v - range.lo) / (range.hi - range.lo)) * (PLOT.y1 - PLOT.y0);
  return { range, xs: points.map((p) => x(p.t)), ys: values.map(y), y };
}

/**
 * The markup for one chart: its title, the plot, and the values behind it.
 * `key` is 'dex' or 'gex'.
 */
export function historyChart(points, { key, title, colour, width = 900 }) {
  const b = chartBox(width);
  const { W, H, PLOT } = b;
  const g = geometry(points, key, b);
  const grid = g.range.ticks.map((v) => {
    const y = g.y(v).toFixed(1);
    return `<line class="xh-grid" x1="${PLOT.x0}" x2="${PLOT.x1}" y1="${y}" y2="${y}" />
      <text class="xh-ytick" x="${PLOT.x0 - (b.narrow ? 6 : 12)}" y="${y}" text-anchor="end" dominant-baseline="middle">${escapeHtml(axisMoney(v))}</text>`;
  }).join('');
  const path = g.xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${g.ys[i].toFixed(1)}`).join(' ');
  const dots = g.xs.map((x, i) =>
    `<circle cx="${x.toFixed(1)}" cy="${g.ys[i].toFixed(1)}" r="3.6" fill="${colour}" />`).join('');
  const dates = xTickIndices(g.xs, { want: b.narrow ? 5 : 8, minGap: b.narrow ? 52 : 70 }).map((i) =>
    `<text class="xh-xtick" x="${g.xs[i].toFixed(1)}" y="${H - 8}" text-anchor="middle">${escapeHtml(dayMonth(points[i].day))}</text>`).join('');
  const rows = [...points].reverse().map((p) =>
    `<tr><td>${escapeHtml(p.day)}</td><td>${escapeHtml(tipMoney(p[key]))}</td></tr>`).join('');

  return `<div class="xh-chart-title">${escapeHtml(title)}</div>
    <div class="xh-plot" data-key="${key}">
      <svg class="xh-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(title)}">
        ${grid}
        <path d="${path}" fill="none" stroke="${colour}" stroke-width="2.4"
              stroke-linejoin="round" stroke-linecap="round" />
        ${dots}
        ${dates}
        <line class="xh-hair" x1="0" x2="0" y1="${PLOT.y0}" y2="${PLOT.y1}" hidden />
        <circle class="xh-hot" r="6.5" fill="#fff" stroke="${colour}" stroke-width="3" hidden />
      </svg>
      <div class="xh-tip" hidden></div>
    </div>
    <details class="xh-values">
      <summary>Chart values</summary>
      <table><thead><tr><th>Date</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>
    </details>`;
}

/* ── hovering ────────────────────────────────────────────────────────── */

/**
 * Each chart reads on its own, as in the model: the line drops from the top of
 * the plot to the point, the point is ringed, and the readout sits beside it.
 */
function bindHover(host, points, key, title, b = chartBox()) {
  const { W, PLOT } = b;
  const plot = host?.querySelector('.xh-plot');
  const svg = plot?.querySelector('svg');
  if (!svg) return;
  const g = geometry(points, key, b);
  const hair = svg.querySelector('.xh-hair');
  const hot = svg.querySelector('.xh-hot');
  const tip = plot.querySelector('.xh-tip');

  const hide = () => {
    hair.setAttribute('hidden', '');
    hot.setAttribute('hidden', '');
    tip.hidden = true;
  };

  plot.onpointerleave = hide;
  plot.onpointermove = (e) => {
    const box = svg.getBoundingClientRect();
    if (!box.width) return;
    const scale = box.width / W;
    const x = (e.clientX - box.left) / scale;
    if (x < PLOT.x0 - 20 || x > PLOT.x1 + 20) { hide(); return; }

    let i = 0;
    for (let j = 1; j < g.xs.length; j += 1) {
      if (Math.abs(g.xs[j] - x) < Math.abs(g.xs[i] - x)) i = j;
    }
    const px = g.xs[i];
    const py = g.ys[i];
    hair.setAttribute('x1', px.toFixed(1));
    hair.setAttribute('x2', px.toFixed(1));
    hair.setAttribute('y2', py.toFixed(1));
    hair.removeAttribute('hidden');
    hot.setAttribute('cx', px.toFixed(1));
    hot.setAttribute('cy', py.toFixed(1));
    hot.removeAttribute('hidden');

    tip.innerHTML = `<div class="xh-tip-title">${escapeHtml(title)}</div>
      <div class="xh-tip-row"><span>Date</span><strong>${escapeHtml(points[i].day)}</strong></div>
      <div class="xh-tip-row"><span>Value</span><strong>${escapeHtml(tipMoney(points[i][key]))}</strong></div>`;
    tip.hidden = false;

    // Up and to the right of the point, and kept inside the chart.
    const room = plot.clientWidth;
    let left = px * scale + 16;
    if (left + tip.offsetWidth > room - 4) left = px * scale - tip.offsetWidth - 16;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${Math.max(0, py * scale - tip.offsetHeight - 14)}px`;
  };
}

/* ── the block ───────────────────────────────────────────────────────── */

let frame = '90d';

/** Fill the history block for the market the panel is showing. */
export function renderExposureHistory(profile) {
  const block = document.getElementById('optHistory');
  if (!block) return;

  // No database, no record: the block has nothing it could ever show.
  if (!profile || !Array.isArray(profile.history)) {
    block.hidden = true;
    return;
  }
  block.hidden = false;

  const name = document.getElementById('xhMarket');
  if (name) name.textContent = profile.market ?? '';

  const frames = document.getElementById('xhFrames');
  if (frames) {
    frames.innerHTML = FRAMES.map((f) =>
      `<button class="xh-frame${f.id === frame ? ' active' : ''}" data-frame="${f.id}">${f.label}</button>`).join('');
    frames.onclick = (e) => {
      const id = e.target?.dataset?.frame;
      if (!id || id === frame) return;
      frame = id;
      renderExposureHistory(profile);
    };
  }

  const { days } = FRAMES.find((f) => f.id === frame) ?? FRAMES[2];
  const points = dailyPoints(profile.history, days);
  const dexHost = document.getElementById('xhDex');
  const gexHost = document.getElementById('xhGex');
  if (!dexHost || !gexHost) return;

  if (points.length < 2) {
    dexHost.innerHTML = `<div class="cv-empty">${points.length
      ? 'One day recorded in this window so far. A line needs two — a point is added for each day the exposure is read.'
      : 'Nothing recorded in this window yet. A point is added for each day the exposure is read.'}</div>`;
    gexHost.innerHTML = '';
    return;
  }

  const dexTitle = 'DEX · Delta exposure ($)';
  const gexTitle = 'GEX · Gamma exposure ($)';
  const width = widthOf(dexHost);
  dexHost.innerHTML = historyChart(points, { key: 'dex', title: dexTitle, colour: DEX_COLOUR, width });
  gexHost.innerHTML = historyChart(points, { key: 'gex', title: gexTitle, colour: GEX_COLOUR, width });
  bindHover(dexHost, points, 'dex', dexTitle, chartBox(width));
  bindHover(gexHost, points, 'gex', gexTitle, chartBox(width));
}
