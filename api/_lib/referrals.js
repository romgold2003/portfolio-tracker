/**
 * Referral codes (November 2026).
 *
 * Every member has one code, for life. Someone who joins with it is linked to
 * the member who shared it. When that new member pays for the first time, the
 * member who shared the code earns two free months — once per person they
 * brought, however many times that person pays afterwards.
 *
 * Clavis does not take payments yet. Everything up to the payment is here and
 * working; the payment system, when it exists, calls recordPayment(userId)
 * from its "payment succeeded" webhook, and the reward follows. The free
 * months are written as credits for that same system to honour.
 *
 * Rules that keep it fair:
 *   - your own code does nothing for you;
 *   - one referrer per account, set once, never changed;
 *   - a code can only be added in the first REDEEM_DAYS days of an account,
 *     and only before it has paid;
 *   - a reward is paid once per referred person.
 */
import { randomBytes } from 'node:crypto';
import { query, one, driverGeneration } from './db.js';

export const REWARD_MONTHS = 2;
export const REDEEM_DAYS = 14;
/** No 0/O, 1/I/L: a code read aloud or copied by hand should survive. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

const TABLES = [
  `CREATE TABLE IF NOT EXISTS referral_codes (
     user_id    TEXT PRIMARY KEY,
     code       TEXT NOT NULL UNIQUE,
     created_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS referrals (
     referred_id TEXT PRIMARY KEY,
     referrer_id TEXT NOT NULL,
     code        TEXT NOT NULL,
     joined_at   TEXT NOT NULL,
     paid_at     TEXT,
     rewarded_at TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS referrals_referrer ON referrals (referrer_id)`,
  /** Free months owed to a member, for the payment system to apply. */
  `CREATE TABLE IF NOT EXISTS free_months (
     id         TEXT PRIMARY KEY,
     user_id    TEXT NOT NULL,
     months     INTEGER NOT NULL,
     reason     TEXT NOT NULL,
     source_id  TEXT,
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS free_months_user ON free_months (user_id)`,
];

let readyFor = -1;
async function ensureTables() {
  if (readyFor === driverGeneration()) return;
  for (const statement of TABLES) await query(statement, []);
  readyFor = driverGeneration();
}

const now = () => new Date().toISOString();

/** A refusal the endpoint turns into a 4xx with this message. */
export class ReferralError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function newCode(bytes = randomBytes(CODE_LENGTH)) {
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** What someone typed or pasted, as a code: capitals, letters and digits only. */
export function normalizeCode(text) {
  return String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}

/** This member's code, made the first time it is asked for and never changed. */
export async function codeFor(user) {
  await ensureTables();
  const have = await one('SELECT code FROM referral_codes WHERE user_id = $1', [user.id]);
  if (have) return have.code;
  for (let tries = 0; tries < 6; tries += 1) {
    const code = newCode();
    if (await one('SELECT 1 AS taken FROM referral_codes WHERE code = $1', [code])) continue;
    await query('INSERT INTO referral_codes (user_id, code, created_at) VALUES ($1, $2, $3)', [user.id, code, now()]);
    // Two requests at once can both insert: whichever row stands is the code.
    const row = await one('SELECT code FROM referral_codes WHERE user_id = $1', [user.id]);
    if (row) return row.code;
  }
  throw new ReferralError(503, 'Could not make a code just now. Try again.');
}

/**
 * Link a new member to whoever shared the code. Refused, with a reason a
 * person can act on, when the code is unknown or their own, when the account
 * already has a referrer, has paid, or is older than REDEEM_DAYS.
 */
export async function redeem(user, typed) {
  await ensureTables();
  const code = normalizeCode(typed);
  if (code.length < 6) throw new ReferralError(400, 'Enter the code a friend shared with you.');
  const owner = await one('SELECT user_id FROM referral_codes WHERE code = $1', [code]);
  if (!owner) throw new ReferralError(404, 'No member has that code. Check it and try again.');
  if (owner.user_id === user.id) throw new ReferralError(400, 'That is your own code: share it with friends instead.');
  if (await one('SELECT 1 AS has FROM referrals WHERE referred_id = $1', [user.id])) {
    throw new ReferralError(409, 'A referral code is already linked to your account.');
  }
  const created = Date.parse(user.created_at ?? user.createdAt ?? '');
  if (Number.isFinite(created) && Date.now() - created > REDEEM_DAYS * 86400000) {
    throw new ReferralError(400, `A code can be added in your first ${REDEEM_DAYS} days only.`);
  }
  await query(
    'INSERT INTO referrals (referred_id, referrer_id, code, joined_at) VALUES ($1, $2, $3, $4)',
    [user.id, owner.user_id, code, now()],
  );
  return { linked: true };
}

/**
 * The hook for the payment system: call it when a member's payment succeeds.
 * The first payment of a referred member pays the referrer REWARD_MONTHS free
 * months; any later payment changes nothing. Safe to call twice for the same
 * payment, or for members nobody referred.
 */
export async function recordPayment(userId, at = now()) {
  await ensureTables();
  const row = await one('SELECT referrer_id, paid_at, rewarded_at FROM referrals WHERE referred_id = $1', [userId]);
  if (!row) return { rewarded: false };
  if (!row.paid_at) await query('UPDATE referrals SET paid_at = $1 WHERE referred_id = $2', [at, userId]);
  if (row.rewarded_at) return { rewarded: false };
  // Claimed in one step, so two webhooks arriving together cannot both pay.
  await query('UPDATE referrals SET rewarded_at = $1 WHERE referred_id = $2 AND rewarded_at IS NULL', [at, userId]);
  const mine = await one('SELECT rewarded_at FROM referrals WHERE referred_id = $1', [userId]);
  if (mine?.rewarded_at !== at) return { rewarded: false };
  await query(
    'INSERT INTO free_months (id, user_id, months, reason, source_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [randomBytes(12).toString('hex'), row.referrer_id, REWARD_MONTHS, 'referral', userId, at],
  );
  return { rewarded: true, referrer: row.referrer_id, months: REWARD_MONTHS };
}

/** What the profile panel shows: the code, who joined with it, who paid, the months earned. */
export async function referralStats(user) {
  const code = await codeFor(user);
  const joined = await one('SELECT COUNT(*) AS n FROM referrals WHERE referrer_id = $1', [user.id]);
  const paid = await one('SELECT COUNT(*) AS n FROM referrals WHERE referrer_id = $1 AND rewarded_at IS NOT NULL', [user.id]);
  const months = await one('SELECT COALESCE(SUM(months), 0) AS n FROM free_months WHERE user_id = $1', [user.id]);
  const mine = await one('SELECT 1 AS has FROM referrals WHERE referred_id = $1', [user.id]);
  const created = Date.parse(user.created_at ?? user.createdAt ?? '');
  const canRedeem = !mine && (!Number.isFinite(created) || Date.now() - created <= REDEEM_DAYS * 86400000);
  return {
    code,
    joined: Number(joined?.n ?? 0),
    paid: Number(paid?.n ?? 0),
    freeMonths: Number(months?.n ?? 0),
    rewardMonths: REWARD_MONTHS,
    referred: Boolean(mine),
    canRedeem,
  };
}

/**
 * A deleted account takes its code, its link to whoever referred it and its
 * free months with it. Friends it brought keep their accounts; only the link
 * back to this one goes.
 */
export async function forgetReferrals(userId) {
  await ensureTables();
  await query('DELETE FROM referral_codes WHERE user_id = $1', [userId]);
  await query('DELETE FROM referrals WHERE referred_id = $1 OR referrer_id = $1', [userId]);
  await query('DELETE FROM free_months WHERE user_id = $1', [userId]);
}
