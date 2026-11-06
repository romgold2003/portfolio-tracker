/**
 * The Admin page (November 2026): Romy alone sees how many people use
 * Riskbook, who they are and what they use. Who is admin is a deployment
 * setting (ADMIN_EMAILS), checked on the server. Against SQLite in memory.
 */
import { test, beforeEach, afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { useDriver, query } from '../api/_lib/db.js';
import { sqliteDriver } from './support/sqlite.mjs';
import { makeClient } from './support/http.mjs';
import signup from '../api/_auth/signup.js';
import deleteAccount from '../api/account.js';
import social from '../api/social/[action].js';
import { isAdmin, adminStats } from '../api/_lib/admin.js';
import {
  generateDataKey, wrapDataKey, encryptJson, generateRecoveryKey, normalizeRecoveryKey,
  generateAuthSalt, deriveAuthSecret,
} from '../src/core/crypto.js';

process.env.NODE_ENV = 'test';
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

let ip = 90;
async function person(email, password = 'correct horse battery') {
  const client = makeClient({ 'x-forwarded-for': `10.0.3.${ip++}` });
  const dataKey = generateDataKey();
  const recoveryKey = generateRecoveryKey();
  const authSalt = generateAuthSalt();
  const recoverySalt = generateAuthSalt();
  const res = await client.call(signup, {
    method: 'POST',
    body: {
      email, authSalt, recoverySalt,
      authSecret: await deriveAuthSecret(password, authSalt),
      recoverySecret: await deriveAuthSecret(normalizeRecoveryKey(recoveryKey), recoverySalt),
      passwordWrapper: await wrapDataKey(dataKey, password),
      recoveryWrapper: await wrapDataKey(dataKey, normalizeRecoveryKey(recoveryKey)),
      vault: await encryptJson({ positions: [], cash: 0 }, dataKey),
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const call = (action, body) => client.call(social, { method: body === undefined ? 'GET' : 'POST', body, url: `/api/social/${action}` });
  return { id: res.body.user.id, email, client, call, authSalt, password };
}

beforeEach(() => { useDriver(sqliteDriver()); process.env.ADMIN_EMAILS = 'boss@example.com'; });
afterEach(() => { delete process.env.ADMIN_EMAILS; });

describe('who is admin', () => {
  test('only the address the deployment names, whatever its case; nobody when none is set', () => {
    assert.equal(isAdmin({ email: 'boss@example.com' }), true);
    assert.equal(isAdmin({ email: 'Boss@Example.com' }), true);
    assert.equal(isAdmin({ email: 'dan@example.com' }), false);
    delete process.env.ADMIN_EMAILS;
    assert.equal(isAdmin({ email: 'boss@example.com' }), false);
  });

  test('the figures are refused to anyone else, on the server', async () => {
    const dan = await person('dan@example.com');
    assert.deepEqual((await dan.call('role')).body, { admin: false });
    const res = await dan.call('admin');
    assert.equal(res.status, 403);
    assert.ok(!JSON.stringify(res.body).includes('dan@example.com'));
    const boss = await person('boss@example.com');
    assert.deepEqual((await boss.call('role')).body, { admin: true });
    assert.equal((await boss.call('admin')).status, 200);
  });

  test('the address is not in the code: a deployment setting', () => {
    assert.match(read('api/_lib/admin.js'), /process\.env\.ADMIN_EMAILS/);
    assert.doesNotMatch(read('api/_lib/admin.js') + read('src/ui/views/admin.js'), /@gmail\.com/);
  });
});

describe('what it counts', () => {
  test('users, answers, use and imports, worked out on the server', async () => {
    const boss = await person('boss@example.com');
    const dan = await person('dan@example.com');
    const noa = await person('noa@example.com');
    await dan.call('about', { sex: 'male', age: '25-34', goal: ['wealth', 'learn'], country: 'IL', heard: ['friend'] });
    await noa.call('about', { sex: 'female', age: '18-24', goal: ['learn'], country: 'US' });
    assert.equal((await dan.call('ping', { open: true, pages: { home: 3, news: 1, hacked: 9 }, imports: { ibkr: 1 } })).status, 200);
    await noa.call('ping', { open: true, pages: { positions: 2 } });
    await noa.call('ping', { pages: { positions: 1 } });

    const d = (await boss.call('admin')).body;
    assert.equal(d.totals.users, 3);
    assert.equal(d.totals.newToday, 3);
    // All three saved a journal today (at sign-up), which counts as active as much as a counted visit.
    assert.equal(d.totals.dau, 3);
    assert.equal(d.totals.profiles, 2);
    assert.deepEqual(d.questions.goal, { wealth: 1, learn: 2 }, 'several answers count once each');
    assert.deepEqual(d.questions.country, { IL: 1, US: 1 });
    assert.deepEqual(d.pages, { home: 3, news: 1, positions: 3 }, 'unknown pages are not counted');
    assert.deepEqual(d.imports, { ibkr: 1 });
    assert.equal(d.days.length, 60);
    assert.equal(d.days.at(-1).signups, 3);
    assert.equal(d.days.at(-1).active, 2);
    const danRow = d.users.find((u) => u.email === 'dan@example.com');
    assert.equal(danRow.answers.goal, 'wealth,learn');
    assert.equal(danRow.daysActive, 1);
    assert.ok(!JSON.stringify(d).includes('vault'), 'no journal is read');
    // One row per account per day, however many batches.
    const { rows } = await query('SELECT * FROM activity_days WHERE user_id = $1', [noa.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].opens, 1);
  });

  test('coming back: of those who joined at least a week ago, the share seen since', async () => {
    const a = await person('a@example.com');
    const b = await person('b@example.com');
    const old = new Date(Date.now() - 10 * 86400000).toISOString();
    await query('UPDATE users SET created_at = $1', [old]);
    await a.call('ping', { open: true });
    const d = await adminStats();
    assert.deepEqual(d.retention.d7, { cohort: 2, back: 1 });
    assert.deepEqual(d.retention.d30, { cohort: 0, back: 0 });
    assert.ok(b);
  });

  test('deleting an account deletes its counts too', async () => {
    const dan = await person('dan@example.com');
    await dan.call('ping', { open: true, pages: { home: 1 } });
    const res = await dan.client.call(deleteAccount, { method: 'POST', body: { authSecret: await deriveAuthSecret(dan.password, dan.authSalt) } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((await query('SELECT * FROM activity_days WHERE user_id = $1', [dan.id])).rows.length, 0);
  });
});

describe('the page', () => {
  test('the button starts hidden, and Admin is a page with no tab of its own', () => {
    assert.match(read('index.html'), /id="adminBtn" onclick="show\('admin'\)"[^>]*hidden/);
    assert.match(read('index.html'), /<div id="admin" class="page">/);
    assert.match(read('src/ui/router.js'), /'friends', 'admin'\]/);
    assert.match(read('src/ui/render.js'), /if \(page === 'admin'\) renderAdmin\(\);/);
  });

  test('the figures drawn, answers in words, and a CSV that survives commas', async () => {
    const { adminHtml, usersCsv, answerLabel } = await import('../src/ui/views/admin.js');
    const d = {
      generatedAt: new Date().toISOString(),
      totals: { users: 2, newToday: 1, newWeek: 2, dau: 1, wau: 2, mau: 2, profiles: 1 },
      days: Array.from({ length: 60 }, (_, i) => ({ day: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, signups: i % 3, active: i % 2 })),
      retention: { d1: { cohort: 2, back: 1 }, d7: { cohort: 0, back: 0 }, d30: { cohort: 0, back: 0 } },
      questions: { sex: { female: 1 }, goal: { wealth: 1, learn: 1 }, country: { IL: 1 } },
      pages: { home: 4 },
      imports: { ibkr: 1 },
      social: { friendships: 1, requests: 0, groups: 0, messages: 3, sharing: 1 },
      users: [{ email: 'noa@example.com', joined: '2026-11-04T10:00:00Z', lastActive: '2026-11-04', daysActive: 1, answers: { sex: 'female', goal: 'wealth,learn', country: 'IL' } }],
    };
    const html = adminHtml(d);
    for (const s of ['Online now', 'Today', 'This week', 'New today', 'Investment objectives', 'noa@example.com', 'Long-term growth of wealth']) assert.ok(html.includes(s), s);
    assert.equal(answerLabel('goal', 'wealth,learn'), 'Long-term growth of wealth, Learning to invest');
    const csv = usersCsv(d).split('\n');
    assert.equal(csv[0].split(',')[0], 'email');
    assert.match(csv[1], /"Long-term growth of wealth, Learning to invest"/);
    assert.match(csv[1], /,IL,/);
  });

  // Romy, November 2026: online now, today, this week, new today — each opening its history — and a pie per question.
  test('four numbers, each pressing open its history; a pie for every question', async () => {
    const { adminHtml, chartHtml } = await import('../src/ui/views/admin.js');
    const d = {
      generatedAt: new Date().toISOString(),
      totals: { users: 5, newToday: 2, dau: 3, wau: 4, online: 1, profiles: 3, agreed: 5 },
      days: Array.from({ length: 60 }, (_, i) => ({ day: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, signups: i === 59 ? 2 : 0, active: i % 4 })),
      hourly: Array.from({ length: 48 }, (_, i) => ({ hour: `2026-11-06T${String(i % 24).padStart(2, '0')}`, active: i === 47 ? 1 : 0 })),
      weeks: Array.from({ length: 12 }, (_, i) => ({ start: '2026-10-01', end: '2026-10-07', active: i })),
      questions: { sex: { female: 2, male: 1 }, age: { '25-34': 3 }, country: { IL: 2, US: 1 }, goal: { wealth: 2, learn: 1 } },
      users: [],
    };
    const html = adminHtml(d);
    for (const key of ['online', 'today', 'week', 'new']) assert.match(html, new RegExp(`data-adm-series="${key}"`));
    assert.match(html, /data-adm-series="today" aria-pressed="true"/, 'today is shown first');
    assert.equal((chartHtml(d, 'online').match(/class="adm-col"/g) ?? []).length, 48);
    assert.equal((chartHtml(d, 'week').match(/class="adm-col"/g) ?? []).length, 12);
    assert.equal((chartHtml(d, 'new').match(/class="adm-col"/g) ?? []).length, 60);
    assert.match(chartHtml(d, 'new'), /Now · 2/);
    // Eight pies: gender and age drawn, an unanswered one says so.
    assert.equal((html.match(/class="card adm-pie"/g) ?? []).length, 8);
    assert.match(html, /<path d="M64,64[^"]*" class="adm-slice s2"><title>Female: 2 \(67%\)/);
    assert.match(html, /<circle[^>]*class="adm-slice s2"><title>25–34: 3 \(100%\)/);
    assert.match(html, /Several answers per person/);
    assert.match(html, /No answers yet/);
  });

  test('what users see: the real screens, from the code that shows them to users', async () => {
    const { adminHtml, PREVIEWS } = await import('../src/ui/views/admin.js');
    assert.deepEqual(PREVIEWS.map(([k]) => k), ['signup', 'legal', 'profile', 'tour', 'guest', 'terms', 'privacy']);
    const view = read('src/ui/views/admin.js');
    for (const s of ['openAboutYou({ preview: true })', 'openTour()', 'legalGateHtml()', 'guestNoticeHtml()', 'createForm()', 'TERMS_URL', 'PRIVACY_URL']) assert.ok(view.includes(s), s);
    // The questionnaire's preview saves nothing and leads nowhere.
    assert.match(read('src/ui/views/aboutYou.js'), /if \(previewing \|\| !countAnswered\(answers\)\) \{ close\(\); return; \}/);
    assert.match(adminHtml({ generatedAt: new Date().toISOString(), totals: { users: 0, profiles: 0 }, days: [], questions: {}, users: [] }), /data-adm-preview="profile"/);
  });

  test('online now: seen in the last fifteen minutes, and the hour of each visit kept', async () => {
    const boss = await person('boss@example.com');
    const dan = await person('dan@example.com');
    await dan.call('ping', { open: true });
    const d = (await boss.call('admin')).body;
    assert.ok(d.totals.online >= 1);
    assert.equal(d.hourly.length, 48);
    assert.equal(d.hourly.at(-1).active, 1, 'this hour');
    assert.equal(d.weeks.length, 12);
    assert.equal(d.weeks.at(-1).active, 1);
    const { rows } = await query('SELECT hours FROM activity_days WHERE user_id = $1', [dan.id]);
    assert.deepEqual(JSON.parse(rows[0].hours), [new Date().getUTCHours()]);
    const later = await adminStats({ now: new Date(Date.now() + 20 * 60000) });
    assert.ok(later.totals.online <= d.totals.online - 1, 'gone after fifteen minutes');
  });

  test('use is counted in batches, never on every click', () => {
    const usage = read('src/services/usage.js');
    assert.match(usage, /EVERY_MS = 10 \* 60_000/);
    assert.match(read('src/ui/render.js'), /notePage\(page\);/);
    assert.match(read('src/app/actions.js'), /noteImport\(state\.broker\);/);
  });
});
