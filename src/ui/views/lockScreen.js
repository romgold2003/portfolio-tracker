/**
 * The sign-in screen.
 *
 * Everything here happens on this machine. The email is an identifier, never a
 * channel: no mail is sent, nothing is verified, and a forgotten password is
 * recovered with the key issued at sign-up rather than a reset link.
 *
 * The screen renders itself into a single container and owns its own small
 * amount of view state, because none of it survives an unlock.
 */
import {
  listProfiles, findByEmail, createProfile, unlockWithPassword,
  unlockWithRecoveryKey, setPassword, looksLikeEmail, cloudMode,
  requestPasswordReset, completePasswordReset, resetTokenInUrl,
} from '../../core/profiles.js';
import { cryptoAvailable } from '../../core/crypto.js';
import { emailResetEnabled } from '../../services/cloud.js';
import { escapeHtml } from '../format.js';
import { setSigninHero } from '../../features/signinHero.js';

const HOST_ID = 'lockScreen';

/** 'signin' | 'create' | 'recover' | 'recoveryKey' | 'forgot' | 'sent' | 'reset' */
let mode = 'signin';
let issuedRecoveryKey = null;
let pendingEmail = '';
/** The token from a reset link, once one has been found in the address bar. */
let resetToken = null;
/** Set by init(): what to run once a profile is open. */
let onUnlocked = () => {};
/** Set by init(): the plaintext journal to absorb, if there is one. */
let legacyJournal = null;

const el = (id) => document.getElementById(id);
const host = () => document.getElementById(HOST_ID);

function setError(message) {
  const box = el('lockError');
  if (!box) return;
  box.textContent = message || '';
  box.style.display = message ? 'block' : 'none';
}

function busy(on, label) {
  const button = el('lockSubmit');
  if (!button) return;
  button.disabled = on;
  button.textContent = on ? (label || 'Working…') : button.dataset.label;
}

/** The one-time notice that an existing journal will be absorbed. */
function migrationNotice() {
  if (!legacyJournal) return '';
  const n = legacyJournal.positions.length;
  return `<div class="lock-note">
    <strong>${n} position${n === 1 ? '' : 's'} already on this computer.</strong>
    They will be moved into this account and encrypted. Nothing is lost.
  </div>`;
}

/**
 * What the sign-in screen claims about privacy, kept honest.
 *
 * The old line — encrypted before it leaves this device — was true while the
 * recovery key was the only way back in. Once the server holds a copy of the
 * data key so that a reset link can work, it is not, and a screen that goes on
 * saying it would be lying to make itself sound better. What is still true is
 * that the journal is encrypted in transit and at rest, and that the password
 * itself never leaves.
 */
function signinBlurb() {
  if (!cloudMode()) return 'Your journal is encrypted on this computer.';
  return emailResetEnabled()
    ? 'Sign in from any device. Your journal is encrypted, and your password never leaves this one.'
    : 'Sign in from any device. Your journal is encrypted before it leaves this one.';
}

function signinForm() {
  const accounts = listProfiles();
  return `
    <h1 class="lock-title">Sign in</h1>
    <p class="lock-sub">${signinBlurb()}</p>
    <div class="lock-field">
      <label for="lockEmail">Email</label>
      <input type="email" id="lockEmail" autocomplete="username" placeholder="you@example.com" value="${escapeHtml(pendingEmail)}">
    </div>
    <div class="lock-field">
      <label for="lockPassword">Password</label>
      <input type="password" id="lockPassword" autocomplete="current-password" placeholder="Your password">
    </div>
    <div id="lockError" class="lock-error"></div>
    <button class="btn btn-blue lock-submit" id="lockSubmit" data-label="Sign in">Sign in</button>
    <div class="lock-links">
      <button class="lock-link" data-mode="create">Create an account</button>
      ${forgotLink(accounts.length)}
    </div>`;
}

/**
 * Where "Forgot password" goes depends on what this deployment can do: to the
 * email form where mail is configured, to the recovery-key form otherwise.
 */
function forgotLink(accountCount) {
  if (emailResetEnabled()) return '<button class="lock-link" data-mode="forgot">Forgot password</button>';
  if (cloudMode() || accountCount) return '<button class="lock-link" data-mode="recover">Forgot password</button>';
  return '';
}

function forgotForm() {
  return `
    <h1 class="lock-title">Forgot password</h1>
    <p class="lock-sub">Enter your email and we will send you a link to choose a new password.</p>
    <div class="lock-field">
      <label for="lockEmail">Email</label>
      <input type="email" id="lockEmail" autocomplete="username" placeholder="you@example.com" value="${escapeHtml(pendingEmail)}">
    </div>
    <div id="lockError" class="lock-error"></div>
    <button class="btn btn-blue lock-submit" id="lockSubmit" data-label="Send reset link">Send reset link</button>
    <div class="lock-links">
      <button class="lock-link" data-mode="signin">Back to sign in</button>
      <button class="lock-link" data-mode="recover">Use a recovery key instead</button>
    </div>`;
}

/**
 * Deliberately says "if there is an account" rather than "sent".
 *
 * The server will not confirm whether an address is registered, and a screen
 * that says "check your inbox" would answer that question on its behalf.
 */
function sentScreen() {
  return `
    <h1 class="lock-title">Check your email</h1>
    <p class="lock-sub">If there is an account for
      <strong>${escapeHtml(pendingEmail)}</strong>, a link to choose a new password
      is on its way. It works once and expires in 45 minutes.</p>
    <div class="lock-note">
      Nothing arriving? Look in spam, and check the address above is the one you
      signed up with.
    </div>
    <div class="lock-links">
      <button class="lock-link" data-mode="signin">Back to sign in</button>
      <button class="lock-link" data-mode="forgot">Send it again</button>
    </div>`;
}

/** Reached by following a link from the email, never from inside the app. */
function resetForm() {
  return `
    <h1 class="lock-title">Choose a new password</h1>
    <p class="lock-sub">Your journal is unchanged. This only sets the password that opens it.</p>
    <div class="lock-field">
      <label for="lockPassword">New password</label>
      <input type="password" id="lockPassword" autocomplete="new-password" placeholder="At least 8 characters">
    </div>
    <div class="lock-field">
      <label for="lockPassword2">Confirm password</label>
      <input type="password" id="lockPassword2" autocomplete="new-password" placeholder="Type it again">
    </div>
    <div id="lockError" class="lock-error"></div>
    <button class="btn btn-blue lock-submit" id="lockSubmit" data-label="Set password and sign in">Set password and sign in</button>
    <div class="lock-links">
      <button class="lock-link" data-mode="signin">Cancel</button>
    </div>`;
}

function createForm() {
  return `
    <h1 class="lock-title">Create an account</h1>
    <p class="lock-sub">${!cloudMode()
      ? 'Stays on this computer. Nothing is sent anywhere.'
      : emailResetEnabled()
        ? 'Encrypted on this device before it is stored. Forget your password and you can reset it by email.'
        : 'Encrypted on this device before it is stored, so only your password opens it.'}</p>
    ${migrationNotice()}
    <div class="lock-field">
      <label for="lockEmail">Email</label>
      <input type="email" id="lockEmail" autocomplete="username" placeholder="you@example.com" value="${escapeHtml(pendingEmail)}">
    </div>
    <div class="lock-field">
      <label for="lockPassword">Password</label>
      <input type="password" id="lockPassword" autocomplete="new-password" placeholder="At least 8 characters">
    </div>
    <div class="lock-field">
      <label for="lockPassword2">Confirm password</label>
      <input type="password" id="lockPassword2" autocomplete="new-password" placeholder="Type it again">
    </div>
    <div id="lockError" class="lock-error"></div>
    <button class="btn btn-blue lock-submit" id="lockSubmit" data-label="Create account">Create account</button>
    <div class="lock-links">
      <button class="lock-link" data-mode="signin">I already have an account</button>
    </div>`;
}

function recoverForm() {
  return `
    <h1 class="lock-title">Forgot password</h1>
    <p class="lock-sub">${emailResetEnabled()
      ? 'For an account made before reset links existed, or if the email never arrives. Use the recovery key you saved at sign-up.'
      : cloudMode()
        ? 'There is no email reset: the server cannot read your journal, so it cannot let you back in. Use the recovery key you saved at sign-up.'
        : 'There is no email reset — this app has no server. Use the recovery key you were given when you signed up.'}</p>
    <div class="lock-field">
      <label for="lockEmail">Email</label>
      <input type="email" id="lockEmail" autocomplete="username" placeholder="you@example.com" value="${escapeHtml(pendingEmail)}">
    </div>
    <div class="lock-field">
      <label for="lockRecovery">Recovery key</label>
      <input type="text" id="lockRecovery" placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-X" spellcheck="false">
    </div>
    <div class="lock-field">
      <label for="lockPassword">New password</label>
      <input type="password" id="lockPassword" autocomplete="new-password" placeholder="At least 8 characters">
    </div>
    <div id="lockError" class="lock-error"></div>
    <button class="btn btn-blue lock-submit" id="lockSubmit" data-label="Unlock and set new password">Unlock and set new password</button>
    <div class="lock-links">
      <button class="lock-link" data-mode="signin">Back to sign in</button>
    </div>`;
}

/**
 * Shown once, immediately after sign-up. This is the only time the recovery key
 * exists in readable form anywhere, so the screen refuses to move on until the
 * user has ticked that they saved it.
 */
function recoveryKeyScreen() {
  return `
    <h1 class="lock-title">Save your recovery key</h1>
    <p class="lock-sub">This is the <strong>only</strong> way back in if you forget your password. It is shown once and cannot be recovered later.</p>
    <div class="lock-key" id="lockKeyText">${escapeHtml(issuedRecoveryKey)}</div>
    <div class="lock-links" style="margin:10px 0 16px">
      <button class="lock-link" id="lockCopyKey">Copy to clipboard</button>
      <button class="lock-link" id="lockDownloadKey">Download as file</button>
    </div>
    <div class="lock-note lock-note-warn">
      Put it in a password manager, or print it. If you lose both this key and
      your password, the journal in this account cannot be opened by anyone,
      including me.
    </div>
    <label class="lock-check">
      <input type="checkbox" id="lockKeySaved"> I have saved my recovery key
    </label>
    <div id="lockError" class="lock-error"></div>
    <button class="btn btn-blue lock-submit" id="lockSubmit" data-label="Continue">Continue</button>`;
}

/**
 * Encryption needs a secure context. Chrome treats file:// as trustworthy, so
 * the standalone build works, but some browsers and some ways of opening a file
 * do not — and finding that out only after typing a password twice is a waste
 * of the user's time. Say so up front instead.
 */
function unsupportedScreen() {
  return `
    <h1 class="lock-title">This browser cannot encrypt here</h1>
    <p class="lock-sub">Accounts need the Web Crypto API, which this page does not have access to.</p>
    <div class="lock-note lock-note-warn">
      <strong>Your data is safe</strong> — nothing has been changed or deleted.
    </div>
    <div class="lock-note">
      This usually means the page was opened in a way the browser does not treat
      as secure. Two things that fix it:
      <br><br>
      1. Open the file directly from your computer in Chrome, rather than from
      inside another app or a preview pane.
      <br>
      2. Or run the served version: <code>npm start</code>, then open
      <code>http://localhost:4173</code>.
    </div>`;
}

function render() {
  const container = host();
  if (!container) return;
  if (!cryptoAvailable()) {
    container.innerHTML = `<div class="lock-card">${unsupportedScreen()}</div>`;
    container.style.display = 'flex';
    setSigninHero(true);
    return;
  }
  const screens = {
    create: createForm,
    recover: recoverForm,
    recoveryKey: recoveryKeyScreen,
    forgot: forgotForm,
    sent: sentScreen,
    reset: resetForm,
  };
  const body = (screens[mode] ?? signinForm)();

  container.innerHTML = `<div class="lock-card">${body}</div>`;
  container.style.display = 'flex';
  setSigninHero(true);
  wire();
}

function wire() {
  host().querySelectorAll('.lock-link[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      pendingEmail = el('lockEmail')?.value ?? pendingEmail;
      mode = button.dataset.mode;
      render();
    });
  });

  const submit = el('lockSubmit');
  if (submit) submit.addEventListener('click', handleSubmit);

  // Enter should submit from any field, which is what people expect from a login.
  host().querySelectorAll('input').forEach((input) => {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSubmit(); });
  });

  el('lockCopyKey')?.addEventListener('click', copyKey);
  el('lockDownloadKey')?.addEventListener('click', downloadKey);
  el('lockEmail')?.focus();
}

function copyKey() {
  navigator.clipboard?.writeText(issuedRecoveryKey).then(
    () => setError(''),
    () => setError('Could not copy. Select the key and copy it manually.'),
  );
}

function downloadKey() {
  const text = `Portfolio Tracker recovery key\nAccount: ${pendingEmail}\nKey: ${issuedRecoveryKey}\n\n`
    + 'Keep this somewhere safe. Without it, a forgotten password cannot be recovered.\n';
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'portfolio-tracker-recovery-key.txt';
  link.click();
  URL.revokeObjectURL(url);
}

async function handleSubmit() {
  setError('');
  try {
    if (mode === 'create') return await doCreate();
    if (mode === 'recover') return await doRecover();
    if (mode === 'recoveryKey') return doFinishSignup();
    if (mode === 'forgot') return await doForgot();
    if (mode === 'reset') return await doReset();
    return await doSignin();
  } catch (err) {
    busy(false);
    setError(err.message || String(err));
    return undefined;
  }
}

async function doSignin() {
  const email = el('lockEmail').value;
  const password = el('lockPassword').value;
  if (!email || !password) throw new Error('Enter your email and password.');

  const profile = findByEmail(email);
  // Same message either way: which addresses have accounts is not worth leaking.
  if (!profile) throw new Error('Wrong email or password.');

  busy(true, 'Unlocking…');
  const session = await unlockWithPassword(profile.id, password);
  if (!session) { busy(false); throw new Error('Wrong email or password.'); }
  await finish();
  return undefined;
}

async function doCreate() {
  const email = el('lockEmail').value;
  const password = el('lockPassword').value;
  const confirm = el('lockPassword2').value;
  if (!looksLikeEmail(email)) throw new Error('That does not look like an email address.');
  if (password !== confirm) throw new Error('The two passwords do not match.');

  busy(true, 'Creating…');
  const journal = legacyJournal
    ? { ...legacyJournal, priceLog: {} }
    : null;
  const { recoveryKey } = await createProfile(email, password, journal);
  pendingEmail = email;

  /**
   * The recovery-key screen only earns its place when it is the only way back.
   *
   * Where a forgotten password can be reset by email, stopping a new user to
   * make them write down a 26-character key protects against nothing they are
   * not already covered for, and it is the step most likely to make them give
   * up. The key still exists on the account; it is simply not something they
   * have to deal with on their first minute.
   */
  if (emailResetEnabled()) return finish();

  issuedRecoveryKey = recoveryKey;
  mode = 'recoveryKey';
  render();
  return undefined;
}

async function doRecover() {
  const email = el('lockEmail').value;
  const key = el('lockRecovery').value;
  const password = el('lockPassword').value;
  const profile = findByEmail(email);
  if (!profile) throw new Error('Enter the email address on the account.');
  if (!password || password.length < 8) throw new Error('New password must be at least 8 characters.');

  busy(true, 'Checking key…');
  const session = await unlockWithRecoveryKey(profile.id, key);
  if (!session) { busy(false); throw new Error('That recovery key does not match this account.'); }

  await setPassword(password);
  await finish();
}

async function doForgot() {
  const email = el('lockEmail').value;
  if (!looksLikeEmail(email)) throw new Error('That does not look like an email address.');

  busy(true, 'Sending…');
  await requestPasswordReset(email);
  pendingEmail = email;
  mode = 'sent';
  render();
}

/**
 * Finish the reset the link started.
 *
 * The token is cleared from the address bar on the way through, so that a
 * refresh, a bookmark or a shared screenshot of the URL is not a live way into
 * the account. It has been spent by then anyway; this is about not leaving it
 * lying around in browser history.
 */
async function doReset() {
  const password = el('lockPassword').value;
  const confirm = el('lockPassword2').value;
  if (!password || password.length < 8) throw new Error('New password must be at least 8 characters.');
  if (password !== confirm) throw new Error('The two passwords do not match.');

  busy(true, 'Setting password…');
  try {
    await completePasswordReset(resetToken, password);
  } catch (err) {
    busy(false);
    throw new Error(err.message || 'That reset link is no longer valid. Ask for a new one.');
  }
  resetToken = null;
  clearResetFromUrl();
  await finish();
}

function clearResetFromUrl() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('reset');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch { /* history is not essential; the token is spent either way */ }
}

function doFinishSignup() {
  if (!el('lockKeySaved').checked) throw new Error('Tick the box once you have saved the key.');
  issuedRecoveryKey = null;
  finish();
}

/** Hand control to the app. */
async function finish() {
  host().style.display = 'none';
  host().innerHTML = '';
  // Torn down rather than merely hidden: an animation loop behind an opaque
  // app is spent battery, and this runs on phones.
  setSigninHero(false);
  mode = 'signin';
  await onUnlocked();
}

/** Show the lock screen. Called at boot and again after signing out. */
export function showLockScreen({ onUnlock, legacy } = {}) {
  if (onUnlock) onUnlocked = onUnlock;
  legacyJournal = legacy ?? null;
  /**
   * No accounts yet, or a journal waiting to be adopted: start on sign-up.
   *
   * With a cloud behind the app, an empty browser says nothing about whether
   * the person has an account — that lives on the server, and every new device
   * starts out empty by definition. Defaulting to sign-up there would greet
   * every returning user with a form for making a second account. So the only
   * reason to open on sign-up in cloud mode is a local journal waiting to be
   * taken over.
   */
  mode = (cloudMode() ? !!legacyJournal : (!listProfiles().length || legacyJournal))
    ? 'create'
    : 'signin';

  /**
   * A reset link beats all of it. Someone arriving on ?reset=… has been sent
   * here by their own mailbox to do one thing, and any other screen — sign in,
   * or worse, sign up — is the app ignoring what they came for.
   */
  if (emailResetEnabled()) {
    resetToken = resetTokenInUrl();
    if (resetToken) mode = 'reset';
  }

  issuedRecoveryKey = null;
  render();
}
