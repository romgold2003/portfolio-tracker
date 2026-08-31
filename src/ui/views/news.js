/**
 * The News page.
 *
 * Two panels: what the market expects of the Fed at its next meeting, priced
 * off 30-day fed funds futures, and forecast against previous for the US
 * releases that move rates. Both are fetched and worked out on the server; this
 * file only draws the answers.
 */
import { MONTHS_LONG } from '../../config/constants.js';
import { fedDecision } from '../../services/fed.js';
import { econReleases } from '../../services/econ.js';
import { escapeHtml } from '../format.js';

const el = (id) => document.getElementById(id);

/**
 * The three things the committee can do, as three columns.
 *
 * Heights are the odds, so the panel is read at a glance rather than parsed:
 * one tall bar is a decided market, three stubby ones are a coin toss. The
 * percentage is printed as well, because a bar answers "which" and only a
 * number answers "how much".
 */
const FED_BARS = [
  { key: 'increase', label: 'Raise', colour: 'var(--red)' },
  { key: 'hold', label: 'Hold', colour: 'var(--text3)' },
  { key: 'decrease', label: 'Cut', colour: 'var(--green)' },
];

/** "16 September 2026", which is how anyone says it out loud. */
function meetingLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS_LONG[m - 1]} ${y}`;
}

function renderFedPanel(decision) {
  const card = el('fedCard');
  const bars = el('fedBars');
  if (!card || !bars) return;

  // No answer, no panel. See the note in the markup.
  card.style.display = decision ? '' : 'none';
  if (!decision) return;

  const meeting = el('fedMeeting');
  if (meeting) meeting.textContent = meetingLabel(decision.meeting);

  bars.innerHTML = FED_BARS.map(({ key, label, colour }) => {
    const p = (decision.odds?.[key] ?? 0) * 100;
    // A bar of literally zero reads as a rendering fault rather than as zero,
    // so the floor is a sliver that is visibly nothing.
    const height = Math.max(p, 1.2);
    return `<div class="fed-bar" title="${label}: ${p.toFixed(1)}%">
      <div class="fed-bar-pct">${p.toFixed(0)}%</div>
      <div class="fed-bar-track">
        <div class="fed-bar-fill" style="height:${height}%;background:${colour}"></div>
      </div>
      <div class="fed-bar-label">${label}</div>
    </div>`;
  }).join('');
}

/** "4 Sep" — enough to place it, short enough to sit in a column. */
function shortDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS_LONG[m - 1].slice(0, 3)}`;
}

/**
 * Forecast against previous, one row each.
 *
 * The two figures are the whole point: what the market is braced for, and what
 * it was last time. Whether the gap between them matters is the reader's
 * judgement, not the panel's, so nothing here colours or ranks them.
 */
function renderEconPanel(releases) {
  const card = el('econCard');
  const rows = el('econRows');
  if (!card || !rows) return;

  card.style.display = releases?.length ? '' : 'none';
  if (!releases?.length) return;

  const today = new Date().toISOString().slice(0, 10);

  rows.innerHTML = `<div class="econ-head econ-grid">
      <div>Release</div><div>Due</div><div>Forecast</div><div>Previous</div>
    </div>` + releases.map((r) => {
    const ahead = r.date && r.date >= today;
    return `<div class="econ-row econ-grid${ahead ? ' is-ahead' : ''}">
      <div class="econ-name">${escapeHtml(r.label)}${
  r.impact === 'High' ? '<span class="econ-flag" title="High impact">●</span>' : ''}</div>
      <div class="econ-date">${shortDate(r.date)}</div>
      <div class="econ-val">${escapeHtml(r.forecast ?? '—')}</div>
      <div class="econ-val econ-prev">${escapeHtml(r.previous ?? '—')}</div>
    </div>`;
  }).join('');

  const updated = el('econUpdated');
  if (updated) updated.textContent = 'forexfactory.com';
}

/**
 * Fetched after the page is drawn, never before it.
 *
 * A slow or missing feed must cost the page nothing, so this never throws and
 * the panel it belongs to simply stays hidden.
 */
export async function renderNews() {
  // Independent of each other: one source being down must not blank the other.
  const [fed, econ] = await Promise.allSettled([fedDecision(), econReleases()]);

  renderFedPanel(fed.status === 'fulfilled' ? fed.value : null);
  renderEconPanel(econ.status === 'fulfilled' ? econ.value : null);

  const empty = el('newsEmpty');
  const anything = (fed.status === 'fulfilled' && fed.value)
    || (econ.status === 'fulfilled' && econ.value?.length);
  if (empty) empty.style.display = anything ? 'none' : '';
}
