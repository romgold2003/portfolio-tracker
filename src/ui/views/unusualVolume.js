/**
 * The unusual-volume panel: where today's turnover is, and which way price went.
 *
 * Two numbers per coin and one arrow. The multiple — "four times the usual" — is
 * what a person reads; the score is what the list is ordered by, because four
 * times means different things on different coins. The arrow is there because
 * volume alone says only that something happened.
 *
 * The tier filter exists for the same reason the whale panels have bands: on a
 * quiet day almost nothing is unusual, and a list of seventy coins reading
 * "normal" buries the two that are not.
 */
import { unusualVolume, TIERS, tierOf } from '../../services/unusualVolume.js';
import { escapeHtml, pctText as fp, pnlColor as clr } from '../format.js';

const el = (id) => document.getElementById(id);

/** Which tier the panel is filtered to, and the last answer, across re-renders. */
let tier = 'busy';
let rows = null;
let failed = null;

/** Only the tiers worth filtering by: "quiet" is never what anyone is looking for. */
const FILTERS = [
  { id: 'busy', label: 'Busy and up', min: 1.5 },
  { id: 'unusual', label: 'Unusual', min: 2 },
  { id: 'extreme', label: 'Extreme', min: 3 },
  { id: 'all', label: 'Everything', min: -Infinity },
];

const filterDef = (id) => FILTERS.find((f) => f.id === id) ?? FILTERS[0];

/** Turnover, in the units people say out loud. */
function money(n) {
  if (!(n > 0)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${(n / 1e3).toFixed(0)}k`;
}

/**
 * The multiple, said the way it would be spoken.
 *
 * Two decimals below ten because the difference between 2.1 and 2.9 matters at
 * that end, and none above it because nobody needs "43.30 times".
 */
const times = (rvol) => (rvol >= 10 ? `${Math.round(rvol)}×` : `${rvol.toFixed(2)}×`);

function row(r) {
  const t = tierOf(r.z);
  const arrow = r.direction > 0 ? '▲' : r.direction < 0 ? '▼' : '–';
  return `<div class="uv-row">
    <div class="uv-tk">${escapeHtml(r.ticker)}</div>
    <div class="uv-mult" title="${escapeHtml(times(r.rvol))} a normal day for ${escapeHtml(r.ticker)}, measured over ${r.days} days">
      ${escapeHtml(times(r.rvol))}
    </div>
    <div class="uv-tier uv-${t.id}" title="${escapeHtml(t.note)}">${escapeHtml(t.label)}</div>
    <div class="uv-move" style="color:${clr(r.change ?? 0)}">${arrow} ${fp(r.change ?? 0)}</div>
    <div class="uv-vol">${money(r.volume)}</div>
  </div>`;
}

function drawFilters() {
  const picker = el('uvTier');
  if (!picker) return;
  const counts = new Map(FILTERS.map((f) => [f.id, (rows ?? []).filter((r) => (r.z ?? 0) >= f.min).length]));
  picker.innerHTML = FILTERS.map((f) => {
    const n = counts.get(f.id) ?? 0;
    return `<button class="opt-tab${f.id === tier ? ' active' : ''}${n ? '' : ' is-empty'}"
      data-uvtier="${f.id}">${escapeHtml(f.label)}<span class="gam-count">${n}</span></button>`;
  }).join('');
  if (picker.dataset.bound !== '1') {
    picker.dataset.bound = '1';
    picker.addEventListener('click', (e) => {
      const button = e.target.closest('[data-uvtier]');
      if (!button) return;
      tier = button.dataset.uvtier;
      draw();
    });
  }
}

function draw() {
  const host = el('uvRows');
  if (!host) return;
  drawFilters();

  const name = el('uvCount');
  const src = el('uvSrc');

  if (failed) {
    host.innerHTML = `<div class="empty">${escapeHtml(failed)}</div>`;
    if (name) name.textContent = 'unavailable';
    return;
  }
  if (!rows) {
    host.innerHTML = '<div class="empty">Reading the last twenty days for each coin…</div>';
    if (name) name.textContent = 'loading';
    return;
  }

  const shown = rows.filter((r) => (r.z ?? 0) >= filterDef(tier).min);
  if (name) name.textContent = `${shown.length} coin${shown.length === 1 ? '' : 's'}`;
  if (src) {
    src.textContent = `Binance · ${rows.length} coins measured · rolling 24 hours against each coin's own 20-day median`;
  }

  /**
   * An empty list is an answer and says which one.
   *
   * Most days nothing is extreme — that is what makes the word mean anything —
   * and "no coin is trading unusually today" must not read as a panel that
   * failed to load.
   */
  host.innerHTML = shown.length
    ? `<div class="uv-row uv-head">
         <div>Coin</div><div>vs normal</div><div></div><div>24h</div><div>Turnover</div>
       </div>${shown.map(row).join('')}`
    : `<div class="empty">Nothing is trading ${escapeHtml(filterDef(tier).label.toLowerCase())} today, out of ${rows.length} coins.</div>`;
}

/**
 * Fetch and draw. A failed refresh leaves whatever is on screen: the turnover
 * of the last twenty days has not changed because one request did not land.
 */
export async function renderUnusualVolume() {
  const card = el('volumeCard');
  if (!card) return;
  draw();
  try {
    const answer = await unusualVolume();
    rows = answer;
    failed = null;
  } catch (err) {
    console.error('Unusual volume: could not read the exchange.', err);
    if (!rows) failed = 'Could not read the exchange just now. It will try again on the next refresh.';
  }
  draw();
}

/** Every tier, for a caller that wants to describe them. */
export { TIERS };
