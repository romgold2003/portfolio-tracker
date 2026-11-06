/**
 * Proof of agreement (November 2026): which version of the Terms of Service
 * and Privacy Policy each account accepted, and when, and whether it asked for
 * marketing emails — so Riskbook can show who agreed to what.
 *
 * One row per account, updated when a newer version is accepted or the
 * marketing choice changes. Deleted with the account. The table is made on
 * first use, as the Friends tables are.
 */
import { query, one, driverGeneration } from './db.js';

const TABLE = `CREATE TABLE IF NOT EXISTS consents (
   user_id      TEXT PRIMARY KEY,
   version      INTEGER NOT NULL,
   accepted_at  TEXT NOT NULL,
   marketing    INTEGER NOT NULL DEFAULT 0,
   marketing_at TEXT
 )`;

let readyFor = null;
export async function ensureConsentTable() {
  if (readyFor === driverGeneration()) return;
  await query(TABLE, []);
  readyFor = driverGeneration();
}

/** A version number the app could have shown: a small whole number. */
const cleanVersion = (v) => (Number.isInteger(v) && v >= 1 && v <= 1000 ? v : null);

/**
 * Record acceptance of a version, with the marketing choice made beside it.
 * `marketing` left out keeps whatever was chosen before.
 */
export async function recordConsent(user, body) {
  await ensureConsentTable();
  const version = cleanVersion(body?.version);
  if (version == null) return { recorded: false };
  const at = new Date().toISOString();
  const before = await one('SELECT marketing FROM consents WHERE user_id = $1', [user.id]);
  const marketing = typeof body?.marketing === 'boolean' ? body.marketing : Boolean(Number(before?.marketing ?? 0));
  const changed = !before || Boolean(Number(before.marketing)) !== marketing;
  await query(
    `INSERT INTO consents (user_id, version, accepted_at, marketing, marketing_at) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET version = excluded.version, accepted_at = excluded.accepted_at,
       marketing = excluded.marketing, marketing_at = COALESCE(excluded.marketing_at, consents.marketing_at)`,
    [user.id, version, at, marketing ? 1 : 0, changed ? at : null],
  );
  return { recorded: true, version, marketing };
}

/** Change only the marketing choice (Settings), keeping the accepted version. */
export async function setMarketing(user, body) {
  await ensureConsentTable();
  if (typeof body?.marketing !== 'boolean') return { recorded: false };
  const at = new Date().toISOString();
  const res = await query('UPDATE consents SET marketing = $1, marketing_at = $2 WHERE user_id = $3', [body.marketing ? 1 : 0, at, user.id]);
  return { recorded: Number(res?.rowCount ?? 1) > 0, marketing: body.marketing };
}

/** What this account has accepted, for the app: version and marketing, or nothing yet. */
export async function consentOf(user) {
  await ensureConsentTable();
  const row = await one('SELECT version, accepted_at, marketing FROM consents WHERE user_id = $1', [user.id]);
  return row ? { version: Number(row.version), acceptedAt: row.accepted_at, marketing: Boolean(Number(row.marketing)) } : { version: 0, marketing: false };
}

/** With the account. */
export async function forgetConsent(userId) {
  await ensureConsentTable();
  await query('DELETE FROM consents WHERE user_id = $1', [userId]);
}
