/**
 * Envelope encryption for a locally stored journal, built on the browser's own
 * Web Crypto. No dependencies, nothing leaves the machine.
 *
 * The shape is the standard one, and it is what makes recovery possible without
 * a server:
 *
 *   journal  --encrypted with-->  a random data key
 *   data key --wrapped by------>  a key derived from the password
 *   data key --wrapped by------>  a key derived from the recovery key
 *
 * Either wrapper opens the same data key, so a forgotten password is survivable
 * as long as the recovery key was written down. Changing the password only
 * rewraps the data key; the journal itself is never re-encrypted.
 *
 * The data key exists only in memory, and only while a profile is unlocked.
 */

/**
 * PBKDF2 work factor. OWASP's floor for PBKDF2-HMAC-SHA256 at time of writing.
 * Deliberately slow: it costs the user about a second at login and costs an
 * attacker the same second on every guess.
 */
const PBKDF2_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const IV_BYTES = 12; // AES-GCM standard nonce length

const subtle = globalThis.crypto?.subtle;

/** Web Crypto needs a secure context. Fails loudly rather than silently weakening. */
export function cryptoAvailable() {
  return !!subtle;
}

export function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function toBase64(bytes) {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

export function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Stretch a human secret into an AES key.
 *
 * `extractable: false` so the derived key cannot be read back out of memory by
 * anything that gets a reference to it.
 */
async function deriveWrappingKey(secret, salt) {
  const material = await subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** A fresh 256-bit key for one profile's journal. */
export function generateDataKey() {
  return randomBytes(32);
}

/** Encrypt arbitrary bytes under a wrapping key. */
async function sealBytes(bytes, wrappingKey) {
  const iv = randomBytes(IV_BYTES);
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, bytes);
  return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ciphertext)) };
}

/** Reverse of sealBytes. Throws if the key is wrong — AES-GCM authenticates. */
async function openBytes(sealed, wrappingKey) {
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(sealed.iv) },
    wrappingKey,
    fromBase64(sealed.ct),
  );
  return new Uint8Array(plain);
}

/**
 * Lock a data key behind a human secret. Returns everything needed to unlock it
 * later, none of which is itself secret.
 */
export async function wrapDataKey(dataKey, secret) {
  const salt = randomBytes(SALT_BYTES);
  const wrappingKey = await deriveWrappingKey(secret, salt);
  const sealed = await sealBytes(dataKey, wrappingKey);
  return { salt: toBase64(salt), ...sealed };
}

/**
 * Recover the data key from a wrapper.
 * Returns null on a wrong secret rather than throwing, because a failed unlock
 * is an expected outcome, not an error.
 */
export async function unwrapDataKey(wrapped, secret) {
  try {
    const wrappingKey = await deriveWrappingKey(secret, fromBase64(wrapped.salt));
    return await openBytes(wrapped, wrappingKey);
  } catch {
    return null;
  }
}

/** Import raw data-key bytes as an AES key for journal encryption. */
async function importDataKey(dataKey) {
  return subtle.importKey('raw', dataKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptJson(value, dataKey) {
  const key = await importDataKey(dataKey);
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return sealBytes(bytes, key);
}

/** Returns null when the blob is corrupt or the key is wrong. */
export async function decryptJson(sealed, dataKey) {
  try {
    const key = await importDataKey(dataKey);
    const bytes = await openBytes(sealed, key);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/**
 * A recovery key the user has to be able to copy off a screen and type back in.
 *
 * Crockford's base32 alphabet: no I, L, O or U, so there is no confusing 0 with
 * O or 1 with l, and no accidental words. 26 characters is ~130 bits of
 * entropy, far past anything guessable.
 */
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateRecoveryKey() {
  const bytes = randomBytes(26);
  const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]);
  // Grouped for legibility when written down: XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-X
  return chars.join('').replace(/(.{5})(?=.)/g, '$1-');
}

/** Accept a typed recovery key however the user spaced or cased it. */
export function normalizeRecoveryKey(input) {
  return String(input || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}
