/**
 * The Admin page (November 2026), for Romy alone, kept to what she asked for:
 *
 *  - Online now, today, this week and new today, each a number; pressing one
 *    shows how it moved over time.
 *  - A pie for each investor-profile question.
 *  - "What users see": the real sign-up screen, Terms acceptance, investor
 *    profile, tutorial, guest welcome, Terms and Privacy Policy, opened from
 *    the same code that shows them to users, so a change to any of them
 *    shows here too. Nothing in a preview is saved.
 *  - Every user, folded away, with a CSV.
 *
 * Who may open it is decided on the server (ADMIN_EMAILS, api/_lib/admin.js):
 * the button only appears once the server has said yes, and the figures are
 * refused to anyone else whatever the browser does. Nothing here reads a
 * journal — portfolios stay encrypted.
 */
import { onJournalLoaded } from '../../core/store.js';
import { isUnlocked, isGuest } from '../../core/profiles.js';
import { cloudEnabled } from '../../services/cloud.js';
import { social } from '../../services/social.js';
import { ABOUT_QUESTIONS, ABOUT_PAGES, countryName, flagOf } from '../../config/aboutYou.js';
import { TERMS_URL, PRIVACY_URL } from '../../config/legal.js';
import { escapeHtml } from '../format.js';
import { openAboutYou } from './aboutYou.js';
import { openTour, closeTour, SLIDES } from './tour.js';
import { legalGateHtml } from './legal.js';
import { guestNoticeHtml } from './guest.js';
import { createForm } from './lockScreen.js';

const el = (id) => document.getElementById(id);
let data = null;
let filter = '';
let series = 'today';

const pct = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : '—');
const day = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const shortDay = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const hourLabel = (h) => new Date(`${h}:00:00Z`).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** An answer's words, from its stored id(s). Exported for the tests. */
export function answerLabel(field, value) {
  if (!value) return '';
  if (field === 'country') return `${flagOf(value)} ${countryName(value)}`;
  if (field === 'name') return String(value);
  const q = ABOUT_QUESTIONS.find((x) => x.id === field);
  return String(value).split(',').map((id) => q?.options?.find(([o]) => o === id)?.[1] ?? id).join(', ');
}

/** The four numbers, and the history behind each. */
const SERIES = {
  online: { label: 'Online now', sub: 'active in the last 15 minutes', title: 'Users active each hour · last 48 hours', value: (d) => d.totals.online ?? 0,
    points: (d) => (d.hourly ?? []).map((h) => ({ label: hourLabel(h.hour), value: h.active })) },
  today: { label: 'Today', sub: 'users who opened Riskbook', title: 'Users active each day · last 60 days', value: (d) => d.totals.dau,
    points: (d) => d.days.map((x) => ({ label: day(x.day), value: x.active })) },
  week: { label: 'This week', sub: 'users in the last 7 days', title: 'Users active each week · last 12 weeks', value: (d) => d.totals.wau,
    points: (d) => (d.weeks ?? []).map((w) => ({ label: `${shortDay(w.start)} – ${shortDay(w.end)}`, value: w.active })) },
  new: { label: 'New today', sub: 'accounts created today', title: 'New accounts each day · last 60 days', value: (d) => d.totals.newToday,
    points: (d) => d.days.map((x) => ({ label: day(x.day), value: x.signups })) },
};

function kpisHtml(d) {
  return Object.entries(SERIES).map(([key, s]) => `<button type="button" class="adm-kpi${key === series ? ' on' : ''}" data-adm-series="${key}" aria-pressed="${key === series}">
      <span class="adm-kl">${key === 'online' ? '<span class="adm-live" aria-hidden="true"></span>' : ''}${escapeHtml(s.label)}</span>
      <span class="adm-kv">${s.value(d)}</span>
      <span class="adm-ks">${escapeHtml(s.sub)}</span>
    </button>`).join('');
}

/** Columns over time, each with its date and value on hover. Exported for the tests. */
export function chartHtml(d, key = series) {
  const s = SERIES[key];
  const points = s.points(d);
  if (!points.length) return '<p class="adm-empty">Nothing counted yet.</p>';
  const max = Math.max(1, ...points.map((p) => p.value));
  const last = points.at(-1);
  return `<div class="adm-chead"><span class="card-lbl">${escapeHtml(s.title)}</span><span class="adm-cmax">Highest ${max}</span></div>
    <div class="adm-cols" role="img" aria-label="${escapeHtml(s.title)}">${points.map((p) => `<span class="adm-col" data-tip="${escapeHtml(`${p.label}: ${p.value}`)}"><span style="height:${(p.value / max) * 100}%"></span></span>`).join('')}</div>
    <div class="adm-axis"><span>${escapeHtml(points[0].label)}</span><span>Now · ${last.value}</span></div>`;
}

/** The questions drawn as pies, in this order. */
const PIES = ['sex', 'age', 'country', 'experience', 'style', 'goal', 'occupation', 'heard'];
const MAX_SLICES = 7;

/** One pie: slices in the answers' own order (a colour stays with its answer), the rest as Other. */
function pieHtml(q, tally) {
  let slices = q.country
    ? Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([code, n]) => ({ label: `${flagOf(code)} ${countryName(code)}`, n }))
    : q.options.map(([id, label]) => ({ label, n: tally[id] ?? 0 }));
  slices = slices.map((x, i) => ({ ...x, slot: i + 1 }));
  if (slices.length > MAX_SLICES) {
    const rest = slices.slice(MAX_SLICES - 1);
    slices = [...slices.slice(0, MAX_SLICES - 1), { label: 'Other', n: rest.reduce((a, x) => a + x.n, 0), slot: 0 }];
  }
  const total = slices.reduce((a, x) => a + x.n, 0);
  const head = `<div class="card-lbl">${escapeHtml(q.title)}</div>${q.multi ? '<div class="adm-pnote">Several answers per person</div>' : ''}`;
  if (!total) return `<div class="card adm-pie">${head}<p class="adm-empty">No answers yet.</p></div>`;

  const R = 60;
  const C = 64;
  let angle = -Math.PI / 2;
  const shown = slices.filter((x) => x.n > 0);
  const paths = shown.map((x) => {
    const tip = escapeHtml(`${x.label}: ${x.n} (${pct(x.n, total)})`);
    if (x.n === total) return `<circle cx="${C}" cy="${C}" r="${R}" class="adm-slice s${x.slot}"><title>${tip}</title></circle>`;
    const a = (x.n / total) * Math.PI * 2;
    const [x1, y1] = [C + R * Math.cos(angle), C + R * Math.sin(angle)];
    angle += a;
    const [x2, y2] = [C + R * Math.cos(angle), C + R * Math.sin(angle)];
    return `<path d="M${C},${C} L${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${a > Math.PI ? 1 : 0} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" class="adm-slice s${x.slot}"><title>${tip}</title></path>`;
  }).join('');
  const legend = slices.map((x) => `<li${x.n ? '' : ' class="zero"'}><span class="adm-sw s${x.slot}" aria-hidden="true"></span><span class="adm-ll">${escapeHtml(x.label)}</span><span class="adm-ln">${x.n}</span><span class="adm-lp">${pct(x.n, total)}</span></li>`).join('');
  return `<div class="card adm-pie">${head}
    <div class="adm-pbody"><svg viewBox="0 0 128 128" class="adm-psvg" role="img" aria-label="${escapeHtml(q.title)}">${paths}</svg><ul class="adm-legend">${legend}</ul></div>
  </div>`;
}

function piesHtml(d) {
  return PIES.map((id) => pieHtml(ABOUT_QUESTIONS.find((q) => q.id === id), d.questions[id] ?? {})).join('');
}

/** What users see, opened from the same code that shows it to them. */
export const PREVIEWS = [
  ['signup', 'Sign-up screen', 'Email, password and the agreement boxes'],
  ['legal', 'Terms acceptance', 'Asked of existing users at sign-in'],
  ['profile', 'Investor profile', `The questions, on ${ABOUT_PAGES.length} pages`],
  ['tour', 'Tutorial', `The ${SLIDES.length} explanation slides`],
  ['guest', 'Guest welcome', 'Shown on entering as a guest'],
  ['terms', 'Terms of Service', 'The full document'],
  ['privacy', 'Privacy Policy', 'The full document'],
];

function previewsHtml() {
  return PREVIEWS.map(([key, label, sub]) => `<button type="button" class="adm-pv" data-adm-preview="${key}"><span class="adm-pvl">${escapeHtml(label)}</span><span class="adm-pvs">${escapeHtml(sub)}</span></button>`).join('');
}

function usersHtml(d) {
  const q = filter.trim().toLowerCase();
  const list = d.users.filter((u) => !q || u.email.toLowerCase().includes(q)
    || Object.entries(u.answers).some(([f, v]) => answerLabel(f, v).toLowerCase().includes(q)));
  const cols = ABOUT_QUESTIONS.map((x) => x.title);
  return `<div class="adm-tablewrap"><table class="adm-table">
      <thead><tr><th>Email</th><th>Joined</th><th>Last active</th><th>Days active</th><th>Agreed to terms</th><th>News emails</th>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
      <tbody>${list.map((u) => `<tr><td>${escapeHtml(u.email)}</td><td>${day(u.joined)}</td><td>${day(u.lastActive)}</td><td>${u.daysActive}</td><td>${u.agreed ? `v${u.agreed.version} · ${day(u.agreed.at)}` : 'Not yet'}</td><td>${u.newsEmails ? 'Yes' : 'No'}</td>${ABOUT_QUESTIONS.map((x) => `<td>${escapeHtml(answerLabel(x.id, u.answers[x.id]))}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <div class="adm-foot">${list.length} of ${d.users.length} users</div>`;
}

/** The whole page from the server's figures. Exported for the tests. */
export function adminHtml(d) {
  const t = d.totals;
  return `<div class="adm-kpis">${kpisHtml(d)}</div>
    <div class="card adm-chart" id="admChart">${chartHtml(d)}</div>
    <p class="adm-total">${t.users} users in total · ${t.profiles} answered the investor profile · ${t.agreed ?? 0} agreed to the terms</p>
    <div class="adm-section">Who they are</div>
    <div class="adm-pies">${piesHtml(d)}</div>
    <div class="adm-section">What users see <span class="adm-hint">— exactly as they see it; nothing is saved</span></div>
    <div class="adm-pvs-grid">${previewsHtml()}</div>
    <details class="adm-users"${filter ? ' open' : ''}>
      <summary class="adm-section">All users (${d.users.length})</summary>
      <div class="adm-userhead">
        <input type="text" class="adm-search" id="admSearch" placeholder="Search email or answer" autocomplete="off" spellcheck="false" value="${escapeHtml(filter)}" aria-label="Search users">
        <button type="button" class="btn adm-csv" data-adm-csv>↓ Export CSV</button>
      </div>
      <div id="admUsers">${usersHtml(d)}</div>
    </details>
    <p class="adm-note">Updated ${new Date(d.generatedAt).toLocaleString('en-GB')}. Use is counted from 4 November 2026. Portfolios are encrypted and never read.</p>`;
}

/** Every user and their answers as a CSV, for a spreadsheet. Exported for the tests. */
export function usersCsv(d) {
  const head = ['email', 'joined', 'last_active', 'days_active', 'terms_version', 'terms_accepted', 'news_emails', ...ABOUT_QUESTIONS.map((q) => q.id)];
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = d.users.map((u) => [u.email, String(u.joined ?? '').slice(0, 10), u.lastActive ?? '', u.daysActive,
    u.agreed?.version ?? '', String(u.agreed?.at ?? '').slice(0, 10), u.newsEmails ? 'yes' : 'no',
    ...ABOUT_QUESTIONS.map((q) => (q.country ? (u.answers[q.id] ?? '') : answerLabel(q.id, u.answers[q.id])))]);
  return [head, ...rows].map((r) => r.map(cell).join(',')).join('\n');
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ── Previews ── */

/** The bar across the top while a preview is open: what it is, and the way out. */
function ribbon() {
  let bar = el('admRibbon');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'admRibbon';
    bar.className = 'adm-ribbon';
    bar.hidden = true;
    bar.innerHTML = '<span><b>Preview</b> — exactly what users see. Nothing is saved.</span><button type="button" data-adm-close>Close preview</button>';
    bar.addEventListener('click', (e) => { if (e.target.closest('[data-adm-close]')) closePreview(); });
    document.body.append(bar);
  }
  return bar;
}

/** One overlay for the screens that are only HTML: sign-up, Terms acceptance, guest welcome. */
function overlay() {
  let box = el('admPreview');
  if (!box) {
    box = document.createElement('div');
    box.id = 'admPreview';
    box.className = 'tour about adm-preview';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Preview');
    box.hidden = true;
    box.addEventListener('change', (e) => {
      // Ticking the agreement turns on Accept, as it does for users.
      if (e.target.id === 'legalAgree') box.querySelector('[data-legal-accept]').disabled = !e.target.checked;
    });
    box.addEventListener('click', (e) => {
      // The screen's own buttons end the preview; links open, boxes tick, fields take typing.
      if (e.target.closest('a, input, label')) return;
      if (e.target.closest('button')) { e.preventDefault(); closePreview(); }
    });
    box.addEventListener('submit', (e) => e.preventDefault());
    document.body.append(box);
  }
  return box;
}

let watching = null;
/** The ribbon goes when the previewed window closes by its own buttons. */
function watch(target) {
  watching?.disconnect();
  if (!target) return;
  watching = new MutationObserver(() => { if (target.hidden) { ribbon().hidden = true; document.body.classList.remove('adm-previewing'); watching.disconnect(); watching = null; } });
  watching.observe(target, { attributes: true, attributeFilter: ['hidden'] });
}

function closePreview() {
  watching?.disconnect();
  watching = null;
  ribbon().hidden = true;
  document.body.classList.remove('adm-previewing');
  const box = el('admPreview');
  if (box && !box.hidden) { box.hidden = true; box.innerHTML = ''; }
  if (el('tour') && !el('tour').hidden) closeTour();
  const about = el('aboutYou');
  if (about && !about.hidden) about.querySelector('[data-about-skipall]')?.click();
  document.body.classList.remove('tour-open');
}

/** Exported for the tests. */
export function openPreview(key) {
  if (key === 'terms' || key === 'privacy') { window.open(key === 'terms' ? TERMS_URL : PRIVACY_URL, '_blank', 'noopener'); return; }
  closePreview();
  ribbon().hidden = false;
  document.body.classList.add('adm-previewing');
  if (key === 'profile') { openAboutYou({ preview: true }); watch(el('aboutYou')); return; }
  if (key === 'tour') { openTour(); watch(el('tour')); return; }
  const box = overlay();
  box.innerHTML = key === 'signup'
    ? `<div class="lock-card adm-pv-lock">${createForm()}</div>`
    : `<div class="tour-card about-card guest-card">${key === 'legal' ? legalGateHtml() : guestNoticeHtml()}</div>`;
  // A new user's form starts empty, whoever is signed in here.
  for (const input of box.querySelectorAll('input:not([type="checkbox"])')) input.value = '';
  box.hidden = false;
  document.body.classList.add('tour-open');
  watch(box);
}

function bind(page) {
  if (page.dataset.bound === '1') return;
  page.dataset.bound = '1';
  page.addEventListener('input', (e) => {
    if (e.target.id !== 'admSearch' || !data) return;
    filter = e.target.value;
    el('admUsers').innerHTML = usersHtml(data);
  });
  page.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-adm-series]');
    if (pick && data) {
      series = pick.dataset.admSeries;
      for (const b of page.querySelectorAll('[data-adm-series]')) {
        const on = b === pick;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      }
      el('admChart').innerHTML = chartHtml(data);
      return;
    }
    const preview = e.target.closest('[data-adm-preview]');
    if (preview) { openPreview(preview.dataset.admPreview); return; }
    if (e.target.closest('[data-adm-csv]') && data) download(`riskbook-users-${new Date().toISOString().slice(0, 10)}.csv`, usersCsv(data));
    if (e.target.closest('[data-adm-refresh]')) renderAdmin();
  });
}

/** Drawn each time the page comes on screen: the figures are fetched fresh. */
export async function renderAdmin() {
  const page = el('admin');
  const body = el('adminBody');
  if (!page || !body) return;
  bind(page);
  if (!data) body.innerHTML = '<p class="adm-empty">Loading…</p>';
  try {
    data = await social.adminStats();
    body.innerHTML = adminHtml(data);
  } catch (err) {
    body.innerHTML = `<p class="adm-empty">${escapeHtml(err.message)}</p>`;
  }
}

/** The button shows only for the account the server names as admin. */
onJournalLoaded(async () => {
  const button = el('adminBtn');
  if (!button) return;
  button.hidden = true;
  if (!cloudEnabled() || !isUnlocked() || isGuest()) return;
  try {
    button.hidden = !(await social.role()).admin;
  } catch {
    button.hidden = true;
  }
});
