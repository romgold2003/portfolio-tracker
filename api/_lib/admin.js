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
  // The hours of the day (UTC) a batch arrived in, for "online" over time; added November 2026.
  await query("ALTER TABLE activity_days ADD COLUMN hours TEXT NOT NULL DEFAULT '[]'", []).catch(() => {});
  readyFor = driverGeneration();
}

/** Whether this signed-in account is one ADMIN_EMAILS names. */
export function isAdmin(user) {
  const list = String(process.env.ADMIN_EMAILS ?? '').split(',').map((e) => normalizeEmail(e)).filter(Boolean);
  return Boolean(user?.email) && list.includes(normalizeEmail(user.email));
}

const today = (at = new Date()) => at.toISOString().slice(0, 10);
/** The hours a row was active in: whole numbers 0 to 23. */
const hoursOf = (text) => { try { const v = JSON.parse(text); return Array.isArray(v) ? v.filter((h) => Number.isInteger(h) && h >= 0 && h < 24) : []; } catch { return []; } };
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
  const hour = new Date(at).getUTCHours();
  const row = await one('SELECT opens, pages, imports, hours FROM activity_days WHERE user_id = $1 AND day = $2', [user.id, day]);
  const add = (base, more) => {
    const sum = { ...base };
    for (const [k, v] of Object.entries(more)) sum[k] = Math.min((Number(sum[k]) || 0) + v, 100000);
    return JSON.stringify(sum);
  };
  if (row) {
    const hours = [...new Set([...hoursOf(row.hours), hour])].sort((a, b) => a - b);
    await query('UPDATE activity_days SET opens = $1, pages = $2, imports = $3, last_at = $4, hours = $5 WHERE user_id = $6 AND day = $7',
      [Number(row.opens) + opens, add(parse(row.pages), pages), add(parse(row.imports), imports), at, JSON.stringify(hours), user.id, day]);
  } else {
    await query('INSERT INTO activity_days (user_id, day, opens, pages, imports, first_at, last_at, hours) VALUES ($1, $2, $3, $4, $5, $6, $6, $7)',
      [user.id, day, opens, JSON.stringify(pages), JSON.stringify(imports), at, JSON.stringify([hour])]);
  }
  return { recorded: true };
}

/** With the account. */
export async function forgetActivity(userId) {
  await ensureTables();
  await query('DELETE FROM activity_days WHERE user_id = $1', [userId]);
}

const DAY_MS = 86400000;
/** "Online now": seen in the last fifteen minutes. */
export const ONLINE_MS = 15 * 60000;
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
  const activity = await rowsOf('SELECT user_id, day, opens, pages, imports, hours, first_at, last_at FROM activity_days WHERE day >= $1', [since]);
  const lastSeen = await rowsOf('SELECT user_id, MAX(day) AS day, COUNT(*) AS days FROM activity_days GROUP BY user_id');
  const vaults = await rowsOf('SELECT user_id, updated_at FROM vaults');
  const { ensureConsentTable } = await import('./consent.js');
  await ensureConsentTable();
  const consents = new Map((await rowsOf('SELECT user_id, version, accepted_at, marketing FROM consents')).map((c) => [c.user_id, c]));
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

  // Online now: a batch or a journal save in the last 15 minutes (the app sends at most every 10).
  const onlineSince = new Date(now.getTime() - ONLINE_MS).toISOString();
  const online = new Set([
    ...activity.filter((r) => String(r.last_at) >= onlineSince).map((r) => r.user_id),
    ...vaults.filter((v) => String(v.updated_at) >= onlineSince).map((v) => v.user_id),
  ]).size;

  // The last 48 hours: accounts active in each hour. Rows from before hours were kept count their first and last.
  const hourly = [];
  const thisHour = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours());
  const byDay = new Map();
  for (const r of activity) {
    const hs = new Set(hoursOf(r.hours));
    for (const t of [r.first_at, r.last_at]) if (t) hs.add(new Date(t).getUTCHours());
    if (!byDay.has(r.day)) byDay.set(r.day, []);
    byDay.get(r.day).push(hs);
  }
  for (let i = 47; i >= 0; i--) {
    const at = new Date(thisHour - i * 3600000);
    const rows = byDay.get(today(at)) ?? [];
    hourly.push({ hour: at.toISOString().slice(0, 13), active: rows.filter((hs) => hs.has(at.getUTCHours())).length });
  }

  // The last 12 weeks: accounts active at least once in each seven days, the latest ending today.
  const weeks = [];
  for (let i = 11; i >= 0; i--) {
    const end = dayPlus(todayIs, -7 * i);
    const start = dayPlus(end, -6);
    weeks.push({ start, end, active: new Set(activity.filter((r) => r.day >= start && r.day <= end).map((r) => r.user_id)).size });
  }

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
      online,
      newWeek: users.filter((u) => String(u.created_at).slice(0, 10) >= dayPlus(todayIs, -6)).length,
      dau: activeWithin(1),
      wau: activeWithin(7),
      mau: activeWithin(30),
      agreed: users.filter((u) => consents.has(u.id)).length,
      newsEmails: users.filter((u) => Number(consents.get(u.id)?.marketing) === 1).length,
      profiles: about.filter((a) => ['first_name', 'last_name', 'sex', 'age', 'goal', 'experience', 'style', 'country', 'heard', 'occupation'].some((f) => a[f])).length,
    },
    days,
    hourly,
    weeks,
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
        // Which Terms/Privacy version they accepted and when, and the news-email choice.
        agreed: consents.has(u.id) ? { version: Number(consents.get(u.id).version), at: consents.get(u.id).accepted_at } : null,
        newsEmails: Number(consents.get(u.id)?.marketing) === 1,
        daysActive: Number(seenOf.get(u.id)?.days ?? 0),
        answers: {
          name: [a.first_name, a.last_name].filter(Boolean).join(' ') || null,
          ...Object.fromEntries(['sex', 'age', 'goal', 'experience', 'style', 'country', 'heard', 'occupation'].map((f) => [f, a[f] ?? null])),
        },
      };
    }),
  };
}
