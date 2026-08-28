/**
 * Local accounts.
 *
 * Several people can share one copy of the app on one machine, each with their
 * own journal that the others cannot read. There is no server and no network
 * call: an account is an email, two wrapped copies of a data key, and an
 * encrypted blob, all in this browser's storage.
 *
 * The email is an identifier only. Nothing is ever sent to it, and it is not
 * verified — a local app has no way to send mail, which is also why a forgotten
 * password is recovered with a recovery key rather than a reset link.
 *
 * The account list itself is deliberately readable: addresses and salts are not
 * secrets, and the login screen has to work before anyone has proved anything.
 */
import {
  generateDataKey, wrapDataKey, unwrapDataKey, encryptJson, decryptJson,
  generateRecoveryKey, normalizeRecoveryKey, cryptoAvailable,
} from './crypto.js';

const PROFILES_KEY = 'pt_profiles';
const VAULT_PREFIX = 'pt_vault_';

/** Set only while a profile is unlocked. Never persisted. */
let session = null;

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

/**
 * Emails are compared case-insensitively and without surrounding space, so
 * "Romy@Example.com " and "romy@example.com" are the same account.
 */
export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Deliberately permissive. The address is an identifier here, not a channel —
 * nothing is ever sent to it — so the only job is to catch a typo like a
 * missing @, not to adjudicate what a valid address is.
 */
export function looksLikeEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

/** Public metadata for every profile. Contains nothing secret. */
export function listProfiles() {
  const list = readJson(PROFILES_KEY, []);
  return Array.isArray(list) ? list : [];
}

export function profileExists(email) {
  const wanted = normalizeEmail(email);
  return listProfiles().some((p) => p.email === wanted);
}

export function anyProfiles() {
  return listProfiles().length > 0;
}

function saveProfiles(list) {
  writeJson(PROFILES_KEY, list);
}

/**
 * Create a profile and return its recovery key.
 *
 * The recovery key is generated here and shown to the user exactly once. It is
 * never stored anywhere — only a wrapper it can open is. Losing both it and the
 * password means the journal is unrecoverable, which is the price of having no
 * server to appeal to.
 */
export async function createProfile(email, password, initialJournal = null) {
  if (!cryptoAvailable()) throw new Error('This browser cannot encrypt (needs a secure context).');
  const address = normalizeEmail(email);
  if (!address) throw new Error('Enter an email address.');
  if (!looksLikeEmail(address)) throw new Error('That does not look like an email address.');
  if (profileExists(address)) throw new Error('An account already exists for that email on this computer.');
  if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.');

  const recoveryKey = generateRecoveryKey();
  const dataKey = generateDataKey();

  const profile = {
    id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    email: address,
    createdAt: new Date().toISOString(),
    password: await wrapDataKey(dataKey, password),
    recovery: await wrapDataKey(dataKey, normalizeRecoveryKey(recoveryKey)),
  };

  saveProfiles([...listProfiles(), profile]);
  // A brand-new account still needs a vault, so the app has something to load.
  await writeVault(profile.id, dataKey, initialJournal ?? emptyJournal());

  // Signing up signs you in. Without this the caller holds a profile it has no
  // key for, and the very next readVault() reports the journal as corrupt.
  session = { profile, dataKey };
  return { profile, recoveryKey };
}

/** Find an account by the address someone typed at the login screen. */
export function findByEmail(email) {
  const wanted = normalizeEmail(email);
  return listProfiles().find((p) => p.email === wanted) ?? null;
}

export function emptyJournal() {
  return { positions: [], cash: 0, snapshots: [], priceLog: {}, apiKey: '' };
}

/** Try a password. Returns the profile and data key, or null. */
export async function unlockWithPassword(id, password) {
  const profile = listProfiles().find((p) => p.id === id);
  if (!profile) return null;
  const dataKey = await unwrapDataKey(profile.password, password);
  if (!dataKey) return null;
  session = { profile, dataKey };
  return session;
}

/** Try a recovery key. Accepts any spacing or casing the user typed. */
export async function unlockWithRecoveryKey(id, recoveryKey) {
  const profile = listProfiles().find((p) => p.id === id);
  if (!profile) return null;
  const dataKey = await unwrapDataKey(profile.recovery, normalizeRecoveryKey(recoveryKey));
  if (!dataKey) return null;
  session = { profile, dataKey };
  return session;
}

/**
 * Replace the password wrapper. The journal is not re-encrypted and the data
 * key does not change, so this stays instant no matter how big the book is.
 */
export async function setPassword(newPassword) {
  if (!session) throw new Error('No profile is unlocked.');
  if (!newPassword || newPassword.length < 8) throw new Error('Password must be at least 8 characters.');
  const list = listProfiles();
  const profile = list.find((p) => p.id === session.profile.id);
  if (!profile) throw new Error('That profile no longer exists.');
  profile.password = await wrapDataKey(session.dataKey, newPassword);
  saveProfiles(list);
}

/** Issue a fresh recovery key, invalidating the old one. */
export async function resetRecoveryKey() {
  if (!session) throw new Error('No profile is unlocked.');
  const list = listProfiles();
  const profile = list.find((p) => p.id === session.profile.id);
  if (!profile) throw new Error('That profile no longer exists.');
  const recoveryKey = generateRecoveryKey();
  profile.recovery = await wrapDataKey(session.dataKey, normalizeRecoveryKey(recoveryKey));
  saveProfiles(list);
  return recoveryKey;
}

export function currentProfile() {
  return session ? session.profile : null;
}

export function isUnlocked() {
  return !!session;
}

/** Drop the data key. Everything on disk stays encrypted. */
export function lock() {
  session = null;
}

/** Decrypt this profile's journal. Null means the vault is missing or corrupt. */
export async function readVault() {
  if (!session) return null;
  const sealed = readJson(VAULT_PREFIX + session.profile.id, null);
  if (!sealed) return emptyJournal();
  return decryptJson(sealed, session.dataKey);
}

async function writeVault(profileId, dataKey, journal) {
  const sealed = await encryptJson(journal, dataKey);
  writeJson(VAULT_PREFIX + profileId, sealed);
}

/** Encrypt and persist the whole journal for the unlocked profile. */
export async function saveVault(journal) {
  if (!session) return false;
  await writeVault(session.profile.id, session.dataKey, journal);
  return true;
}

/**
 * Delete a profile and its vault. Irreversible — the caller must confirm.
 * Locking first prevents the app carrying on with a key to something gone.
 */
export function deleteProfile(id) {
  saveProfiles(listProfiles().filter((p) => p.id !== id));
  try { localStorage.removeItem(VAULT_PREFIX + id); } catch { /* already gone */ }
  if (session && session.profile.id === id) lock();
}
