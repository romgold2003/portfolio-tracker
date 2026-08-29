/**
 * Server-side secret handling.
 *
 * The server never sees a password. What the browser sends is an *auth secret*:
 * 256 bits of PBKDF2 output, stretched 310,000 times from the password under a
 * salt that is used for nothing else. The key that actually decrypts the journal
 * is derived separately, from a different salt, and never leaves the device.
 *
 * So this file is hashing a high-entropy random-looking secret, not a human
 * password. It still runs it through scrypt rather than a plain digest: if the
 * database ever leaks, the stored value must not be usable to log in, and a
 * memory-hard hash costs an attacker far more than SHA-256 for the one thing
 * they could still try.
 */
import {
  randomBytes, scrypt, timingSafeEqual, createHash,
} from 'node:crypto';

/**
 * scrypt cost. N=2^15 lands around 60-90ms on Vercel's hardware, which is a
 * cost a login can absorb and a bulk cracker cannot.
 */
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function newId(prefix) {
  return prefix + randomBytes(12).toString('base64url');
}

function scryptAsync(secret, salt) {
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, SCRYPT.keylen, SCRYPT, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** Hash an auth secret for storage. Returns "scrypt$salt$hash". */
export async function hashSecret(secret) {
  const salt = randomBytes(16);
  const key = await scryptAsync(String(secret), salt);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/**
 * Check a secret against a stored hash.
 *
 * Compared in constant time: a comparison that returns early on the first wrong
 * byte tells an attacker how much of their guess was right.
 */
export async function verifySecret(secret, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'base64url');
  const expected = Buffer.from(parts[2], 'base64url');
  const actual = await scryptAsync(String(secret), salt);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/**
 * Session tokens are stored hashed, like passwords.
 *
 * A plain digest is right here where it was not for the auth secret: the token
 * is 256 random bits with no structure to guess, so there is nothing for a
 * memory-hard hash to defend, and this runs on every single request.
 */
export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('base64url');
}

/**
 * A salt for an email that has no account.
 *
 * The login screen must ask the server for a salt before it can derive
 * anything, and answering "no such user" there would turn the endpoint into a
 * free directory of everyone who has signed up. Instead an unknown address gets
 * a salt that is random-looking but stable — derived from the address under a
 * server-held secret — so probing twice gives the same answer and the response
 * is indistinguishable from a real account's.
 *
 * The subsequent login attempt fails, as it must. It just fails the same way a
 * wrong password does.
 */
export function decoySalt(email) {
  const pepper = process.env.DECOY_SECRET || 'decoy-pepper-fallback';
  return createHash('sha256')
    .update(`${pepper}:${email}`)
    .digest('base64url')
    .slice(0, 22);
}
