/**
 * Referral codes (November 2026).
 *
 * Every member has one code, for life. Give a month, get a month:
 *   - the friend who joins with the code gets a free month at once;
 *   - the member who shared it gets a free month when that friend pays their
 *     first real month — once per friend, however often the friend pays.
 *
 * Clavis does not take payments yet. Everything up to the payment is here and
 * working; the payment system, when it exists, calls recordPayment(userId,
 * { paymentFingerprint }) from its "payment succeeded" webhook, and the
 * reward follows. Free months are written to free_months for that same system
 * to honour, one per billing month (useFreeMonth), so months earned together
 * follow one another.
 *
 * Rules that keep it fair (Romy, November 2026):
 *   - at most YEARLY_CAP free months from referrals in any 365 days, so one
 *     person cannot chain free use forever;
 *   - no self-referral: refused when the two emails are the same person
 *     (plus-addressing, Gmail dots) or share a company domain, and no reward
 *     when the friend pays with a card the member has paid with;
 *   - one referrer per account, set once; a code only in an account's first
 *     REDEEM_DAYS days; never your own.
 */
import { randomBytes } from 'node:crypto';
import { query, one, driverGeneration } from './db.js';
import { mailAvailable, sendReferralRewardEmail } from './mail.js';

/** What the member who shared the code earns when the friend first pays. */
export const REWARD_MONTHS = 1;
/** What the friend gets for joining with a code. */
export const WELCOME_MONTHS = 1;
/** The most free months referrals can give one account in any 365 days. */
export const YEARLY_CAP = 6;
export const REDEEM_DAYS = 14;
/** No 0/O, 1/I/L: a code read aloud or copied by hand should survive. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const YEAR_MS = 365 * 86400000;

/** Address providers anyone can sign up to: sharing one says nothing. */
const PUBLIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.fr',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.net', 'zoho.com',
  'yandex.com', 'mail.com', 'walla.co.il', 'walla.com', 'bezeqint.net', 'netvision.net.il', 'orange.fr', 'free.fr',
]);

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
  /**
   * Free months owed to a member, for the payment system to apply. A reward
   * that a rule stopped is written with 0 months and the rule as its reason,
   * so what happened can always be read back.
   */
  `CREATE TABLE IF NOT EXISTS free_months (
     id         TEXT PRIMARY KEY,
     user_id    TEXT NOT NULL,
     months     INTEGER NOT NULL,
     reason     TEXT NOT NULL,
     source_id  TEXT,
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS free_months_user ON free_months (user_id)`,
  /** Which payment methods each member has paid with, as the provider's fingerprint (never the card). */
  `CREATE TABLE IF NOT EXISTS payment_methods (
     user_id     TEXT NOT NULL,
     fingerprint TEXT NOT NULL,
     first_seen  TEXT NOT NULL,
     PRIMARY KEY (user_id, fingerprint)
   )`,
  `CREATE INDEX IF NOT EXISTS payment_methods_fp ON payment_methods (fingerprint)`,
  /** The congratulations waiting in the app, shown once and then marked seen. */
  `CREATE TABLE IF NOT EXISTS referral_notices (
     id           TEXT PRIMARY KEY,
     user_id      TEXT NOT NULL,
     friend_label TEXT,
     months       INTEGER NOT NULL,
     created_at   TEXT NOT NULL,
     seen_at      TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS referral_notices_user ON referral_notices (user_id)`,
  /**
   * Each billing month a free month was used for: one row per member per
   * month, so two months earned together are spent one after the other.
   */
  `CREATE TABLE IF NOT EXISTS free_month_uses (
     user_id TEXT NOT NULL,
     cycle   TEXT NOT NULL,
     used_at TEXT NOT NULL,
     PRIMARY KEY (user_id, cycle)
   )`,
];

let readyFor = -1;
async function ensureTables() {
  if (readyFor === driverGeneration()) return;
  for (const statement of TABLES) await query(statement, []);
  readyFor = driverGeneration();
}

const now = () => new Date().toISOString();
const newId = () => randomBytes(12).toString('hex');

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

/**
 * Whether two email addresses are likely the same person or organisation:
 * the same mailbox once plus-addressing and Gmail's dots are set aside, or
 * the same domain when it is not a public provider anyone can join.
 */
export function sameIdentity(a, b) {
  const split = (address) => {
    const [local = '', domain = ''] = String(address ?? '').trim().toLowerCase().split('@');
    const host = domain === 'googlemail.com' ? 'gmail.com' : domain;
    let box = local.split('+')[0];
    if (host === 'gmail.com') box = box.replace(/\./g, '');
    return { box, host };
  };
  const x = split(a);
  const y = split(b);
  if (!x.host || !y.host) return false;
  if (x.host !== y.host) return false;
  if (!PUBLIC_DOMAINS.has(x.host)) return true;
  return x.box === y.box;
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

/** Free months referrals have given this account in the last 365 days. */
async function monthsThisYear(userId, at = now()) {
  const since = new Date(Date.parse(at) - YEAR_MS).toISOString();
  const row = await one(
    "SELECT COALESCE(SUM(months), 0) AS n FROM free_months WHERE user_id = $1 AND created_at > $2 AND reason IN ('referral', 'welcome')",
    [userId, since],
  );
  return Number(row?.n ?? 0);
}

/** Give free months up to the yearly cap; whatever the cap stops is recorded as such. */
async function grant(userId, months, reason, sourceId, at = now()) {
  const room = Math.max(0, YEARLY_CAP - await monthsThisYear(userId, at));
  const given = Math.min(months, room);
  await query(
    'INSERT INTO free_months (id, user_id, months, reason, source_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [newId(), userId, given, given ? reason : `${reason}-capped`, sourceId, at],
  );
  return given;
}

/**
 * Link a new member to whoever shared the code, and give them their welcome
 * month. Refused, with a reason a person can act on, when the code is unknown
 * or their own, when the two accounts look like one person or one company,
 * when the account already has a referrer or is older than REDEEM_DAYS.
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
  const referrer = await one('SELECT email FROM users WHERE id = $1', [owner.user_id]);
  if (referrer && user.email && sameIdentity(referrer.email, user.email)) {
    throw new ReferralError(400, 'Codes are for inviting other people: this one cannot be used between these two accounts.');
  }
  const at = now();
  await query(
    'INSERT INTO referrals (referred_id, referrer_id, code, joined_at) VALUES ($1, $2, $3, $4)',
    [user.id, owner.user_id, code, at],
  );
  const welcome = await grant(user.id, WELCOME_MONTHS, 'welcome', owner.user_id, at);
  return { linked: true, freeMonths: welcome };
}

/**
 * The hook for the payment system: call it when a member's payment succeeds,
 * with the provider's fingerprint of the card or account paid with.
 *
 * The first payment of a referred member gives the referrer REWARD_MONTHS,
 * up to the yearly cap — unless the same payment method has paid for the
 * referrer, which marks it as one person. Safe to call again for the same
 * payment, or for members nobody referred.
 */
export async function recordPayment(userId, { at = now(), paymentFingerprint = null } = {}) {
  await ensureTables();
  if (paymentFingerprint) {
    if (!await one('SELECT 1 AS has FROM payment_methods WHERE user_id = $1 AND fingerprint = $2', [userId, paymentFingerprint])) {
      await query('INSERT INTO payment_methods (user_id, fingerprint, first_seen) VALUES ($1, $2, $3)', [userId, paymentFingerprint, at]);
    }
  }
  const row = await one('SELECT referrer_id, paid_at, rewarded_at FROM referrals WHERE referred_id = $1', [userId]);
  if (!row) return { rewarded: false };
  if (!row.paid_at) await query('UPDATE referrals SET paid_at = $1 WHERE referred_id = $2', [at, userId]);
  if (row.rewarded_at) return { rewarded: false };
  // Claimed in one step, so two webhooks arriving together cannot both pay.
  await query('UPDATE referrals SET rewarded_at = $1 WHERE referred_id = $2 AND rewarded_at IS NULL', [at, userId]);
  const mine = await one('SELECT rewarded_at FROM referrals WHERE referred_id = $1', [userId]);
  if (mine?.rewarded_at !== at) return { rewarded: false };

  if (paymentFingerprint && await one(
    'SELECT 1 AS same FROM payment_methods WHERE user_id = $1 AND fingerprint = $2', [row.referrer_id, paymentFingerprint],
  )) {
    await query(
      'INSERT INTO free_months (id, user_id, months, reason, source_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [newId(), row.referrer_id, 0, 'referral-same-payment', userId, at],
    );
    return { rewarded: false, reason: 'same-payment' };
  }
  const given = await grant(row.referrer_id, REWARD_MONTHS, 'referral', userId, at);
  if (!given) return { rewarded: false, reason: 'capped' };
  await congratulate(row.referrer_id, userId, given, at);
  return { rewarded: true, referrer: row.referrer_id, months: given };
}

/**
 * How the referrer is told who paid: the friend's first name when they gave
 * one in their profile, otherwise the start of their email ("sasha.levi@…"
 * becomes "Sasha"). The referrer invited them, so this tells them nothing new
 * about who; the Privacy Policy says it is shared.
 */
export function friendLabelFrom(firstName, email) {
  const clean = (text) => String(text ?? '').trim();
  if (clean(firstName)) return clean(firstName).slice(0, 40);
  const local = clean(email).split('@')[0].split(/[._+\-\d]/).find(Boolean) ?? '';
  return local ? local[0].toUpperCase() + local.slice(1).toLowerCase() : '';
}

async function friendLabel(userId) {
  const user = await one('SELECT email FROM users WHERE id = $1', [userId]);
  let first = null;
  try {
    first = (await one('SELECT first_name FROM about_you WHERE user_id = $1', [userId]))?.first_name ?? null;
  } catch { /* no profile answers yet: the table may not exist */ }
  return friendLabelFrom(first, user?.email);
}

/**
 * The thank-you: kept in the app until it has been seen, and sent by email
 * when mail is set up. A failed email never undoes the reward.
 */
async function congratulate(referrerId, friendId, months, at) {
  const label = await friendLabel(friendId);
  await query(
    'INSERT INTO referral_notices (id, user_id, friend_label, months, created_at) VALUES ($1, $2, $3, $4, $5)',
    [newId(), referrerId, label || null, months, at],
  );
  if (!mailAvailable()) return;
  const referrer = await one('SELECT email FROM users WHERE id = $1', [referrerId]);
  if (!referrer?.email) return;
  const site = process.env.APP_URL || process.env.PUBLIC_URL || '';
  await sendReferralRewardEmail(referrer.email, label, months, site).catch((err) => console.error('referral email', err.message));
}

/* ── Spending free months: one per billing month, in order ── */

/** Free months this member has, all sources together. */
async function monthsOwned(userId) {
  const row = await one('SELECT COALESCE(SUM(months), 0) AS n FROM free_months WHERE user_id = $1', [userId]);
  return Number(row?.n ?? 0);
}

async function monthsUsed(userId) {
  const row = await one('SELECT COUNT(*) AS n FROM free_month_uses WHERE user_id = $1', [userId]);
  return Number(row?.n ?? 0);
}

/** Free months earned and not yet used. */
export async function freeMonthsLeft(userId) {
  await ensureTables();
  return Math.max(0, await monthsOwned(userId) - await monthsUsed(userId));
}

/**
 * The hook for billing, once a month per member, before charging: is this
 * month free? `cycle` names the billing month (say "2027-03"). At most one free
 * month is used per cycle, so two earned in the same month cover this month
 * and the next, never both at once. Asking again for the same cycle gives the
 * same answer and uses nothing more.
 */
export async function useFreeMonth(userId, cycle) {
  await ensureTables();
  const key = String(cycle ?? '').slice(0, 20);
  if (!key) throw new ReferralError(400, 'A billing month is needed.');
  if (await one('SELECT 1 AS used FROM free_month_uses WHERE user_id = $1 AND cycle = $2', [userId, key])) {
    return { free: true, left: await freeMonthsLeft(userId) };
  }
  if (await freeMonthsLeft(userId) < 1) return { free: false, left: 0 };
  await query('INSERT INTO free_month_uses (user_id, cycle, used_at) VALUES ($1, $2, $3)', [userId, key, now()]);
  return { free: true, left: await freeMonthsLeft(userId) };
}

/** Mark this member's waiting congratulations as seen. */
export async function noticesSeen(user) {
  await ensureTables();
  await query('UPDATE referral_notices SET seen_at = $1 WHERE user_id = $2 AND seen_at IS NULL', [now(), user.id]);
  return { ok: true };
}

/** What the profile panel shows: the code, who joined with it, who paid, the months earned. */
export async function referralStats(user) {
  const code = await codeFor(user);
  const joined = await one('SELECT COUNT(*) AS n FROM referrals WHERE referrer_id = $1', [user.id]);
  const paid = await one('SELECT COUNT(*) AS n FROM referrals WHERE referrer_id = $1 AND paid_at IS NOT NULL', [user.id]);
  const months = await one('SELECT COALESCE(SUM(months), 0) AS n FROM free_months WHERE user_id = $1', [user.id]);
  const mine = await one('SELECT 1 AS has FROM referrals WHERE referred_id = $1', [user.id]);
  const created = Date.parse(user.created_at ?? user.createdAt ?? '');
  const canRedeem = !mine && (!Number.isFinite(created) || Date.now() - created <= REDEEM_DAYS * 86400000);
  const thisYear = await monthsThisYear(user.id);
  const waiting = await query(
    'SELECT friend_label, months, created_at FROM referral_notices WHERE user_id = $1 AND seen_at IS NULL ORDER BY created_at',
    [user.id],
  );
  return {
    code,
    joined: Number(joined?.n ?? 0),
    paid: Number(paid?.n ?? 0),
    freeMonths: Number(months?.n ?? 0),
    rewardMonths: REWARD_MONTHS,
    welcomeMonths: WELCOME_MONTHS,
    yearlyCap: YEARLY_CAP,
    leftThisYear: Math.max(0, YEARLY_CAP - thisYear),
    referred: Boolean(mine),
    canRedeem,
    notices: (waiting?.rows ?? waiting ?? []).map((n) => ({ friend: n.friend_label || null, months: Number(n.months), at: n.created_at })),
    // Earned and not yet used: billing spends one per month (useFreeMonth).
    freeMonthsLeft: Math.max(0, Number(months?.n ?? 0) - await monthsUsed(user.id)),
  };
}

/**
 * A deleted account takes its code, its links and its free months with it.
 * Friends it brought keep their accounts; only the link back to this one goes.
 */
export async function forgetReferrals(userId) {
  await ensureTables();
  await query('DELETE FROM referral_codes WHERE user_id = $1', [userId]);
  await query('DELETE FROM referrals WHERE referred_id = $1 OR referrer_id = $1', [userId]);
  await query('DELETE FROM free_months WHERE user_id = $1', [userId]);
  await query('DELETE FROM payment_methods WHERE user_id = $1', [userId]);
  await query('DELETE FROM referral_notices WHERE user_id = $1', [userId]);
  await query('DELETE FROM free_month_uses WHERE user_id = $1', [userId]);
}
