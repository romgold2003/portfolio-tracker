/**
 * Everything the API does to the database, in one place.
 *
 * The endpoints above this file deal with HTTP and nothing else; the rules
 * about what an account is live here.
 *
 * Note what is stored and what is not. A user row holds an email, a salt, a
 * hashed auth secret, and two *wrapped* copies of a data key. A vault row holds
 * a nonce and a block of AES-GCM ciphertext. Every one of those is inert on its
 * own: the key that opens the wrappers is derived from a password this server
 * has never seen and would need 310,000 PBKDF2 iterations per guess to attack.
 * Someone who walks off with the entire database has a pile of ciphertext.
 */
import { query, one, driverGeneration } from './db.js';
import {
  hashSecret, verifySecret, hashToken, randomToken, newId,
} from './crypto.js';

/** How long a login lasts before it has to be done again. */
const SESSION_DAYS = 30;

/**
 * A secret that is stable for this deployment and known only to it.
 *
 * The decoy salts handed to unknown email addresses are derived from it. That
 * only hides who has an account if the value cannot be guessed: with a
 * hardcoded fallback, anyone could compute the decoy for an address themselves,
 * compare it against what the server returned, and read off whether the account
 * exists — which is the exact thing the decoy is there to prevent.
 *
 * So it is generated once, at random, and kept in the database. An operator can
 * still set DECOY_SECRET to pin it. Cached after the first read, because it is
 * needed on every sign-in.
 */
let cachedPepper = null;
let cachedFor = -1;

export async function serverPepper() {
  if (process.env.DECOY_SECRET) return process.env.DECOY_SECRET;
  if (cachedPepper && cachedFor === driverGeneration()) return cachedPepper;
  cachedFor = driverGeneration();

  const existing = await one('SELECT value FROM settings WHERE key = $1', ['decoy_pepper']);
  if (existing) {
    cachedPepper = existing.value;
    return cachedPepper;
  }

  const fresh = randomToken(32);
  try {
    await query('INSERT INTO settings (key, value) VALUES ($1, $2)', ['decoy_pepper', fresh]);
    cachedPepper = fresh;
  } catch {
    // Two cold functions raced to create it; whoever won is authoritative.
    const row = await one('SELECT value FROM settings WHERE key = $1', ['decoy_pepper']);
    cachedPepper = row ? row.value : fresh;
  }
  return cachedPepper;
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function looksLikeEmail(email) {
  const address = normalizeEmail(email);
  return address.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
}

/**
 * A wrapped data key as the browser produced it: a salt, a nonce and the
 * ciphertext, all base64. Checked for shape and size because it is stored and
 * handed back out, and an endpoint should not be a place to park arbitrary data.
 */
const BASE64 = /^[A-Za-z0-9+/=_-]*$/;

function isSealed(value, maxLength) {
  return !!value
    && typeof value === 'object'
    && typeof value.iv === 'string' && value.iv.length <= 64 && BASE64.test(value.iv)
    && typeof value.ct === 'string' && value.ct.length <= maxLength && BASE64.test(value.ct);
}

export function isWrapper(value) {
  return isSealed(value, 512)
    && typeof value.salt === 'string' && value.salt.length <= 64 && BASE64.test(value.salt);
}

/** A journal's worth of ciphertext. Generous, but not unbounded. */
export const MAX_VAULT_CHARS = 1_500_000;

export function isVaultBlob(value) {
  return isSealed(value, MAX_VAULT_CHARS);
}

export function findUserByEmail(email) {
  return one('SELECT * FROM users WHERE email = $1', [normalizeEmail(email)]);
}

export function findUserById(id) {
  return one('SELECT * FROM users WHERE id = $1', [id]);
}

/**
 * Create an account and its first vault.
 *
 * Returns null when the address is taken. The check and the insert are not one
 * transaction, so the unique index on email is what actually guarantees it —
 * two simultaneous signups for the same address end with one of them here.
 */
export async function createUser({
  email, authSalt, authSecret, recoverySalt, recoverySecret,
  passwordWrapper, recoveryWrapper, vault,
}) {
  const address = normalizeEmail(email);
  if (await findUserByEmail(address)) return null;

  const id = newId('u');
  const now = new Date().toISOString();
  try {
    await query(
      `INSERT INTO users
         (id, email, auth_salt, auth_hash, rec_salt, rec_hash, pw_wrapper, rec_wrapper, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id, address,
        authSalt, await hashSecret(authSecret),
        recoverySalt, await hashSecret(recoverySecret),
        JSON.stringify(passwordWrapper), JSON.stringify(recoveryWrapper), now,
      ],
    );
  } catch (err) {
    // Almost certainly the unique index on email doing its job.
    if (/unique|duplicate/i.test(err.message)) return null;
    throw err;
  }

  await query(
    'INSERT INTO vaults (user_id, iv, ct, version, updated_at) VALUES ($1, $2, $3, $4, $5)',
    [id, vault.iv, vault.ct, 1, now],
  );
  return findUserById(id);
}

/** Verify an auth secret. Returns the user or null; never says which was wrong. */
export async function authenticate(email, authSecret) {
  const user = await findUserByEmail(email);
  if (!user) return null;
  const ok = await verifySecret(authSecret, user.auth_hash);
  return ok ? user : null;
}

/**
 * The same, for someone who forgot their password and has their recovery key.
 *
 * A separate secret rather than simply handing out the recovery wrapper: that
 * wrapper opens the journal to anyone who can guess the recovery key offline,
 * and an endpoint that gives it away for an email address alone would invite
 * exactly that. Proving the key first means the guessing has to happen through
 * this endpoint, where it is rate limited.
 */
export async function authenticateRecovery(email, recoverySecret) {
  const user = await findUserByEmail(email);
  if (!user) return null;
  const ok = await verifySecret(recoverySecret, user.rec_hash);
  return ok ? user : null;
}

export async function startSession(userId) {
  const token = randomToken();
  const now = Date.now();
  await query(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
    [
      hashToken(token), userId,
      new Date(now).toISOString(),
      new Date(now + SESSION_DAYS * 86_400_000).toISOString(),
    ],
  );
  return { token, maxAge: SESSION_DAYS * 86_400 };
}

/** The user behind a session token, or null if it is unknown or expired. */
export async function userForToken(token) {
  if (!token) return null;
  const row = await one('SELECT * FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await endSession(token);
    return null;
  }
  return findUserById(row.user_id);
}

export async function endSession(token) {
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

/**
 * Sign the user out everywhere. Used when the password changes: the whole point
 * of changing it is that whoever knew the old one is locked out, and a session
 * they already hold would sail straight past that.
 */
export function endAllSessions(userId) {
  return query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

export function readVault(userId) {
  return one('SELECT iv, ct, version, updated_at FROM vaults WHERE user_id = $1', [userId]);
}

/**
 * Store a new version of the vault.
 *
 * `expectedVersion` is what the client believed it was editing. If the stored
 * version has moved on, another device saved first and this write would silently
 * erase those trades, so it is refused and the caller is handed the newer row.
 *
 * The comparison and the write are one statement, so two devices saving at the
 * same instant cannot both read version 4 and both write version 5.
 */
export async function writeVault(userId, blob, expectedVersion) {
  const now = new Date().toISOString();
  /**
   * RETURNING is what makes this trustworthy, and it is worth being explicit
   * about why. The obvious alternative — update, then re-read and check the
   * version is the one we expected to write — has a hole: if another device
   * saved first, our UPDATE matches nothing, and the version it left behind is
   * *exactly* the number we were going to write. The re-read then reports
   * success for a write that never happened, and the client throws away trades
   * it thinks were saved.
   *
   * A row comes back only if this statement is the one that changed it.
   */
  const { rows } = await query(
    `UPDATE vaults SET iv = $1, ct = $2, version = version + 1, updated_at = $3
      WHERE user_id = $4 AND version = $5
      RETURNING iv, ct, version, updated_at`,
    [blob.iv, blob.ct, now, userId, expectedVersion],
  );

  if (rows.length) return { ok: true, vault: rows[0] };
  return { ok: false, vault: await readVault(userId) };
}

export async function updateAuth(userId, { authSalt, authSecret, passwordWrapper }) {
  await query(
    'UPDATE users SET auth_salt = $1, auth_hash = $2, pw_wrapper = $3 WHERE id = $4',
    [authSalt, await hashSecret(authSecret), JSON.stringify(passwordWrapper), userId],
  );
}

/** The shape the client expects back. Never includes auth_hash. */
export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.created_at,
    passwordWrapper: JSON.parse(user.pw_wrapper),
    recoveryWrapper: JSON.parse(user.rec_wrapper),
  };
}
