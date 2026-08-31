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
  createCipheriv, createDecipheriv,
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
export function decoySalt(email, pepper) {
  return createHash('sha256')
    .update(`${pepper}:${email}`)
    .digest('base64url')
    .slice(0, 22);
}

/**
 * Encrypting the one thing this server is trusted to hold: a data key.
 *
 * Everything else here is one-way, because the server has no business being
 * able to reverse it. This is the exception, and it exists because a password
 * reset by email has to end with the user's journal still readable — which
 * means something reachable from a reset link has to be able to produce the
 * key. There is no arrangement where that is true and the server cannot.
 *
 * What can still be arranged is that the *database alone* is not enough. The
 * key below comes from ESCROW_SECRET in the deployment's environment, so a
 * dump of the tables is inert without it. Two different places have to fall
 * over, not one.
 *
 * Returns null when ESCROW_SECRET is unset, which is how the app knows to offer
 * recovery keys instead of reset links.
 */
function escrowKey() {
  const secret = process.env.ESCROW_SECRET;
  if (!secret || secret.length < 16) return null;
  // A fixed derivation, because the same key has to open rows written by an
  // earlier deployment of the same secret.
  return createHash('sha256').update(`escrow:${secret}`).digest();
}

export function escrowAvailable() {
  return escrowKey() !== null;
}

/** Seal a short secret for storage. Returns { iv, ct } base64url, or null. */
export function sealForServer(plaintext) {
  const key = escrowKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  // The tag travels with the ciphertext; splitting them buys nothing and is one
  // more thing to get wrong.
  return {
    iv: iv.toString('base64url'),
    ct: Buffer.concat([body, cipher.getAuthTag()]).toString('base64url'),
  };
}

/** Reverse of sealForServer. Returns null if the secret changed or it is corrupt. */
export function openFromServer(sealed) {
  const key = escrowKey();
  if (!key || !sealed?.iv || !sealed?.ct) return null;
  try {
    const raw = Buffer.from(sealed.ct, 'base64url');
    const tag = raw.subarray(raw.length - 16);
    const body = raw.subarray(0, raw.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64url'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
