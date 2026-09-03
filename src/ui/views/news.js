/**
 * The News page.
 *
 * Fear-and-greed dials in the corner, the odds on the Fed's next decision,
 * this week's US releases, options exposure by strike, and daily ETF flows.
 * All of it is fetched and worked out on the server; the views here only draw
 * the answers, and each one hides itself rather than showing an empty frame
 * when its source has nothing.
 */
import { MONTHS_LONG } from '../../config/constants.js';
import { fedDecision } from '../../services/fed.js';
import { econReleases } from '../../services/econ.js';
import { marketSentiment } from '../../services/sentiment.js';
import { gaugeSvg } from './gauge.js';
import { optionsProfile, etfFlows } from '../../services/options.js';
import { renderExposure, renderEtfFlows, currentMarket, setMarket } from './exposure.js';
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

/** "205K", "-0.3%", "-89.4B" as a number, so two of them can be compared. */
function figure(text) {
  const m = /^(-?[\d.]+)\s*([KMB])?/i.exec(String(text ?? '').trim());
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  const scale = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] ?? 1;
  return value * scale;
}

/**
 * What a release printed, once it has.
 *
 * The caret says which side of the forecast it came in on and nothing more. It
 * is deliberately not coloured green or red: a fall in jobless claims is good
 * news and a fall in GDP is not, so a column that judged every surprise the
 * same way would be wrong about half of them.
 */
function actualCell(r) {
  if (!r.actual) return '—';
  const actual = figure(r.actual);
  const forecast = figure(r.forecast);
  const arrow = actual != null && forecast != null && actual !== forecast
    ? `<span class="econ-vs" title="${actual > forecast ? 'Above' : 'Below'} forecast ${
      escapeHtml(r.forecast)}">${actual > forecast ? '▲' : '▼'}</span>`
    : '';
  return `<strong>${escapeHtml(r.actual)}</strong>${arrow}`;
}

/**
 * This week's releases, in the order they land: what printed, when it is due,
 * what was expected, and what it was last time.
 *
 * Those figures are the whole point. Whether the gap between any two of them
 * matters is the reader's judgement, not the panel's, so nothing here colours
 * or ranks them. A release still to come has a dash where its figure will go,
 * and one already out keeps that figure for the rest of the week.
 */
export function renderEconPanel(data) {
  const card = el('econCard');
  const rows = el('econRows');
  if (!card || !rows) return;

  card.style.display = data ? '' : 'none';
  if (!data) return;

  const releases = data.releases ?? [];
  const today = new Date().toISOString().slice(0, 10);

  // A week holding none of these is an answer, and saying so beats an empty
  // card that looks like something failed to load.
  rows.innerHTML = releases.length
    ? `<div class="econ-head econ-grid">
         <div>Release</div><div>Actual</div><div>Due</div><div>Forecast</div><div>Previous</div>
       </div>` + releases.map((r) => {
      const done = r.date && r.date < today;
      return `<div class="econ-row econ-grid${done ? ' is-done' : ''}">
        <div class="econ-name">${escapeHtml(r.label)}${
  r.impact === 'High' ? '<span class="econ-flag" title="High impact">●</span>' : ''}</div>
        <div class="econ-val econ-actual">${actualCell(r)}</div>
        <div class="econ-date">${shortDate(r.date)}</div>
        <div class="econ-val">${escapeHtml(r.forecast ?? '—')}</div>
        <div class="econ-val econ-prev">${escapeHtml(r.previous ?? '—')}</div>
      </div>`;
    }).join('')
    : '<div class="empty">Nothing from this list lands this week.</div>';

  const updated = el('econUpdated');
  if (updated) {
    updated.textContent = data.week
      ? `${shortDate(data.week.from)} – ${shortDate(data.week.to)} · forexfactory.com`
      : 'forexfactory.com';
  }
}

/** The two dials in the corner of the page. */
function renderGauges(sentiment) {
  const host = el('sentimentGauges');
  if (!host) return;

  const dials = [
    ['stocks', 'Stocks'],
    ['crypto', 'Crypto'],
  ]
    .map(([key, title]) => {
      const r = sentiment?.[key];
      return r ? gaugeSvg({ value: r.value, label: r.label, title }) : '';
    })
    .filter(Boolean);

  host.style.display = dials.length ? '' : 'none';
  host.innerHTML = dials.join('');
}

/** Switching market redraws only the exposure panel, not the whole page. */
async function pickMarket(id) {
  setMarket(id);
  const profile = await optionsProfile(id);
  renderExposure(profile, pickMarket);
  scheduleLive(profile);
}

/* ── keeping the exposure panel live ───────────────────────────────────── */

/**
 * The exposure panel refreshes itself while it is on screen.
 *
 * Only this panel: the Fed's odds, the week's calendar and the ETF flows all
 * change on the order of a day, and re-asking for them on a minute's timer
 * would be traffic for its own sake.
 *
 * How often is the answer's own business — Deribit says a minute, the CBOE
 * chains say a quarter hour, and both are what those sources can actually
 * deliver. A floor is kept here anyway so that a bad `refreshMs` from a
 * future change cannot turn this into a hot loop.
 */
const LIVE_FLOOR_MS = 30 * 1000;
let liveTimer = null;

function scheduleLive(profile) {
  clearTimeout(liveTimer);
  const wait = Math.max(LIVE_FLOOR_MS, Number(profile?.refreshMs) || 60000);
  liveTimer = setTimeout(refreshLive, wait);
}

async function refreshLive() {
  const card = el('optionsCard');
  /**
   * A hidden page still has its elements, so the check is whether the card is
   * laid out at all — offsetParent is null inside a display:none page. Together
   * with the visibility check that means a backgrounded tab or another page
   * costs nothing upstream; the timer keeps ticking so it resumes on its own.
   */
  const onScreen = card && card.offsetParent !== null && document.visibilityState === 'visible';
  if (!onScreen) {
    liveTimer = setTimeout(refreshLive, LIVE_FLOOR_MS);
    return;
  }

  const profile = await optionsProfile(currentMarket());
  if (profile) renderExposure(profile, pickMarket);
  scheduleLive(profile);
}

/**
 * Fetched after the page is drawn, never before it.
 *
 * Five sources, asked together and settled independently: one being down must
 * not take the other four with it.
 */
export async function renderNews() {
  // Independent of each other: one source being down must not blank the others.
  const [fed, econ, mood, opts, etf] = await Promise.allSettled([
    fedDecision(), econReleases(), marketSentiment(),
    optionsProfile(currentMarket()), etfFlows(),
  ]);
  const value = (r) => (r.status === 'fulfilled' ? r.value : null);

  renderFedPanel(value(fed));
  renderEconPanel(value(econ));
  renderGauges(value(mood));
  renderExposure(value(opts), pickMarket);
  renderEtfFlows(value(etf));
  scheduleLive(value(opts));

  const anything = value(fed) || value(econ) || value(mood) || value(opts) || value(etf);
  const empty = el('newsEmpty');
  if (empty) empty.style.display = anything ? 'none' : '';
}
