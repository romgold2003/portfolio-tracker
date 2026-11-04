/**
 * The Admin page (November 2026), for Romy alone: how many people use
 * Riskbook, who they are, how often they come back, and what they use.
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
import { ABOUT_QUESTIONS, countryName, flagOf } from '../../config/aboutYou.js';
import { brokerById } from '../../config/brokers.js';
import { escapeHtml } from '../format.js';

const el = (id) => document.getElementById(id);
let data = null;
let filter = '';

const PAGE_NAMES = {
  home: 'Home', positions: 'Positions', add: 'New trade', monthly: 'Monthly', news: 'News', crypto: 'Crypto',
  friends: 'Friends', settings: 'Settings', import: 'Import window', tutorial: 'Tutorial',
};

const pct = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : '—');
const day = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/** An answer's words, from its stored id(s). Exported for the tests. */
export function answerLabel(field, value) {
  if (!value) return '';
  if (field === 'country') return `${flagOf(value)} ${countryName(value)}`;
  if (field === 'name') return String(value);
  const q = ABOUT_QUESTIONS.find((x) => x.id === field);
  return String(value).split(',').map((id) => q?.options?.find(([o]) => o === id)?.[1] ?? id).join(', ');
}

const tile = (label, value, sub = '') => `<div class="adm-tile"><div class="adm-tl">${escapeHtml(label)}</div><div class="adm-tv">${escapeHtml(String(value))}</div>${sub ? `<div class="adm-ts">${escapeHtml(sub)}</div>` : ''}</div>`;

/** Horizontal bars, largest first: label, bar, count and share. */
function bars(entries, total) {
  const rows = entries.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '<p class="adm-empty">No answers yet.</p>';
  const max = rows[0][1];
  return `<div class="adm-bars">${rows.map(([label, n]) => `<div class="adm-bar"><span class="adm-bl">${escapeHtml(label)}</span><span class="adm-bt"><span style="width:${(n / max) * 100}%"></span></span><span class="adm-bn">${n}</span><span class="adm-bp">${pct(n, total)}</span></div>`).join('')}</div>`;
}

/** Sixty days as columns: sign-ups and active accounts. */
function columns(days, key, label) {
  const max = Math.max(1, ...days.map((d) => d[key]));
  return `<div class="adm-cols" role="img" aria-label="${escapeHtml(label)}, last 60 days">${days.map((d) => `<span class="adm-col" title="${escapeHtml(`${day(d.day)}: ${d[key]}`)}"><span style="height:${(d[key] / max) * 100}%"></span></span>`).join('')}</div>
    <div class="adm-axis"><span>${day(days[0].day)}</span><span>Today</span></div>`;
}

function questionsHtml(d) {
  const answered = d.totals.profiles;
  // A name is a person, not a statistic: it is in the list below, not a chart.
  return ABOUT_QUESTIONS.filter((q) => !q.name).map((q) => {
    const tally = d.questions[q.id] ?? {};
    const entries = q.country
      ? Object.entries(tally).map(([code, n]) => [`${flagOf(code)} ${countryName(code)}`, n])
      : q.options.map(([id, label]) => [label, tally[id] ?? 0]);
    return `<div class="card adm-q"><div class="card-lbl">${escapeHtml(q.title)}${q.multi ? ' · several answers' : ''}</div>${bars(entries, answered)}</div>`;
  }).join('');
}

function usersHtml(d) {
  const q = filter.trim().toLowerCase();
  const list = d.users.filter((u) => !q || u.email.toLowerCase().includes(q)
    || Object.entries(u.answers).some(([f, v]) => answerLabel(f, v).toLowerCase().includes(q)));
  const cols = ABOUT_QUESTIONS.map((x) => x.title);
  return `<div class="adm-tablewrap"><table class="adm-table">
      <thead><tr><th>Email</th><th>Joined</th><th>Last active</th><th>Days active</th>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
      <tbody>${list.map((u) => `<tr><td>${escapeHtml(u.email)}</td><td>${day(u.joined)}</td><td>${day(u.lastActive)}</td><td>${u.daysActive}</td>${ABOUT_QUESTIONS.map((x) => `<td>${escapeHtml(answerLabel(x.id, u.answers[x.id]))}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <div class="adm-foot">${list.length} of ${d.users.length} users</div>`;
}

/** The whole page from the server's figures. Exported for the tests. */
export function adminHtml(d) {
  const t = d.totals;
  const r = d.retention;
  const ret = (k) => (r[k].cohort ? `${pct(r[k].back, r[k].cohort)}` : '—');
  const brokerName = (id) => brokerById(id)?.name ?? (id === 'other' ? 'Another broker' : id);
  return `<div class="adm-kpis">
      ${tile('Users', t.users, `${t.newWeek} new this week · ${t.newToday} today`)}
      ${tile('Active today', t.dau, pct(t.dau, t.users) + ' of users')}
      ${tile('Active this week', t.wau, pct(t.wau, t.users) + ' of users')}
      ${tile('Active this month', t.mau, pct(t.mau, t.users) + ' of users')}
      ${tile('Profiles answered', t.profiles, pct(t.profiles, t.users) + ' of users')}
      ${tile('Came back after 1 / 7 / 30 days', `${ret('d1')} · ${ret('d7')} · ${ret('d30')}`, 'retention')}
    </div>
    <div class="adm-two">
      <div class="card"><div class="card-lbl">New users per day</div>${columns(d.days, 'signups', 'New users per day')}</div>
      <div class="card"><div class="card-lbl">Active users per day</div>${columns(d.days, 'active', 'Active users per day')}</div>
    </div>
    <div class="adm-section">Who they are</div>
    <div class="adm-qs">${questionsHtml(d)}</div>
    <div class="adm-section">What they use</div>
    <div class="adm-two">
      <div class="card"><div class="card-lbl">Pages opened · last 120 days</div>${bars(Object.entries(d.pages).map(([k, n]) => [PAGE_NAMES[k] ?? k, n]), Object.values(d.pages).reduce((a, b) => a + b, 0))}</div>
      <div class="card"><div class="card-lbl">Imports by broker · last 120 days</div>${bars(Object.entries(d.imports).map(([k, n]) => [brokerName(k), n]), Object.values(d.imports).reduce((a, b) => a + b, 0))}</div>
    </div>
    <div class="adm-kpis adm-kpis-sm">
      ${tile('Friendships', d.social.friendships)}
      ${tile('Friend requests waiting', d.social.requests)}
      ${tile('Groups', d.social.groups)}
      ${tile('Messages sent', d.social.messages)}
      ${tile('Sharing with friends', d.social.sharing)}
    </div>
    <div class="adm-section adm-userhead">Users
      <input type="text" class="adm-search" id="admSearch" placeholder="Search email or answer" autocomplete="off" spellcheck="false" value="${escapeHtml(filter)}" aria-label="Search users">
      <button type="button" class="btn adm-csv" data-adm-csv>↓ Export CSV</button>
    </div>
    <div id="admUsers">${usersHtml(d)}</div>
    <p class="adm-note">Updated ${new Date(d.generatedAt).toLocaleString('en-GB')}. Use is counted from 4 November 2026; before that, the last time a journal was saved counts as last active. Portfolios are encrypted and never read.</p>`;
}

/** Every user and their answers as a CSV, for a spreadsheet. Exported for the tests. */
export function usersCsv(d) {
  const head = ['email', 'joined', 'last_active', 'days_active', ...ABOUT_QUESTIONS.map((q) => q.id)];
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = d.users.map((u) => [u.email, String(u.joined ?? '').slice(0, 10), u.lastActive ?? '', u.daysActive,
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

function bind(page) {
  if (page.dataset.bound === '1') return;
  page.dataset.bound = '1';
  page.addEventListener('input', (e) => {
    if (e.target.id !== 'admSearch' || !data) return;
    filter = e.target.value;
    el('admUsers').innerHTML = usersHtml(data);
  });
  page.addEventListener('click', (e) => {
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
