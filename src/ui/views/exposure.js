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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (iso) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
};

/* ── the plot area, shared by both charts ──────────────────────────────── */

const W = 900;
const H = 190;
const PAD = { left: 60, right: 12, top: 14, bottom: 24 };
const PLOT = { x0: PAD.left, x1: W - PAD.right, y0: PAD.top, y1: H - PAD.bottom };

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
  return { max, min, y: (v) => PLOT.y1 - ((v - min) / span) * (PLOT.y1 - PLOT.y0) };
}

const xAt = (i, n) => (n <= 1
  ? (PLOT.x0 + PLOT.x1) / 2
  : PLOT.x0 + (i / (n - 1)) * (PLOT.x1 - PLOT.x0));

function axisLabels(points, xFor) {
  const n = points.length;
  const step = Math.max(1, Math.ceil(n / 8));
  return points.map((p, i) =>
    (i % step === 0 || i === n - 1
      ? `<text x="${xFor(i).toFixed(1)}" y="${H - 6}" class="cv-xtick"
          text-anchor="middle">${escapeHtml(p.label)}</text>`
      : '')).join('');
}

function gridFor(s, format) {
  return [s.max, 0, s.min].filter((v, i, a) => a.indexOf(v) === i).map((v) => {
    const y = s.y(v).toFixed(1);
    return `<line x1="${PLOT.x0}" y1="${y}" x2="${PLOT.x1}" y2="${y}"
        class="cv-grid${v === 0 ? ' is-zero' : ''}" />
      <text x="${PLOT.x0 - 8}" y="${y}" class="cv-ytick" text-anchor="end"
        dominant-baseline="middle">${format(v)}</text>`;
  }).join('');
}

/**
 * One line chart with the area under it filled.
 *
 * Points are joined straight rather than smoothed: a spline through option
 * strikes invents gamma at prices where no contract trades, and the kinks are
 * real — they are where the open interest sits.
 */
function lineChart({ points, colour, markIndex, title }) {
  if (!points.length) return '';
  const s = scaleFor(points.map((p) => p.value));
  const n = points.length;

  const coords = points.map((p, i) => ({ x: xAt(i, n), y: s.y(p.value) }));
  const line = coords.map((c, i) => `${i ? 'L' : 'M'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  const zeroY = s.y(0);
  const area = `${line} L ${coords[n - 1].x.toFixed(1)} ${zeroY.toFixed(1)}`
    + ` L ${coords[0].x.toFixed(1)} ${zeroY.toFixed(1)} Z`;

  const mark = markIndex >= 0 ? `
    <line x1="${xAt(markIndex, n).toFixed(1)}" y1="${PLOT.y0}"
          x2="${xAt(markIndex, n).toFixed(1)}" y2="${PLOT.y1}" class="cv-mark" />
    <text x="${xAt(markIndex, n).toFixed(1)}" y="${PLOT.y0 - 3}" class="cv-marklbl"
          text-anchor="middle">spot</text>` : '';

  const dots = coords.map((c) =>
    `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="2.4" fill="${colour}" />`).join('');

  return `<div class="cv-title">${escapeHtml(title)}</div>
    <svg class="cv" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
         aria-label="${escapeHtml(title)}">
      ${gridFor(s, short)}${mark}
      <path d="${area}" fill="${colour}" opacity="0.14" />
      <path d="${line}" fill="none" stroke="${colour}" stroke-width="2"
            stroke-linejoin="round" vector-effect="non-scaling-stroke" />
      ${dots}
      ${axisLabels(points, (i) => xAt(i, n))}
      <line class="cv-hair" y1="${PLOT.y0}" y2="${PLOT.y1}" x1="0" x2="0" hidden />
      <circle class="cv-hot" r="4.5" fill="${colour}" hidden />
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
  const s = scaleFor(points.map((p) => p.value));
  const n = points.length;
  const slot = (PLOT.x1 - PLOT.x0) / n;
  const width = Math.max(2, slot * 0.62);
  const zeroY = s.y(0);
  const centre = (i) => PLOT.x0 + slot * i + slot / 2;

  const bars = points.map((p, i) => {
    const y = s.y(p.value);
    return `<rect x="${(centre(i) - width / 2).toFixed(1)}" y="${Math.min(y, zeroY).toFixed(1)}"
      width="${width.toFixed(1)}" height="${Math.max(1, Math.abs(y - zeroY)).toFixed(1)}" rx="1"
      class="${p.value >= 0 ? 'cv-bar-up' : 'cv-bar-down'}" />`;
  }).join('');

  return `<div class="cv-title">${escapeHtml(title)}${
  note ? `<span class="cv-note">${escapeHtml(note)}</span>` : ''}</div>
    <svg class="cv" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
         aria-label="${escapeHtml(title)}">
      ${gridFor(s, (v) => `${v.toFixed(0)}M`)}${bars}
      ${axisLabels(points, centre)}
      <line class="cv-hair" y1="${PLOT.y0}" y2="${PLOT.y1}" x1="0" x2="0" hidden />
    </svg>`;
}

/* ── hovering ──────────────────────────────────────────────────────────── */

/**
 * Follow the cursor across a set of charts that share one x axis.
 *
 * The viewBox does not preserve its aspect ratio, so the plot stretches with
 * the card and a pixel maps to a viewBox unit by simple proportion — no
 * getScreenCTM needed, and no listener on resize.
 *
 * `charts` move together because they are the same axis read twice: the picture
 * this was modelled on shows one readout covering both, and separating them
 * would mean hovering twice to compare gamma with delta at a price.
 */
function attachHover({ host, charts, count, tip, describe }) {
  if (!host || !count) return;

  const svgs = charts.map((c) => c?.querySelector('svg')).filter(Boolean);
  if (!svgs.length) return;

  const indexFrom = (event, svg) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return -1;
    const x = ((event.clientX - rect.left) / rect.width) * W;
    if (x < PLOT.x0 - 12 || x > PLOT.x1 + 12) return -1;
    const span = PLOT.x1 - PLOT.x0;
    const at = count <= 1 ? 0 : Math.round(((x - PLOT.x0) / span) * (count - 1));
    return Math.max(0, Math.min(count - 1, at));
  };

  const clear = () => {
    for (const svg of svgs) {
      svg.querySelector('.cv-hair')?.setAttribute('hidden', '');
      svg.querySelector('.cv-hot')?.setAttribute('hidden', '');
    }
    if (tip) tip.hidden = true;
  };

  const move = (event) => {
    const source = event.currentTarget.querySelector('svg') ?? svgs[0];
    const i = indexFrom(event, source);
    if (i < 0) { clear(); return; }

    for (const svg of svgs) {
      const x = svg.dataset.slotted === '1'
        ? PLOT.x0 + ((PLOT.x1 - PLOT.x0) / count) * (i + 0.5)
        : xAt(i, count);
      const hair = svg.querySelector('.cv-hair');
      if (hair) {
        hair.setAttribute('x1', x.toFixed(1));
        hair.setAttribute('x2', x.toFixed(1));
        hair.removeAttribute('hidden');
      }
      const hot = svg.querySelector('.cv-hot');
      const y = svg.dataset.values ? JSON.parse(svg.dataset.values)[i] : null;
      if (hot && y != null) {
        hot.setAttribute('cx', x.toFixed(1));
        hot.setAttribute('cy', String(y));
        hot.removeAttribute('hidden');
      }
    }

    if (tip) {
      tip.innerHTML = describe(i);
      tip.hidden = false;
      // Kept inside the card, and away from the cursor so it never covers the
      // point being read.
      const box = host.getBoundingClientRect();
      const wanted = event.clientX - box.left + 16;
      const limit = box.width - tip.offsetWidth - 8;
      tip.style.left = `${Math.max(8, Math.min(wanted, limit))}px`;
      tip.style.top = `${Math.max(8, event.clientY - box.top - tip.offsetHeight - 14)}px`;
    }
  };

  for (const chart of charts) {
    if (!chart) continue;
    chart.addEventListener('pointermove', move);
    chart.addEventListener('pointerleave', clear);
  }
}

/** Remember each point's y so the hover dot can sit on the curve. */
function stampYs(container, points) {
  const svg = container?.querySelector('svg');
  if (!svg) return;
  const s = scaleFor(points.map((p) => p.value));
  svg.dataset.values = JSON.stringify(points.map((p) => +s.y(p.value).toFixed(1)));
}

/* ── the exposure panel ────────────────────────────────────────────────── */

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
  const gexPoints = points('gex');
  const dexPoints = points('dex');

  const gex = el('optGex');
  const dex = el('optDex');
  if (gex) gex.innerHTML = lineChart({ points: gexPoints, colour: '#e0a13c', markIndex: at, title: 'GEX · Gamma exposure ($)' });
  if (dex) dex.innerHTML = lineChart({ points: dexPoints, colour: '#4a9ae8', markIndex: at, title: 'DEX · Delta exposure ($)' });
  stampYs(gex, gexPoints);
  stampYs(dex, dexPoints);

  attachHover({
    host: el('optCharts'),
    charts: [gex, dex],
    count: profile.strikes.length,
    tip: el('optTip'),
    describe: (i) => {
      const row = profile.strikes[i];
      return `<div class="tip-head">Strike ${strikeLabel(row.strike)}</div>
        <div class="tip-row"><span>GEX</span><strong class="${row.gex >= 0 ? 'is-up' : 'is-down'}">${short(row.gex)}</strong></div>
        <div class="tip-row"><span>DEX</span><strong class="${row.dex >= 0 ? 'is-up' : 'is-down'}">${short(row.dex)}</strong></div>
        <div class="tip-row"><span>OI</span><strong>${row.oi.toLocaleString()}</strong></div>`;
    },
  });
}

/* ── the flows panel ───────────────────────────────────────────────────── */

/** Daily, weekly or monthly. Survives a re-render, like the market does. */
let grain = 'daily';
let lastFlows = null;

const GRAINS = [
  { id: 'daily', label: 'Daily', bars: 30 },
  { id: 'weekly', label: 'Weekly', bars: 26 },
  { id: 'monthly', label: 'Monthly', bars: 12 },
];

/** The Monday of a day's week, which is what a weekly bar is stacked on. */
function mondayOf(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Roll daily flows into weeks or months.
 *
 * Summed, not averaged: a week's flow is the money that moved that week, and
 * an average would answer a question nobody asked.
 */
function rollUp(flows, id) {
  if (id === 'daily') return flows.map((f) => ({ label: dayLabel(f.date), value: f.flow }));

  const buckets = new Map();
  for (const f of flows) {
    const key = id === 'weekly' ? mondayOf(f.date) : f.date.slice(0, 7);
    buckets.set(key, (buckets.get(key) ?? 0) + f.flow);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => ({
      label: id === 'weekly' ? dayLabel(key) : `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`,
      value: +value.toFixed(1),
    }));
}

function drawFlows() {
  const body = el('etfBody');
  if (!body || !lastFlows) return;
  const grainDef = GRAINS.find((g) => g.id === grain) ?? GRAINS[0];

  body.innerHTML = ['BTC', 'ETH'].map((id) => {
    const set = lastFlows[id];
    if (!set?.flows?.length) return '';
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
      <div class="cv-host" id="etfChart-${id}"><div class="cv-tip" id="etfTip-${id}" hidden></div></div>
    </div>`;
  }).join('');

  for (const id of ['BTC', 'ETH']) {
    const set = lastFlows[id];
    const host = el(`etfChart-${id}`);
    if (!set?.flows?.length || !host) continue;

    const rolled = rollUp(set.flows, grain).slice(-grainDef.bars);
    host.insertAdjacentHTML('afterbegin', columnChart({ points: rolled, title: 'Net flow', note: '$ millions' }));
    // Columns sit in the middle of a slot rather than on a shared edge, so the
    // crosshair has to be placed the same way.
    const svg = host.querySelector('svg');
    if (svg) svg.dataset.slotted = '1';

    attachHover({
      host,
      charts: [host],
      count: rolled.length,
      tip: el(`etfTip-${id}`) ?? el('etfTip'),
      describe: (i) => {
        const p = rolled[i];
        return `<div class="tip-head">${escapeHtml(p.label)}</div>
          <div class="tip-row"><span>Net flow</span><strong class="${p.value >= 0 ? 'is-up' : 'is-down'}">${
  p.value >= 0 ? '+' : ''}${p.value.toFixed(1)}M</strong></div>`;
      },
    });
  }
}

export function renderEtfFlows(data) {
  const card = el('etfCard');
  if (!card) return;
  card.style.display = data ? '' : 'none';
  if (!data) return;
  lastFlows = data;

  const picker = el('etfGrain');
  if (picker) {
    picker.innerHTML = GRAINS.map((g) =>
      `<button class="opt-tab${g.id === grain ? ' active' : ''}"
        data-grain="${g.id}">${g.label}</button>`).join('');
    picker.onclick = (e) => {
      const id = e.target?.dataset?.grain;
      if (!id || id === grain) return;
      grain = id;
      renderEtfFlows(lastFlows);
    };
  }

  drawFlows();
}
