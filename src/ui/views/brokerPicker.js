/**
 * The import window's first step (November 2026): pick your broker, and see
 * exactly how to get the file out of it — then the years, as before.
 *
 * The broker is remembered with the sign-in, so the next import opens straight
 * on its steps. It only changes what is explained: every file is still read by
 * the same readers, whoever it came from.
 */
import { state, setBroker } from '../../core/store.js';
import { REGIONS, OTHER_BROKER, brokerById, matchBrokers } from '../../config/brokers.js';
import { escapeHtml } from '../format.js';

const el = (id) => document.getElementById(id);

const mark = (b) => `<span class="brk-mark" style="--brk:${b.color}" aria-hidden="true">${escapeHtml(b.mark)}</span>`;

function tile(b) {
  const sub = b.native ? `<small dir="rtl">${escapeHtml(b.native)}</small>`
    : b === OTHER_BROKER ? '<small>Any CSV or Excel file</small>' : '';
  return `<button type="button" class="brk" data-broker="${b.id}" onclick="chooseBroker('${b.id}')">
    ${mark(b)}<span class="brk-name">${escapeHtml(b.name)}${sub}</span></button>`;
}

/** Every broker, by region, narrowed to what was typed; Another broker is always there. Exported for the tests. */
export function brokerListHtml(query = '') {
  const found = matchBrokers(query);
  const groups = REGIONS.map((r) => {
    const items = found.filter((b) => b.region === r.id);
    return items.length
      ? `<div class="brk-group"><div class="brk-title">${r.title}</div><div class="brk-grid">${items.map(tile).join('')}</div></div>`
      : '';
  }).join('');
  const none = found.length ? ''
    : `<p class="brk-none">No broker called “${escapeHtml(query.trim())}” in the list. Choose <b>Another broker</b> — any CSV or Excel file works.</p>`;
  return `${groups}${none}<div class="brk-group"><div class="brk-title">Not in the list?</div><div class="brk-grid">${tile(OTHER_BROKER)}</div></div>`;
}

/** The chosen broker's steps to get the file. Exported for the tests. */
export function brokerGuideHtml(b) {
  return `<div class="imp-broker">${mark(b)}
      <div class="imp-broker-name"><b>${escapeHtml(b.name)}</b>${b.native ? `<small dir="rtl">${escapeHtml(b.native)}</small>` : ''}</div>
      <button type="button" class="btn imp-change" onclick="changeBroker()">Change broker</button>
    </div>
    <div class="imp-step-title"><span class="imp-num">1</span>Get your file from ${escapeHtml(b.name)}</div>
    <ol class="imp-steps">${b.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
    ${b.tip ? `<p class="imp-tip">${escapeHtml(b.tip)}</p>` : ''}
    <div class="imp-step-title"><span class="imp-num">2</span>Add it to Riskbook</div>
    <p class="imp-lead">${b.perYear
    ? 'Click the year your file covers. Add earlier years the same way for your full history.'
    : 'One file with everything? Press <b>One file with my whole history</b>. A file for a single year goes on that year.'}</p>`;
}

/** Show the step this person is on: the list, or their broker's steps and the years. */
export function showImportStep() {
  const broker = brokerById(state.broker);
  const pick = el('importPick');
  const guide = el('importGuide');
  if (!pick || !guide) return;
  pick.hidden = Boolean(broker);
  guide.hidden = !broker;
  if (broker) {
    el('brokerSteps').innerHTML = brokerGuideHtml(broker);
    // A broker with one file per year puts the years first; the rest, the single file.
    guide.classList.toggle('imp-whole-first', !broker.perYear);
    return;
  }
  const search = el('brokerSearch');
  if (search) search.value = '';
  el('brokerList').innerHTML = brokerListHtml('');
  // Straight into the search with a keyboard; on a phone the keyboard would cover the list.
  if (window.matchMedia?.('(pointer:fine)').matches) setTimeout(() => search?.focus(), 50);
}

export function chooseBroker(id) {
  if (!brokerById(id)) return;
  setBroker(id);
  showImportStep();
  el('yearsModal')?.querySelector('.years-modal')?.scrollTo?.(0, 0);
}

export function changeBroker() {
  setBroker(null);
  showImportStep();
}

export function filterBrokers(query) {
  const list = el('brokerList');
  if (list) list.innerHTML = brokerListHtml(query);
}
