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
  age: ['u18', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'],
  goal: ['wealth', 'trading', 'retire', 'learn', 'track'],
  experience: ['lt1', '1-3', '3-10', '10+'],
  style: ['long', 'swing', 'day', 'mix'],
  heard: ['friend', 'instagram', 'tiktok', 'youtube', 'google', 'university', 'other'],
  occupation: ['student', 'employed', 'self', 'retired', 'other'],
};
const FIELDS = [...Object.keys(ABOUT_CHOICES), 'country'];

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
   created_at TEXT NOT NULL,
   updated_at TEXT NOT NULL
 )`;

let readyFor = null;
async function ensureTable() {
  if (readyFor === driverGeneration()) return;
  await query(TABLE, []);
  readyFor = driverGeneration();
}

/** Only the listed choices, and a two-letter country code; anything else is left empty. */
export function cleanAnswers(body) {
  const out = {};
  for (const [field, allowed] of Object.entries(ABOUT_CHOICES)) {
    const v = body?.[field];
    out[field] = typeof v === 'string' && allowed.includes(v) ? v : null;
  }
  const country = typeof body?.country === 'string' ? body.country.toUpperCase() : '';
  out.country = /^[A-Z]{2}$/.test(country) ? country : null;
  return out;
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
