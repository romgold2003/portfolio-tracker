/**
 * The Admin page's server side (November 2026): who uses Riskbook, how, and
 * how often — for Romy alone.
 *
 * Who is admin is a deployment setting, ADMIN_EMAILS (comma-separated), never
 * the code: the repository is public, and an address written here would also
 * be the key. Every admin read checks it on the server; the browser is only
 * told yes or no.
 *
 * Use is counted, not watched: one row per account per day, with how many
 * times the app was opened and which pages were opened how often, and which
 * broker a file was imported from. Nothing about anyone's portfolio — that
 * stays encrypted and unreadable here, as everywhere.
 *
 * The table is made on first use, as the Friends tables are.
 */
import { query, one, driverGeneration } from './db.js';
import { normalizeEmail } from './accounts.js';
import { ABOUT_CHOICES, MULTI } from './about.js';

/** Pages that are counted; anything else sent is ignored. */
export const TRACKED_PAGES = ['home', 'positions', 'add', 'monthly', 'news', 'crypto', 'friends', 'settings', 'import', 'tutorial'];
/** Brokers an import can be counted against: ids from src/config/brokers.js. */
const BROKER_ID = /^[a-z0-9-]{1,30}$/;

const TABLES = [
  `CREATE TABLE IF NOT EXISTS activity_days (
     user_id  TEXT NOT NULL,
     day      TEXT NOT NULL,
     opens    INTEGER NOT NULL DEFAULT 0,
     pages    TEXT NOT NULL DEFAULT '{}',
     imports  TEXT NOT NULL DEFAULT '{}',
     first_at TEXT NOT NULL,
     last_at  TEXT NOT NULL,
     PRIMARY KEY (user_id, day)
   )`,
  'CREATE INDEX IF NOT EXISTS activity_days_day ON activity_days (day)',
];

let readyFor = null;
async function ensureTables() {
  if (readyFor === driverGeneration()) return;
  for (const statement of TABLES) await query(statement, []);
  readyFor = driverGeneration();
}

/** Whether this signed-in account is one ADMIN_EMAILS names. */
export function isAdmin(user) {
  const list = String(process.env.ADMIN_EMAILS ?? '').split(',').map((e) => normalizeEmail(e)).filter(Boolean);
  return Boolean(user?.email) && list.includes(normalizeEmail(user.email));
}

const today = (at = new Date()) => at.toISOString().slice(0, 10);
const parse = (text) => { try { const v = JSON.parse(text); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };

/** Counts only: whole numbers, capped, for known pages and plausible broker ids. */
function cleanCounts(given, allowed) {
  const out = {};
  for (const [key, n] of Object.entries(given ?? {})) {
    if (!allowed(key)) continue;
    const v = Math.floor(Number(n));
    if (v > 0) out[key] = Math.min(v, 500);
  }
  return out;
}

/**
 * Add a batch of use to today's row: `{ open: true, pages: {home: 3}, imports: {ibkr: 1} }`.
 * Sent by the app now and then, not on every click, so the database is woken rarely.
 */
export async function recordActivity(user, body) {
  await ensureTables();
  const pages = cleanCounts(body?.pages, (k) => TRACKED_PAGES.includes(k));
  const imports = cleanCounts(body?.imports, (k) => BROKER_ID.test(k));
  const opens = body?.open === true ? 1 : 0;
  if (!opens && !Object.keys(pages).length && !Object.keys(imports).length) return { recorded: false };

  const day = today();
  const at = new Date().toISOString();
  const row = await one('SELECT opens, pages, imports FROM activity_days WHERE user_id = $1 AND day = $2', [user.id, day]);
  const add = (base, more) => {
    const sum = { ...base };
    for (const [k, v] of Object.entries(more)) sum[k] = Math.min((Number(sum[k]) || 0) + v, 100000);
    return JSON.stringify(sum);
  };
  if (row) {
    await query('UPDATE activity_days SET opens = $1, pages = $2, imports = $3, last_at = $4 WHERE user_id = $5 AND day = $6',
      [Number(row.opens) + opens, add(parse(row.pages), pages), add(parse(row.imports), imports), at, user.id, day]);
  } else {
    await query('INSERT INTO activity_days (user_id, day, opens, pages, imports, first_at, last_at) VALUES ($1, $2, $3, $4, $5, $6, $6)',
      [user.id, day, opens, JSON.stringify(pages), JSON.stringify(imports), at]);
  }
  return { recorded: true };
}

/** With the account. */
export async function forgetActivity(userId) {
  await ensureTables();
  await query('DELETE FROM activity_days WHERE user_id = $1', [userId]);
}

const DAY_MS = 86400000;
const dayPlus = (day, n) => today(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS));

/** A table that may not exist yet reads as empty. */
async function rowsOf(sql, params = []) {
  try {
    return (await query(sql, params)).rows ?? [];
  } catch {
    return [];
  }
}

/**
 * Everything the Admin page shows, worked out here so the browser gets
 * numbers and a list, not the raw tables. `now` is for the tests.
 */
export async function adminStats({ now = new Date() } = {}) {
  await ensureTables();
  const { ensureAboutTable } = await import('./about.js');
  await ensureAboutTable();
  const todayIs = today(now);
  const since = dayPlus(todayIs, -119);

  const users = await rowsOf('SELECT id, email, created_at FROM users ORDER BY created_at DESC');
  const about = await rowsOf('SELECT * FROM about_you');
  const activity = await rowsOf('SELECT user_id, day, opens, pages, imports FROM activity_days WHERE day >= $1', [since]);
  const lastSeen = await rowsOf('SELECT user_id, MAX(day) AS day, COUNT(*) AS days FROM activity_days GROUP BY user_id');
  const vaults = await rowsOf('SELECT user_id, updated_at FROM vaults');
  const count = async (sql) => Number((await rowsOf(sql))[0]?.n ?? 0);

  const answersOf = new Map(about.map((a) => [a.user_id, a]));
  const seenOf = new Map(lastSeen.map((r) => [r.user_id, r]));
  const savedOf = new Map(vaults.map((v) => [v.user_id, v.updated_at]));
  const daysOf = new Map();
  for (const r of activity) {
    if (!daysOf.has(r.user_id)) daysOf.set(r.user_id, new Set());
    daysOf.get(r.user_id).add(r.day);
  }

  // Active: a day with a row; the vault's last save counts too, for use before tracking began.
  const lastActive = (id) => {
    const tracked = seenOf.get(id)?.day ?? null;
    const saved = savedOf.get(id)?.slice(0, 10) ?? null;
    return [tracked, saved].filter(Boolean).sort().pop() ?? null;
  };
  const activeWithin = (n) => users.filter((u) => {
    const d = lastActive(u.id);
    return d && d >= dayPlus(todayIs, -(n - 1));
  }).length;

  // The last 60 days: sign-ups and active accounts per day.
  const days = [];
  for (let i = 59; i >= 0; i--) {
    const day = dayPlus(todayIs, -i);
    days.push({
      day,
      signups: users.filter((u) => String(u.created_at).slice(0, 10) === day).length,
      active: activity.filter((r) => r.day === day).length,
    });
  }

  // Came back: of those who signed up at least n days ago, the share active on or after day n.
  const retention = Object.fromEntries([1, 7, 30].map((n) => {
    const cohort = users.filter((u) => dayPlus(String(u.created_at).slice(0, 10), n) <= todayIs);
    const back = cohort.filter((u) => [...(daysOf.get(u.id) ?? [])].some((d) => d >= dayPlus(String(u.created_at).slice(0, 10), n)));
    return [`d${n}`, { cohort: cohort.length, back: back.length }];
  }));

  // Each question's answers counted; an answer with several parts counts each part.
  const questions = {};
  for (const [field, allowed] of Object.entries({ ...ABOUT_CHOICES, country: null })) {
    const tally = {};
    for (const a of about) {
      const v = a[field];
      if (!v) continue;
      for (const part of (MULTI.has(field) ? String(v).split(',') : [String(v)])) {
        if (allowed && !allowed.includes(part)) continue;
        tally[part] = (tally[part] ?? 0) + 1;
      }
    }
    questions[field] = tally;
  }

  const pages = {};
  const imports = {};
  for (const r of activity) {
    for (const [k, v] of Object.entries(parse(r.pages))) pages[k] = (pages[k] ?? 0) + Number(v);
    for (const [k, v] of Object.entries(parse(r.imports))) imports[k] = (imports[k] ?? 0) + Number(v);
  }

  return {
    generatedAt: now.toISOString(),
    totals: {
      users: users.length,
      newToday: users.filter((u) => String(u.created_at).slice(0, 10) === todayIs).length,
      newWeek: users.filter((u) => String(u.created_at).slice(0, 10) >= dayPlus(todayIs, -6)).length,
      dau: activeWithin(1),
      wau: activeWithin(7),
      mau: activeWithin(30),
      profiles: about.filter((a) => ['sex', 'age', 'goal', 'experience', 'style', 'country', 'heard', 'occupation'].some((f) => a[f])).length,
    },
    days,
    retention,
    questions,
    pages,
    imports,
    social: {
      friendships: await count('SELECT COUNT(*) AS n FROM friendships'),
      requests: await count('SELECT COUNT(*) AS n FROM friend_requests'),
      groups: await count('SELECT COUNT(*) AS n FROM chats'),
      messages: await count('SELECT COUNT(*) AS n FROM messages'),
      sharing: await count('SELECT COUNT(*) AS n FROM shares'),
    },
    users: users.map((u) => {
      const a = answersOf.get(u.id) ?? {};
      return {
        email: u.email,
        joined: u.created_at,
        lastActive: lastActive(u.id),
        daysActive: Number(seenOf.get(u.id)?.days ?? 0),
        answers: Object.fromEntries(['sex', 'age', 'goal', 'experience', 'style', 'country', 'heard', 'occupation'].map((f) => [f, a[f] ?? null])),
      };
    }),
  };
}
