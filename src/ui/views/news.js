/**
 * The News page.
 *
 * One panel so far: what the market expects of the Fed at its next meeting,
 * priced off 30-day fed funds futures. The arithmetic behind it lives on the
 * server in api/_lib/fedwatch.js; this file only draws the answer.
 */
import { MONTHS_LONG } from '../../config/constants.js';
import { fedDecision } from '../../services/fed.js';

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
  const empty = el('newsEmpty');
  if (!card || !bars) return;

  // No answer, no panel. See the note in the markup.
  card.style.display = decision ? '' : 'none';
  if (empty) empty.style.display = decision ? 'none' : '';
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

  const note = el('fedNote');
  if (note) {
    const bps = decision.changeBps;
    const move = bps === 0 ? 'no change' : `${bps > 0 ? '+' : ''}${bps.toFixed(0)} bps`;
    note.innerHTML = `Priced at <strong>${decision.expected.toFixed(2)}%</strong>
      against <strong>${decision.entering.toFixed(2)}%</strong> today — ${move}.
      <span class="fed-src">From 30-day fed funds futures, the same basis as CME FedWatch.</span>`;
  }
}

/**
 * Fetched after the page is drawn, never before it.
 *
 * A slow or missing futures feed must cost the page nothing, so this never
 * throws and the panel simply stays hidden.
 */
export async function renderNews() {
  try {
    renderFedPanel(await fedDecision());
  } catch {
    renderFedPanel(null);
  }
}
