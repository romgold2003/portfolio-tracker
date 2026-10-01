/**
 * Options exposure by strike, and daily ETF flows.
 *
 * Both are SVG drawn by hand. Each is one series against one axis with a zero
 * line through it, which is a path and a handful of ticks; a charting library
 * would bring a canvas, a resize observer and a theme hook to draw the same
 * thing, and this app already carries one it would rather not use twice.
 */
import { escapeHtml } from '../format.js';
import { renderExposureHistory, DEX_COLOUR, GEX_COLOUR } from './exposureHistory.js';

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

/* ── grouping rows into bars ───────────────────────────────────────────── */

/** Daily, weekly or monthly — the flows panel, which reports whole days. */
const GRAINS = [
  { id: 'daily', label: 'Daily', bars: 30 },
  { id: 'weekly', label: 'Weekly', bars: 26 },
  { id: 'monthly', label: 'Monthly', bars: 12 },
];

const grainDef = (id) => GRAINS.find((g) => g.id === id) ?? GRAINS[0];

/** The Monday of a day's week, which is what a weekly bucket is stacked on. */
function mondayOf(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const bucketKey = (iso, id) =>
  (id === 'weekly' ? mondayOf(iso) : id === 'monthly' ? iso.slice(0, 7) : iso);

const bucketLabel = (key, id) => (id === 'monthly'
  ? `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`
  : dayLabel(key));

/**
 * Group whole days into days, weeks or months, oldest first.
 *
 * Only the grouping is shared. What a bucket then *means* differs between the
 * two panels and is decided by the caller, because a week of ETF flow is a sum
 * and a week of exposure is not.
 */
function bucket(rows, id, dateOf) {
  const buckets = new Map();
  for (const row of rows) {
    const key = bucketKey(dateOf(row), id);
    const list = buckets.get(key);
    if (list) list.push(row); else buckets.set(key, [row]);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, list]) => ({ key, label: bucketLabel(key, id), rows: list }));
}

/* ── the plot area, shared by both charts ──────────────────────────────── */

const W = 900;
const H = 190;
const PAD = { left: 60, right: 12, top: 14, bottom: 24 };
const PLOT = { x0: PAD.left, x1: W - PAD.right, y0: PAD.top, y1: H - PAD.bottom };

/**
 * The y scale.
 *
 * Zero belongs on it whenever the series is anywhere near zero: both of these
 * are signed quantities whose sign is the whole point, and an axis that floated
 * free would hide a curve crossing into negative gamma — the single most
 * important thing either chart can show.
 *
 * But forcing zero on unconditionally was its own kind of lie. Net delta on an
 * index book sits in the low trillions and drifts by a few per cent, because it
 * is dominated by deep in-the-money call open interest that barely moves. An
 * axis stretched from zero to two trillion renders that drift as **7.7% of the
 * chart height** — a flat line pinned to the top, which reads as "nothing ever
 * happens and it is never negative" when in fact it moved by $168B.
 *
 * So zero is kept when the data reaches it or comes close, and dropped when the
 * series lives nowhere near it. Dropping it is never silent: `zeroOffAxis` is
 * set and the caller prints it on the chart, because an axis that does not
 * start at zero will be misread about magnitude unless it says so.
 */
function scaleFor(values, plot = PLOT, { anchorZero = true } = {}) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);

  /** How far the series sits from zero, against how much it actually moves. */
  const spread = hi - lo;
  const gap = Math.min(Math.abs(lo), Math.abs(hi));
  const crossesZero = lo <= 0 && hi >= 0;
  /**
   * Near enough to zero to keep it: the run to zero is no more than three times
   * the movement in the series. Past that the movement stops being visible.
   */
  const nearZero = crossesZero || spread <= 0 || gap / spread <= 3;
  const keepZero = anchorZero || nearZero;

  const max = keepZero ? Math.max(0, hi) : hi + spread * 0.12;
  const min = keepZero ? Math.min(0, lo) : lo - spread * 0.12;
  const span = max - min || 1;

  return {
    max,
    min,
    /** True when the reader must be told the axis is not anchored at zero. */
    zeroOffAxis: !keepZero,
    y: (v) => plot.y1 - ((v - min) / span) * (plot.y1 - plot.y0),
  };
}

const xAt = (i, n, plot = PLOT) => (n <= 1
  ? (plot.x0 + plot.x1) / 2
  : plot.x0 + (i / (n - 1)) * (plot.x1 - plot.x0));

function axisLabels(points, xFor, bottom = H) {
  const n = points.length;
  const step = Math.max(1, Math.ceil(n / 8));
  return points.map((p, i) =>
    (i % step === 0 || i === n - 1
      ? `<text x="${xFor(i).toFixed(1)}" y="${bottom - 8}" class="cv-xtick"
          text-anchor="middle">${escapeHtml(p.label)}</text>`
      : '')).join('');
}

/**
 * Four levels rather than three, evenly spaced across the range.
 *
 * Maximum, zero and minimum alone leave the eye nothing to measure the middle
 * of a curve against, which is where a history spends most of its time. Zero is
 * always kept and always marked differently, because on a signed quantity it is
 * not just another gridline.
 */
function gridFor(s, format, levels = 1, plot = PLOT) {
  const values = new Set([s.max, s.min]);
  // Only when it is actually inside the range — a zero line drawn off the plot
  // lands on the edge and reads as an axis bound.
  if (s.min <= 0 && s.max >= 0) values.add(0);
  for (let i = 1; i < levels; i += 1) values.add(s.min + ((s.max - s.min) * i) / levels);

  return [...values].sort((a, b) => b - a).map((v) => {
    const y = s.y(v).toFixed(1);
    return `<line x1="${plot.x0}" y1="${y}" x2="${plot.x1}" y2="${y}"
        class="cv-grid${v === 0 ? ' is-zero' : ''}" />
      <text x="${plot.x0 - 10}" y="${y}" class="cv-ytick" text-anchor="end"
        dominant-baseline="middle">${format(v)}</text>`;
  }).join('');
}

/**
 * One line chart: stroke, dots and a grid, with no fill under the curve.
 *
 * Points are joined straight rather than smoothed: a spline through option
 * strikes invents gamma at prices where no contract trades, and the kinks are
 * real — they are where the open interest sits.
 */
function lineChart({ points, colour, markIndex, title, note }) {
  if (!points.length) return '';
  const plot = PLOT;
  const box = H;
  const s = scaleFor(points.map((p) => p.value), plot);
  const n = points.length;

  const coords = points.map((p, i) => ({ x: xAt(i, n, plot), y: s.y(p.value) }));
  const line = coords.map((c, i) => `${i ? 'L' : 'M'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  const zeroY = s.y(0);
  const area = `${line} L ${coords[n - 1].x.toFixed(1)} ${zeroY.toFixed(1)}`
    + ` L ${coords[0].x.toFixed(1)} ${zeroY.toFixed(1)} Z`;

  const mark = markIndex >= 0 ? `
    <line x1="${xAt(markIndex, n, plot).toFixed(1)}" y1="${plot.y0}"
          x2="${xAt(markIndex, n, plot).toFixed(1)}" y2="${plot.y1}" class="cv-mark" />
    <text x="${xAt(markIndex, n, plot).toFixed(1)}" y="${plot.y0 - 3}" class="cv-marklbl"
          text-anchor="middle">spot</text>` : '';

  const dots = coords.map((c) =>
    `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="2.4" fill="${colour}" />`).join('');

  // A filled area answers "how much", which is the question the strike profile
  // asks: the slab under the curve is the wall.
  const axisNote = s.zeroOffAxis
    ? '<span class="cv-warn" title="This series never comes near zero, so the axis is scaled to the range it actually moves through. Judge the change, not the height.">axis not from zero</span>'
    : '';

  return `<div class="cv-title">${escapeHtml(title)}${
  note ? `<span class="cv-note">${escapeHtml(note)}</span>` : ''}${axisNote}</div>
    <svg class="cv" viewBox="0 0 ${W} ${box}" preserveAspectRatio="none" role="img"
         aria-label="${escapeHtml(title)}">
      ${gridFor(s, short, 1, plot)}${mark}
      <path d="${area}" fill="${colour}" opacity="0.14" />
      <path d="${line}" fill="none" stroke="${colour}" stroke-width="2"
            stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
      ${dots}
      ${axisLabels(points, (i) => xAt(i, n, plot), box)}
      <line class="cv-hair" y1="${plot.y0}" y2="${plot.y1}" x1="0" x2="0" hidden />
      <circle class="cv-hot" r="5" fill="${colour}" hidden />
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
/** The handlers currently bound to a chart host, so they can be taken off. */
const BOUND = new WeakMap();

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
    /**
     * The exposure charts live in two divs that index.html ships and this only
     * ever refills, so the same element is bound again on every render — a
     * refresh, or a switch between views. Without dropping the previous pair
     * the handlers stack up, and each one reads a closure over the data it was
     * created with: hovering a curve drawn from weekly buckets would also run
     * the daily and by-strike readouts, last one winning.
     */
    const previous = BOUND.get(chart);
    if (previous) {
      chart.removeEventListener('pointermove', previous.move);
      chart.removeEventListener('pointerleave', previous.clear);
    }
    chart.addEventListener('pointermove', move);
    chart.addEventListener('pointerleave', clear);
    BOUND.set(chart, { move, clear });
  }
}

/** Remember each point's y so the hover dot can sit on the curve. */
function stampYs(container, points) {
  const svg = container?.querySelector('svg');
  if (!svg) return;
  // The same scale the chart was drawn with, recomputed rather than handed in.
  const s = scaleFor(points.map((p) => p.value), PLOT);
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

/**
 * The strike profile: gamma and delta across prices, right now.
 */
function drawByStrike(profile, gex, dex) {
  const at = spotIndex(profile.strikes, profile.spot);
  const points = (key) => profile.strikes.map((r) => ({
    label: strikeLabel(r.strike), value: r[key],
  }));
  const gexPoints = points('gex');
  const dexPoints = points('dex');

  gex.innerHTML = lineChart({
    points: gexPoints, colour: GEX_COLOUR, markIndex: at, title: 'GEX · Gamma exposure ($)',
  });
  dex.innerHTML = lineChart({
    points: dexPoints, colour: DEX_COLOUR, markIndex: at, title: 'DEX · Delta exposure ($)',
  });
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

export function renderExposure(profile, onPick) {
  const card = el('optionsCard');
  if (!card) return;
  card.style.display = profile ? '' : 'none';
  if (!profile) return;
  if (onPick) lastPick = onPick;

  const name = el('optMarketName');
  if (name) name.textContent = profile.label ?? profile.market;

  const picker = el('optPicker');
  if (picker) {
    /**
     * Grouped by what the underlying is, with the group named beside its
     * buttons. Four markets do not strictly need grouping; the label is there
     * because it tells a reader that crypto and an index are not the same kind
     * of number, which matters more as the list grows.
     */
    const groups = [];
    for (const m of profile.markets ?? []) {
      const name = m.group ?? '';
      const last = groups[groups.length - 1];
      if (last && last.name === name) last.items.push(m);
      else groups.push({ name, items: [m] });
    }
    picker.innerHTML = groups.map((g) => `${g.name
      ? `<span class="opt-group">${escapeHtml(g.name)}</span>` : ''}${g.items.map((m) =>
      `<button class="opt-tab${m.id === profile.market ? ' active' : ''}"
        data-market="${escapeHtml(m.id)}">${escapeHtml(m.id)}</button>`).join('')}`).join('');
    picker.onclick = (e) => {
      const id = e.target?.dataset?.market;
      if (id) lastPick?.(id);
    };
  }

  /**
   * The headline, which is the first thing read and used to be a small cell in
   * a row of four.
   *
   * A GEX figure is only useful with its sign attached to a sentence: positive
   * means dealers are long gamma and their hedging leans against a move, which
   * is the difference between a market that grinds and one that runs. The
   * reference dashboards all print that sentence and they are right to.
   */
  const headline = el('optHeadline');
  if (headline) {
    const positive = profile.netGex >= 0;
    const pain = profile.maxPain;
    const painGap = pain && profile.spot
      ? ` (${((pain / profile.spot - 1) * 100).toFixed(1)}% from spot)` : '';
    const band = profile.band
      ? `Chart shows strikes within ±${profile.band.pct}% of spot · the totals above are the whole chain`
      : '';

    headline.innerHTML = `
      <div class="opt-hl-top">
        <span class="opt-hl-lbl">GEX · Gamma exposure</span>
        <strong class="opt-hl-val ${positive ? 'is-up' : 'is-down'}">${
  profile.netGex >= 0 ? '+' : '−'}${short(Math.abs(profile.netGex))}</strong>
        <span class="opt-hl-badge ${positive ? 'is-up' : 'is-down'}">${
  positive ? 'Long gamma' : 'Short gamma'}</span>
      </div>
      <div class="opt-hl-say">${positive
    ? 'Dealer hedging leans against moves here — rallies and dips both meet resistance.'
    : 'Dealer hedging amplifies moves here — a push in either direction tends to extend.'}${
  pain ? ` Max pain ${strikeLabel(pain)}${painGap}.` : ''}</div>
      <div class="opt-hl-fine">Max pain is the strike where the options outstanding are worth
        least at expiry. It is not a target.${band ? ` · ${escapeHtml(band)}` : ''}</div>`;
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
  profile.gammaFlip ? strikeLabel(profile.gammaFlip) : '—'}</strong></div>
      <div class="opt-stat"><span>Max pain</span><strong>${
  profile.maxPain ? strikeLabel(profile.maxPain) : '—'}</strong></div>`;
  }

  /**
   * Where the numbers came from and how old they are.
   *
   * The reference dashboard prints a publication time on every screen, and that
   * is the single most useful piece of furniture on it: an exposure figure with
   * no stated age invites being read as live when it is not.
   */
  const source = el('optSource');
  if (source) {
    const struck = profile.struck ? new Date(profile.struck) : null;
    const modelled = profile.greeks?.modelled
      ? ` · greeks modelled from implied volatility on ${profile.greeks.modelled.toLocaleString()} contracts`
      : '';
    source.innerHTML = `${escapeHtml(profile.source?.name ?? '')} · ${
  escapeHtml(profile.source?.note ?? '')}${struck
    ? ` · chain struck ${escapeHtml(struck.toLocaleString())}` : ''}${escapeHtml(modelled)}`;
  }

  const gex = el('optGex');
  const dex = el('optDex');
  if (gex && dex) drawByStrike(profile, gex, dex);

  // Through time, in its own block under the strike profile. See exposureHistory.js.
  renderExposureHistory(profile);
}

/* ── the flows panel ───────────────────────────────────────────────────── */

/** Daily, weekly or monthly. Survives a re-render, like the market does. */
let grain = 'daily';
let lastFlows = null;

/**
 * Roll daily flows into weeks or months.
 *
 * Summed, not averaged: a week's flow is the money that moved that week, and
 * an average would answer a question nobody asked. Exposure is rolled up the
 * other way — see rollUpExposure.
 */
export function rollUp(flows, id) {
  return bucket(flows, id, (f) => f.date).map((b) => ({
    label: b.label,
    value: +b.rows.reduce((s, f) => s + f.flow, 0).toFixed(1),
  }));
}

/**
 * Which day the newest flow figure is for.
 *
 * Funds report a day late and not at all at weekends, so the newest number is
 * routinely two or three days old — it read latest beside a figure from the
 * Friday before, which invites it to be taken as today's. Naming the day costs
 * nothing and is the difference between a stale number and a dated one.
 */
function flowDay(date) {
  if (!date) return 'latest';
  const today = new Date().toISOString().slice(0, 10);
  if (date === today) return 'today';
  const days = Math.round((Date.parse(today) - Date.parse(date)) / 86400000);
  if (days === 1) return 'yesterday';
  const [y, m, d] = date.split('-').map(Number);
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1];
  return Number.isFinite(days) && days > 1 ? `${d} ${month}` : date;
}

function drawFlows() {
  const body = el('etfBody');
  if (!body || !lastFlows) return;
  const bars = grainDef(grain).bars;

  body.innerHTML = ['BTC', 'ETH'].map((id) => {
    const set = lastFlows[id];
    if (!set?.flows?.length) return '';
    const s = set.summary;
    return `<div class="etf-block">
      <div class="etf-head">
        <span class="etf-name">${escapeHtml(set.label)}</span>
        <span class="etf-sum">
          <span class="${s.latest >= 0 ? 'is-up' : 'is-down'}">${s.latest >= 0 ? '+' : ''}${s.latest.toFixed(1)}M</span>
          <span class="etf-sub">${escapeHtml(flowDay(s.latestDate))} · week ${s.week >= 0 ? '+' : ''}${s.week.toFixed(0)}M
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

    const rolled = rollUp(set.flows, grain).slice(-bars);
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
