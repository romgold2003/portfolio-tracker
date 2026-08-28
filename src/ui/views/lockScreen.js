/**
 * The password screen.
 *
 * Three states, decided entirely by what is already in storage:
 *   - no password set yet  -> offer to set one, or skip
 *   - password set, locked -> ask for it, with a way in via the recovery key
 *   - just set a password  -> show the recovery key once
 *
 * Everything happens on this machine. Nothing is sent anywhere, which is also
 * why a forgotten password is recovered with a key rather than a reset link.
 */
import {
  isLocked, setUpLock, unlockWithPassword, unlockWithRecoveryKey,
  changePassword, MIN_PASSWORD_LENGTH,
} from '../../core/vault.js';
import { cryptoAvailable } from '../../core/crypto.js';
import { escapeHtml } from '../format.js';

const HOST_ID = 'lockScreen';

/** 'unlock' | 'setup' | 'recover' | 'recoveryKey' */
let mode = 'unlock';
let issuedRecoveryKey = null;
let onUnlocked = () => {};
/** The journal to lock up, when a password is being set for the first time. */
let journalToProtect = null;

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

function unlockForm() {
  return `
    <h1 class="lock-title">Enter your password</h1>
    <p class="lock-sub">Your journal is encrypted on this device.</p>
    <div class="lock-field">
      <label for="lockPassword">Password</label>
      <input type="password" id="lockPassword" autocomplete="current-password" placeholder="Your password">
    </div>
    <div id="lockError" class="lock-error"></div>
    <button class="btn btn-blue lock-submit" id="lockSubmit" data-label="Unlock">Unlock</button>
    <div class="lock-links">
      <button class="lock-link" data-mode="recover">Forgot password</button>
    </div>`;
}

/**
 * Skipping is offered deliberately. The app is shared as a link, and someone
 * who just wants to look at it should not be made to invent a password first.
 */
function setupForm() {
  return `
    <h1 class="lock-title">Protect your journal</h1>
    <p class="lock-sub">Set a password and everything you record is encrypted on this device. It is never sent anywhere.</p>
    <div class="lock-field">
      <label for="lockPassword">Password</label>
      <input type="password" id="lockPassword" autocomplete="new-password" placeholder="At least ${MIN_PASSWORD_LENGTH} characters">
    </div>
    <div class="lock-field">
      <label for="lockPassword2">Confirm password</label>
      <input type="password" id="lockPassword2" autocomplete="new-password" placeholder="Type it again">
    </div>
    <div id="lockError" class="lock-error"></div>
    <button class="btn btn-blue lock-submit" id="lockSubmit" data-label="Set password">Set password</button>
    <div class="lock-links">
      <button class="lock-link" id="lockSkip">Skip for now</button>
    </div>`;
}

function recoverForm() {
  return `
    <h1 class="lock-title">Forgot password</h1>
    <p class="lock-sub">There is no email reset — this app has no server. Use the recovery key you were shown when you set the password.</p>
    <div class="lock-field">
      <label for="lockRecovery">Recovery key</label>
      <input type="text" id="lockRecovery" placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-X" spellcheck="false">
    </div>
    <div class="lock-field">
      <label for="lockPassword">New password</label>
      <input type="password" id="lockPassword" autocomplete="new-password" placeholder="At least ${MIN_PASSWORD_LENGTH} characters">
    </div>
    <div id="lockError" class="lock-error"></div>
    <button class="btn btn-blue lock-submit" id="lockSubmit" data-label="Unlock and set new password">Unlock and set new password</button>
    <div class="lock-links">
      <button class="lock-link" data-mode="unlock">Back</button>
    </div>`;
}

/**
 * Shown once. This is the only time the recovery key is readable anywhere, so
 * the screen will not move on until the box is ticked.
 */
function recoveryKeyScreen() {
  return `
    <h1 class="lock-title">Save your recovery key</h1>
    <p class="lock-sub">This is the <strong>only</strong> way back in if you forget your password. It is shown once and cannot be retrieved later.</p>
    <div class="lock-key" id="lockKeyText">${escapeHtml(issuedRecoveryKey)}</div>
    <div class="lock-links" style="margin:10px 0 16px">
      <button class="lock-link" id="lockCopyKey">Copy to clipboard</button>
      <button class="lock-link" id="lockDownloadKey">Download as file</button>
    </div>
    <div class="lock-note lock-note-warn">
      Put it in a password manager, or print it. If you lose both this key and
      your password, nobody can open this journal — not you, and not whoever
      wrote the app.
    </div>
    <label class="lock-check">
      <input type="checkbox" id="lockKeySaved"> I have saved my recovery key
    </label>
    <div id="lockError" class="lock-error"></div>
    <button class="btn btn-blue lock-submit" id="lockSubmit" data-label="Continue">Continue</button>`;
}

/**
 * Web Crypto needs a secure page. https and localhost qualify, and so does a
 * file opened directly in Chrome — but not every way of opening one does, and
 * finding out after typing a password twice wastes the user's time.
 */
function unsupportedScreen() {
  return `
    <h1 class="lock-title">Passwords are not available here</h1>
    <p class="lock-sub">This page cannot reach the browser's encryption, so a password could not actually protect anything.</p>
    <div class="lock-note lock-note-warn"><strong>Your journal is fine</strong> — nothing has been changed or deleted.</div>
    <div class="lock-note">
      Open the app from <code>https://</code>, from <code>localhost</code>, or by
      double-clicking the file in Chrome, and the option comes back.
    </div>
    <button class="btn btn-blue lock-submit" id="lockSubmit" data-label="Continue without a password">Continue without a password</button>`;
}

function render() {
  const container = host();
  if (!container) return;

  const body = !cryptoAvailable() ? unsupportedScreen()
    : mode === 'setup' ? setupForm()
      : mode === 'recover' ? recoverForm()
        : mode === 'recoveryKey' ? recoveryKeyScreen()
          : unlockForm();

  container.innerHTML = `<div class="lock-card">${body}</div>`;
  container.style.display = 'flex';
  wire();
}

function wire() {
  host().querySelectorAll('.lock-link[data-mode]').forEach((button) => {
    button.addEventListener('click', () => { mode = button.dataset.mode; render(); });
  });
  el('lockSubmit')?.addEventListener('click', handleSubmit);
  el('lockSkip')?.addEventListener('click', () => finish());
  el('lockCopyKey')?.addEventListener('click', copyKey);
  el('lockDownloadKey')?.addEventListener('click', downloadKey);
  host().querySelectorAll('input').forEach((input) => {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSubmit(); });
  });
  el('lockPassword')?.focus();
}

function copyKey() {
  navigator.clipboard?.writeText(issuedRecoveryKey).then(
    () => setError(''),
    () => setError('Could not copy. Select the key and copy it by hand.'),
  );
}

function downloadKey() {
  const text = 'Portfolio Tracker recovery key\n'
    + `Key: ${issuedRecoveryKey}\n\n`
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
    if (!cryptoAvailable()) return finish();
    if (mode === 'setup') return await doSetup();
    if (mode === 'recover') return await doRecover();
    if (mode === 'recoveryKey') return doFinishSetup();
    return await doUnlock();
  } catch (err) {
    busy(false);
    setError(err.message || String(err));
    return undefined;
  }
}

async function doUnlock() {
  const password = el('lockPassword').value;
  if (!password) throw new Error('Enter your password.');
  busy(true, 'Unlocking…');
  if (!await unlockWithPassword(password)) {
    busy(false);
    throw new Error('Wrong password.');
  }
  await finish();
}

async function doSetup() {
  const password = el('lockPassword').value;
  const confirm = el('lockPassword2').value;
  if (password !== confirm) throw new Error('The two passwords do not match.');
  busy(true, 'Encrypting…');
  issuedRecoveryKey = await setUpLock(password, journalToProtect);
  mode = 'recoveryKey';
  render();
}

async function doRecover() {
  const key = el('lockRecovery').value;
  const password = el('lockPassword').value;
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  busy(true, 'Checking key…');
  if (!await unlockWithRecoveryKey(key)) {
    busy(false);
    throw new Error('That recovery key does not match this journal.');
  }
  await changePassword(password);
  await finish();
}

function doFinishSetup() {
  if (!el('lockKeySaved').checked) throw new Error('Tick the box once you have saved the key.');
  issuedRecoveryKey = null;
  finish();
}

async function finish() {
  host().style.display = 'none';
  host().innerHTML = '';
  mode = 'unlock';
  await onUnlocked();
}

/** Ask for the password, or offer to set one. */
export function showLockScreen({ onUnlock, journal, forceSetup } = {}) {
  if (onUnlock) onUnlocked = onUnlock;
  journalToProtect = journal ?? null;
  mode = (forceSetup || !isLocked()) ? 'setup' : 'unlock';
  issuedRecoveryKey = null;
  render();
}
