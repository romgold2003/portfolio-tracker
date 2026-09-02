/**
 * Options exposure by strike, and daily ETF flows.
 *
 * Both are drawn as rows of divs rather than as charts. Each is a single series
 * of signed values against a category axis, which is a bar and a label; a
 * charting library would add a canvas, a resize observer and a theme hook to
 * draw the same thing.
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
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

const strikeLabel = (v) => (v >= 10000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)));

/**
 * One diverging bar chart: negatives left of centre, positives right.
 *
 * The zero line is the middle of the row rather than the left edge, because the
 * sign is the whole message — gamma above spot behaves differently from gamma
 * below it, and a chart that puts both on the same side hides that.
 */
function barRows({ rows, valueOf, labelOf, markAt, title }) {
  const peak = Math.max(...rows.map((r) => Math.abs(valueOf(r))), 1);

  const body = rows.map((r) => {
    const v = valueOf(r);
    const width = (Math.abs(v) / peak) * 50;
    const positive = v >= 0;
    const marked = markAt != null && r.strike === markAt;
    return `<div class="bar-row${marked ? ' is-spot' : ''}">
      <div class="bar-label">${escapeHtml(labelOf(r))}</div>
      <div class="bar-track">
        <div class="bar-zero"></div>
        <div class="bar-fill ${positive ? 'is-up' : 'is-down'}"
             style="width:${width.toFixed(2)}%;${positive ? 'left:50%' : `right:50%`}"></div>
      </div>
      <div class="bar-value ${positive ? 'is-up' : 'is-down'}">${short(v)}</div>
    </div>`;
  }).join('');

  return `<div class="bar-title">${escapeHtml(title)}</div>${body}`;
}

/** The strike nearest spot, so the row at the money can be marked. */
function nearestStrike(strikes, spot) {
  let best = null;
  for (const r of strikes) {
    if (best === null || Math.abs(r.strike - spot) < Math.abs(best - spot)) best = r.strike;
  }
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
    // The flip is the number people look for; it is absent when cumulative
    // gamma never crosses zero inside the strikes on the chart, and saying so
    // is better than printing a strike that did not cross anything.
    stats.innerHTML = `
      <div class="opt-stat"><span>Spot</span><strong>${strikeLabel(profile.spot)}</strong></div>
      <div class="opt-stat"><span>Net GEX</span><strong class="${profile.netGex >= 0 ? 'is-up' : 'is-down'}">${short(profile.netGex)}</strong></div>
      <div class="opt-stat"><span>Net DEX</span><strong class="${profile.netDex >= 0 ? 'is-up' : 'is-down'}">${short(profile.netDex)}</strong></div>
      <div class="opt-stat"><span>Gamma flip</span><strong>${
  profile.gammaFlip ? strikeLabel(profile.gammaFlip) : '—'}</strong></div>`;
  }

  const spotStrike = nearestStrike(profile.strikes, profile.spot);
  const gex = el('optGex');
  const dex = el('optDex');
  if (gex) {
    gex.innerHTML = barRows({
      rows: profile.strikes,
      valueOf: (r) => r.gex,
      labelOf: (r) => strikeLabel(r.strike),
      markAt: spotStrike,
      title: 'GEX · gamma exposure by strike',
    });
  }
  if (dex) {
    dex.innerHTML = barRows({
      rows: profile.strikes,
      valueOf: (r) => r.dex,
      labelOf: (r) => strikeLabel(r.strike),
      markAt: spotStrike,
      title: 'DEX · delta exposure by strike',
    });
  }
}

/** "2 Sep" for a bar of one day's flow. */
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
    // The last three weeks. Beyond that the bars are too thin to read and the
    // summary above them says what the longer run did.
    const recent = set.flows.slice(-21);
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
      ${barRows({
    rows: recent,
    valueOf: (r) => r.flow,
    labelOf: (r) => dayLabel(r.date),
    markAt: null,
    title: '',
  })}
    </div>`;
  }).join('');
}
