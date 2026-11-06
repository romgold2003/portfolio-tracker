/**
 * "About you" — the questions asked once after sign-up (November 2026), so
 * Romy can see who uses Riskbook: sex, age, goal, experience, style, country,
 * how they heard of it, and what they do.
 *
 * Kept in a table of its own, apart from the vault: the journal is encrypted
 * and this server cannot read it, while these answers are meant to be read —
 * by Romy, and later by whatever tool she connects. Every answer is optional,
 * and only the listed choices are accepted, so nothing typed freely is stored.
 * Deleting the account deletes the row (accounts.js, deleteUser).
 *
 * The table is made on first use, as the Friends tables are.
 */
import { query, driverGeneration } from './db.js';

/** The accepted answers; the same ids as src/config/aboutYou.js (the tests keep them in step). */
export const ABOUT_CHOICES = {
  sex: ['male', 'female', 'other', 'na'],
  // Riskbook is 18+ (Terms, section 2), so there is no "Under 18".
  age: ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'],
  goal: ['wealth', 'trading', 'retire', 'learn', 'track'],
  experience: ['lt1', '1-3', '3-10', '10+'],
  style: ['long', 'swing', 'day'],
  heard: ['friend', 'instagram', 'tiktok', 'youtube', 'google', 'university', 'other'],
  occupation: ['student', 'employed', 'self', 'retired', 'other'],
};
/** Questions that take several answers, stored as their ids joined by commas in the list's order. */
export const MULTI = new Set(['goal', 'style', 'heard', 'occupation']);
/** The two answers typed rather than chosen: the name, as the person wants to be addressed. */
export const NAME_FIELDS = ['first_name', 'last_name'];
const FIELDS = [...Object.keys(ABOUT_CHOICES), 'country', ...NAME_FIELDS];

const TABLE = `CREATE TABLE IF NOT EXISTS about_you (
   user_id    TEXT PRIMARY KEY,
   sex        TEXT,
   age        TEXT,
   goal       TEXT,
   experience TEXT,
   style      TEXT,
   country    TEXT,
   heard      TEXT,
   occupation TEXT,
   first_name TEXT,
   last_name  TEXT,
   created_at TEXT NOT NULL,
   updated_at TEXT NOT NULL
 )`;

let readyFor = null;
async function ensureTable() {
  if (readyFor === driverGeneration()) return;
  await query(TABLE, []);
  // A table made before the name was asked gets its two columns; one that has them refuses, which is fine.
  for (const column of NAME_FIELDS) await query(`ALTER TABLE about_you ADD COLUMN ${column} TEXT`, []).catch(() => {});
  readyFor = driverGeneration();
}
/** For the Admin page, which reads the table before anyone may have answered. */
export const ensureAboutTable = ensureTable;

/**
 * Only the listed choices, and a two-letter country code; anything else is
 * left empty. A question with several answers takes a list (or one answer),
 * keeps the listed ones, each once, and is stored as "wealth,learn".
 */
export function cleanAnswers(body) {
  const out = {};
  for (const [field, allowed] of Object.entries(ABOUT_CHOICES)) {
    const v = body?.[field];
    if (MULTI.has(field)) {
      const given = new Set((Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string'));
      const kept = allowed.filter((id) => given.has(id));
      out[field] = kept.length ? kept.join(',') : null;
    } else {
      out[field] = typeof v === 'string' && allowed.includes(v) ? v : null;
    }
  }
  const country = typeof body?.country === 'string' ? body.country.toUpperCase() : '';
  out.country = /^[A-Z]{2}$/.test(country) ? country : null;
  out.first_name = cleanName(body?.firstName);
  out.last_name = cleanName(body?.lastName);
  return out;
}

/**
 * A name as typed: letters in any alphabet (Hebrew included), spaces, hyphens,
 * apostrophes and dots, at most 50 characters; anything else is taken out.
 */
export function cleanName(value) {
  if (typeof value !== 'string') return null;
  const name = value.normalize('NFC').replace(/[^\p{L}\p{M}\s'’.-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 50).trim();
  return name || null;
}

/** Save this user's answers, replacing any earlier ones. */
export async function saveAbout(user, body) {
  await ensureTable();
  const a = cleanAnswers(body);
  const at = new Date().toISOString();
  const values = FIELDS.map((f) => a[f]);
  await query(
    `INSERT INTO about_you (user_id, ${FIELDS.join(', ')}, created_at, updated_at)
     VALUES ($1, ${FIELDS.map((_, i) => `$${i + 2}`).join(', ')}, $${FIELDS.length + 2}, $${FIELDS.length + 2})
     ON CONFLICT (user_id) DO UPDATE SET ${FIELDS.map((f) => `${f} = excluded.${f}`).join(', ')}, updated_at = excluded.updated_at`,
    [user.id, ...values, at],
  );
  return { saved: true, answered: values.filter(Boolean).length };
}

/** With the account. */
export async function forgetAbout(userId) {
  await ensureTable();
  await query('DELETE FROM about_you WHERE user_id = $1', [userId]);
}
