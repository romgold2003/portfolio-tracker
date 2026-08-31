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
  generateAuthSalt, deriveAuthSecret, toBase64, fromBase64,
} from './crypto.js';
import * as cloud from '../services/cloud.js';

const PROFILES_KEY = 'pt_profiles';
const VAULT_PREFIX = 'pt_vault_';

/** Set only while a profile is unlocked. Never persisted. */
let session = null;

/**
 * When this deployment is cloud-backed, the journal lives on the server and the
 * same account opens on any device. The functions below keep their signatures
 * either way, so the sign-in screen and the boot sequence do not have to know
 * which mode they are in — only this module does.
 */
function inCloud() {
  return cloud.cloudEnabled();
}

/**
 * The data key, held for the life of the tab.
 *
 * It cannot be recomputed without the password, so without this a refresh would
 * throw the user back to the sign-in screen even though their session cookie is
 * still perfectly valid. sessionStorage is the right shelf for it: cleared when
 * the tab closes, never shared with another tab's origin, and never written to
 * disk the way localStorage is. Closing the browser still means typing the
 * password again, which is the intended trade.
 */
const KEY_CACHE = 'pt_session_key';

function cacheDataKey(dataKey) {
  try { sessionStorage.setItem(KEY_CACHE, toBase64(dataKey)); } catch { /* private mode */ }
}

function cachedDataKey() {
  try {
    const raw = sessionStorage.getItem(KEY_CACHE);
    return raw ? fromBase64(raw) : null;
  } catch {
    return null;
  }
}

function dropCachedDataKey() {
  try { sessionStorage.removeItem(KEY_CACHE); } catch { /* nothing to drop */ }
}

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
  if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.');

  if (inCloud()) return createCloudProfile(address, password, initialJournal);

  if (profileExists(address)) throw new Error('An account already exists for that email on this computer.');

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

/**
 * Everything a cloud sign-up does, in the order it has to happen.
 *
 * The data key is generated here and wrapped here. What travels is two wrappers
 * the server cannot open, two secrets derived under salts used for nothing else,
 * and the journal already encrypted. If this function is ever changed to send
 * the password or the data key, the encryption stops meaning anything.
 */
async function createCloudProfile(address, password, initialJournal) {
  const recoveryKey = generateRecoveryKey();
  const normalizedRecovery = normalizeRecoveryKey(recoveryKey);
  const dataKey = generateDataKey();
  const authSalt = generateAuthSalt();
  const recoverySalt = generateAuthSalt();

  /**
   * On a deployment that can send mail, a copy of the data key goes with the
   * signup so that a reset link has something to give back. On one that cannot,
   * it is left out entirely and the recovery key is the only way in.
   *
   * The recovery wrapper is made either way. It costs one PBKDF2 derivation and
   * it means an account is never left with no route back if mail is turned off
   * later — the key can be reissued from Settings while the user is signed in.
   */
  const escrowDataKey = cloud.emailResetEnabled() ? toBase64(dataKey) : undefined;

  let response;
  try {
    response = await cloud.signup({
      email: address,
      authSalt,
      recoverySalt,
      authSecret: await deriveAuthSecret(password, authSalt),
      recoverySecret: await deriveAuthSecret(normalizedRecovery, recoverySalt),
      passwordWrapper: await wrapDataKey(dataKey, password),
      recoveryWrapper: await wrapDataKey(dataKey, normalizedRecovery),
      vault: await encryptJson(initialJournal ?? emptyJournal(), dataKey),
      escrowDataKey,
    });
  } catch (err) {
    throw new Error(err.status === 409
      ? 'An account already exists for that email.'
      : err.message);
  }

  session = { profile: response.user, dataKey, version: response.vaultVersion };
  cacheDataKey(dataKey);
  return { profile: response.user, recoveryKey };
}

/**
 * Ask for a reset link. Resolves the same way whether or not the address is
 * known here, because the server declines to say.
 */
export function requestPasswordReset(email) {
  return cloud.forgotPassword(normalizeEmail(email));
}

/** Is there a reset token in the address bar? Returns it, or null. */
export function resetTokenInUrl() {
  try {
    const token = new URL(window.location.href).searchParams.get('reset');
    return token || null;
  } catch {
    return null;
  }
}

/**
 * Take the token from a reset link and a new password, and end up signed in.
 *
 * The key comes back from the server, is rewrapped here under the new password,
 * and only the wrapper goes back — the new password itself never leaves. That
 * is a smaller claim than the app used to make, and it is the true one: the
 * server held the key all along, which is what made the link possible.
 */
export async function completePasswordReset(token, newPassword) {
  const opened = await cloud.openReset(token);
  const dataKey = fromBase64(opened.dataKey);
  const authSalt = generateAuthSalt();

  const response = await cloud.commitReset({
    token,
    authSalt,
    authSecret: await deriveAuthSecret(newPassword, authSalt),
    passwordWrapper: await wrapDataKey(dataKey, newPassword),
    dataKey: opened.dataKey,
  });

  session = {
    profile: response.user,
    dataKey,
    version: response.vaultVersion ?? 0,
    blob: response.vault ?? null,
  };
  cacheDataKey(dataKey);
  return session;
}

/**
 * Find an account by the address someone typed at the login screen.
 *
 * In cloud mode there is no local list to search and asking the server would
 * leak which addresses have accounts, so a stub is returned and the address is
 * proved or disproved by the sign-in attempt itself.
 */
export function findByEmail(email) {
  const wanted = normalizeEmail(email);
  if (inCloud()) return wanted ? { id: wanted, email: wanted } : null;
  return listProfiles().find((p) => p.email === wanted) ?? null;
}

/** True when accounts live on a server rather than in this browser. */
export function cloudMode() {
  return inCloud();
}

export function emptyJournal() {
  return { positions: [], cash: 0, snapshots: [], priceLog: {}, apiKey: '' };
}

/** Try a password. Returns the profile and data key, or null. */
export async function unlockWithPassword(id, password) {
  if (inCloud()) return unlockFromCloud(id, password, 'password');
  const profile = listProfiles().find((p) => p.id === id);
  if (!profile) return null;
  const dataKey = await unwrapDataKey(profile.password, password);
  if (!dataKey) return null;
  session = { profile, dataKey };
  return session;
}

/** Try a recovery key. Accepts any spacing or casing the user typed. */
export async function unlockWithRecoveryKey(id, recoveryKey) {
  if (inCloud()) return unlockFromCloud(id, normalizeRecoveryKey(recoveryKey), 'recovery');
  const profile = listProfiles().find((p) => p.id === id);
  if (!profile) return null;
  const dataKey = await unwrapDataKey(profile.recovery, normalizeRecoveryKey(recoveryKey));
  if (!dataKey) return null;
  session = { profile, dataKey };
  return session;
}

/**
 * Sign in against the server, then open the vault here.
 *
 * Two steps, and the split is the interesting part. The server decides whether
 * to hand over the ciphertext — that is what the derived secret proves — but it
 * is this side, with the secret the user actually typed, that turns the wrapper
 * into a data key. A server that answered "yes" to everything would still not
 * be able to produce a readable journal.
 *
 * Returns null for a wrong secret, matching the local path, so the sign-in
 * screen shows the same message however the app is deployed.
 */
async function unlockFromCloud(email, secret, kind) {
  const salts = await cloud.begin(email);
  const salt = kind === 'recovery' ? salts.recoverySalt : salts.authSalt;
  const derived = await deriveAuthSecret(secret, salt);

  let response;
  try {
    response = kind === 'recovery'
      ? await cloud.recover(email, derived)
      : await cloud.login(email, derived);
  } catch (err) {
    if (err.status === 401) return null;
    throw err;
  }

  const wrapper = kind === 'recovery'
    ? response.user.recoveryWrapper
    : response.user.passwordWrapper;
  const dataKey = await unwrapDataKey(wrapper, secret);
  // The server accepted the secret but the wrapper will not open with it, which
  // should be impossible. Failing closed beats loading an empty journal over a
  // real one.
  if (!dataKey) return null;

  session = {
    profile: response.user,
    dataKey,
    version: response.vaultVersion ?? 0,
    blob: response.vault ?? null,
  };
  cacheDataKey(dataKey);
  backfillEscrow(response, dataKey);
  return session;
}

/**
 * Give the server a copy of the key, once, for an account made before reset
 * links were switched on.
 *
 * Otherwise the feature would only ever work for people who signed up after it
 * was turned on, and the person who turned it on would be the first to find
 * their own account still could not be reset.
 *
 * Deliberately not awaited. It is a convenience for a future forgotten
 * password, and nothing about signing in now should wait on it or fail with it.
 */
function backfillEscrow(response, dataKey) {
  if (!cloud.emailResetEnabled() || response.escrowed) return;
  cloud.depositEscrow(toBase64(dataKey)).catch(() => {});
}

/**
 * Pick up a session the cookie says is still valid.
 *
 * Called at boot. The cookie proves who you are but carries no data key, so
 * this only succeeds while the tab's cached key is still around — otherwise the
 * password is needed again, which is the correct outcome and not a bug.
 */
export async function resumeCloudSession() {
  if (!inCloud()) return null;
  const dataKey = cachedDataKey();
  if (!dataKey) return null;

  let response;
  try {
    response = await cloud.currentSession();
  } catch {
    return null;
  }
  if (!response?.user) { dropCachedDataKey(); return null; }

  // Prove the cached key actually opens this vault before trusting it.
  if (response.vault && !await decryptJson(response.vault, dataKey)) {
    dropCachedDataKey();
    return null;
  }

  session = {
    profile: response.user,
    dataKey,
    version: response.vaultVersion ?? 0,
    blob: response.vault ?? null,
  };
  return session;
}

/**
 * Replace the password wrapper. The journal is not re-encrypted and the data
 * key does not change, so this stays instant no matter how big the book is.
 */
export async function setPassword(newPassword) {
  if (!session) throw new Error('No profile is unlocked.');
  if (!newPassword || newPassword.length < 8) throw new Error('Password must be at least 8 characters.');

  if (inCloud()) {
    const authSalt = generateAuthSalt();
    await cloud.changePassword({
      authSalt,
      authSecret: await deriveAuthSecret(newPassword, authSalt),
      passwordWrapper: await wrapDataKey(session.dataKey, newPassword),
    });
    session.profile = {
      ...session.profile,
      passwordWrapper: await wrapDataKey(session.dataKey, newPassword),
    };
    return;
  }

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

/**
 * Drop the data key. Everything stored stays encrypted.
 *
 * In cloud mode the server session is ended too, and the cached key goes first
 * — if the network call fails, the key must still be gone from this browser.
 */
export function lock() {
  const wasCloud = inCloud() && session;
  session = null;
  dropCachedDataKey();
  if (wasCloud) cloud.logout().catch(() => { /* the local key is already gone */ });
}

/** Decrypt this profile's journal. Null means the vault is missing or corrupt. */
export async function readVault() {
  if (!session) return null;
  if (inCloud()) {
    if (!session.blob) return emptyJournal();
    return decryptJson(session.blob, session.dataKey);
  }
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
  if (inCloud()) return saveVaultToCloud(journal);
  await writeVault(session.profile.id, session.dataKey, journal);
  return true;
}

/**
 * Push the journal to the server.
 *
 * A refused save means another device saved since this one loaded. The server
 * cannot merge — it cannot read either version — so the choice is made here,
 * and it is deliberately the cautious one: the newer version wins and this
 * device reloads it, rather than this device's copy overwriting trades entered
 * somewhere else. Throwing tells the caller the save did not happen.
 */
async function saveVaultToCloud(journal, retriesLeft = 1) {
  const blob = await encryptJson(journal, session.dataKey);
  const result = await cloud.putVault(blob, session.version);

  if (result.ok) {
    session.blob = blob;
    session.version = result.version;
    return true;
  }

  if (result.conflict) {
    // Adopt the version the server actually holds, then try once more.
    //
    // Almost every conflict seen in practice is this tab's own doing — a second
    // save that set off before the first landed, carrying a version number that
    // was already stale by the time it arrived. Refusing outright meant the
    // app announced a clash between devices for what was really a race with
    // itself, and then never saved again because the version stayed behind.
    //
    // A single retry settles that case. A conflict that survives the retry is a
    // real one: another device is genuinely writing, and the caller is told so
    // rather than being allowed to overwrite work it cannot see.
    session.version = result.version;
    if (retriesLeft > 0) return saveVaultToCloud(journal, retriesLeft - 1);

    session.blob = result.vault;
    throw Object.assign(
      new Error('Your journal was changed on another device.'),
      { conflict: true },
    );
  }
  return false;
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

/**
 * Delete the account that is currently open, wherever it lives.
 *
 * The password is required again rather than relying on the open session. This
 * is the only action in the app that destroys data nothing can restore: there
 * is no copy on the server that anyone can read, so a mistake here is final.
 *
 * Throws with a readable message on a wrong password, so the caller can say so
 * without deleting anything.
 */
export async function deleteCurrentAccount(password) {
  if (!session) throw new Error('No account is open.');
  if (!password) throw new Error('Enter your password to confirm.');

  if (inCloud()) {
    const email = session.profile.email;
    const { authSalt } = await cloud.begin(email);
    try {
      await cloud.deleteAccount(await deriveAuthSecret(password, authSalt));
    } catch (err) {
      throw new Error(err.status === 401 ? 'That password is not right.' : err.message);
    }
    session = null;
    dropCachedDataKey();
    return;
  }

  // Locally the password has to be checked here, since there is no server to
  // ask — and it must be checked before anything is removed.
  const profile = listProfiles().find((p) => p.id === session.profile.id);
  if (!profile) throw new Error('That account no longer exists.');
  if (!await unwrapDataKey(profile.password, password)) {
    throw new Error('That password is not right.');
  }
  deleteProfile(profile.id);
}
