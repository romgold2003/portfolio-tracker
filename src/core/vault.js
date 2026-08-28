/**
 * One password-locked journal per browser.
 *
 * There are no accounts and no email here. Each person who opens the app gets
 * their own storage on their own device anyway, so the only thing a password
 * has to do is stop someone who picks up an unlocked machine from reading the
 * book. One password, one vault, nothing to choose between.
 *
 * Envelope encryption, which is what makes recovery work without a server:
 *
 *   journal    encrypted with   a random 256-bit data key
 *   data key   wrapped by       a key derived from the password
 *   data key   wrapped by       a key derived from the recovery key
 *
 * Either wrapper opens the same data key, so a forgotten password survives as
 * long as the recovery key was written down. Changing the password rewraps the
 * data key instead of re-encrypting the journal, so it is instant at any size.
 * The data key exists only in memory, and only while the journal is unlocked.
 */
import {
  generateDataKey, wrapDataKey, unwrapDataKey, encryptJson, decryptJson,
  generateRecoveryKey, normalizeRecoveryKey, cryptoAvailable,
} from './crypto.js';

const LOCK_KEY = 'pt_lock';
const VAULT_KEY = 'pt_vault';

/** Set only while the journal is unlocked. Never persisted. */
let dataKey = null;

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/** The two wrappers and their salts. Public by necessity — none of it is secret. */
function lockRecord() {
  return readJson(LOCK_KEY, null);
}

/** True once a password has been set in this browser. */
export function isLocked() {
  return !!lockRecord();
}

export function isUnlocked() {
  return !!dataKey;
}

export const MIN_PASSWORD_LENGTH = 8;

/**
 * Turn an unprotected journal into a locked one, and return the recovery key.
 *
 * The recovery key is generated here and shown once. It is never stored —
 * only a wrapper it can open is.
 */
export async function setUpLock(password, journal) {
  if (!cryptoAvailable()) throw new Error('This browser cannot encrypt (it needs a secure page).');
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const recoveryKey = generateRecoveryKey();
  const key = generateDataKey();

  writeJson(LOCK_KEY, {
    createdAt: new Date().toISOString(),
    password: await wrapDataKey(key, password),
    recovery: await wrapDataKey(key, normalizeRecoveryKey(recoveryKey)),
  });

  // Setting a password signs you in; the journal is written straight away so
  // the caller never holds a key to something that does not exist yet.
  dataKey = key;
  await saveVault(journal ?? emptyJournal());
  return recoveryKey;
}

export function emptyJournal() {
  return { positions: [], cash: 0, snapshots: [], apiKey: '' };
}

/** Try a password. True on success. */
export async function unlockWithPassword(password) {
  const record = lockRecord();
  if (!record) return false;
  const key = await unwrapDataKey(record.password, password);
  if (!key) return false;
  dataKey = key;
  return true;
}

/** Try a recovery key. Accepts whatever spacing or casing was typed. */
export async function unlockWithRecoveryKey(recoveryKey) {
  const record = lockRecord();
  if (!record) return false;
  const key = await unwrapDataKey(record.recovery, normalizeRecoveryKey(recoveryKey));
  if (!key) return false;
  dataKey = key;
  return true;
}

/** Replace the password wrapper. The journal itself is not touched. */
export async function changePassword(newPassword) {
  if (!dataKey) throw new Error('The journal is locked.');
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const record = lockRecord();
  if (!record) throw new Error('No password has been set.');
  record.password = await wrapDataKey(dataKey, newPassword);
  writeJson(LOCK_KEY, record);
}

/** Drop the key. Everything on disk stays encrypted. */
export function lock() {
  dataKey = null;
}

/** Decrypt the journal. Null means the vault is missing or corrupt. */
export async function readVault() {
  if (!dataKey) return null;
  const sealed = readJson(VAULT_KEY, null);
  if (!sealed) return emptyJournal();
  return decryptJson(sealed, dataKey);
}

/** Encrypt and persist the journal. */
export async function saveVault(journal) {
  if (!dataKey) return false;
  writeJson(VAULT_KEY, await encryptJson(journal, dataKey));
  return true;
}

/**
 * Remove the password, leaving the journal readable again. Requires being
 * unlocked, so only someone who already knows the password can do it.
 */
export async function removeLock() {
  if (!dataKey) throw new Error('The journal is locked.');
  const journal = await readVault();
  try {
    localStorage.removeItem(LOCK_KEY);
    localStorage.removeItem(VAULT_KEY);
  } catch { /* nothing to remove */ }
  dataKey = null;
  return journal;
}
