/**
 * The cloud, from the browser's side.
 *
 * This module is a courier. Almost everything it sends is already encrypted or
 * already one-way — a wrapped data key, an auth secret, a block of AES-GCM
 * ciphertext — and comes back still encrypted. The password never appears in
 * this file, and that part is worth keeping true as this grows.
 *
 * The data key does, in exactly two places: `signup` sends a copy for the
 * server to hold, and `openReset` receives it back. That is the price of being
 * able to reset a forgotten password from a link in an email, and it is a real
 * price — it means the server can decrypt journals, where before it could not.
 * The alternative was recovery keys, which is what a deployment without a mail
 * provider still gets. Nothing else here handles it.
 *
 * Whether there is a cloud at all is a property of the deployment, not a
 * setting: the same source is also a file you double-click and a static site
 * with no server behind it. So the app asks once, at boot, and falls back to
 * local accounts when the answer is no or the question cannot be reached.
 */

const BASE = '/api';

/** null until detectCloud() has run. */
let available = null;
/** Whether this deployment can reset a password by email. See detectCloud(). */
let emailReset = false;

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    // The session lives in an HttpOnly cookie, so it has to be sent explicitly.
    credentials: 'same-origin',
  });

  let payload = null;
  try { payload = await res.json(); } catch { /* empty or not JSON */ }

  if (!res.ok) {
    const error = new Error(payload?.error || `Request failed (${res.status})`);
    error.status = res.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

/**
 * Is this deployment cloud-backed?
 *
 * Any failure means no. A missing endpoint (the static build), a network that
 * is down, a server that is broken — in all of them the right move is the same:
 * carry on as a local app rather than block someone out of their own journal.
 */
export async function detectCloud() {
  if (available !== null) return available;
  try {
    const res = await fetch(`${BASE}/config`, { credentials: 'same-origin' });
    if (!res.ok) { available = false; return false; }
    const body = await res.json();
    available = !!body?.cloud;
    emailReset = !!body?.emailReset;
  } catch {
    available = false;
    emailReset = false;
  }
  return available;
}

export function cloudEnabled() {
  return available === true;
}

/**
 * Can a forgotten password be reset from a link in an email here?
 *
 * False on a deployment with no mail provider or no escrow secret, and on the
 * local and static builds, where the recovery key remains the only way back in.
 */
export function emailResetEnabled() {
  return available === true && emailReset === true;
}

/** Test seam, and the way the app is forced local by a failed detection. */
export function setCloudEnabled(value, reset = false) {
  available = value;
  emailReset = value ? reset : false;
}

/** The salts an account was created with. Answers for unknown addresses too. */
export function begin(email) {
  return request('/auth/begin', { method: 'POST', body: { email } });
}

export function signup(payload) {
  return request('/auth/signup', { method: 'POST', body: payload });
}

export function login(email, authSecret) {
  return request('/auth/login', { method: 'POST', body: { email, authSecret } });
}

export function recover(email, recoverySecret) {
  return request('/auth/recover', { method: 'POST', body: { email, recoverySecret } });
}

/**
 * Ask for a reset link.
 *
 * Always resolves, and always with the same message. The server will not say
 * whether the address has an account, so neither can this.
 */
export function forgotPassword(email) {
  return request('/auth/forgot', { method: 'POST', body: { email } });
}

/**
 * Hand the server a copy of the data key, for an account that predates reset
 * links. Needs a live session; the server will not give one back this way.
 */
export function depositEscrow(dataKey) {
  return request('/auth/escrow', { method: 'POST', body: { dataKey } });
}

/** Redeem a token from a reset link: proves it, and returns the data key. */
export function openReset(token) {
  return request('/auth/reset', { method: 'POST', body: { token, step: 'open' } });
}

/** Spend the token: sets the new password's derivations and signs in. */
export function commitReset(payload) {
  return request('/auth/reset', { method: 'POST', body: { ...payload, step: 'commit' } });
}

export function changePassword(payload) {
  return request('/auth/password', { method: 'POST', body: payload });
}

export function currentSession() {
  return request('/auth/session');
}

/** Irreversible. The caller is responsible for having asked twice. */
export function deleteAccount(authSecret) {
  return request('/account', { method: 'POST', body: { authSecret } });
}

export function logout() {
  return request('/auth/logout', { method: 'POST' });
}

export function fetchVault() {
  return request('/vault');
}

/**
 * Save the journal.
 *
 * A 409 means another device saved first. It is returned rather than thrown,
 * with the newer ciphertext attached, because the caller is the only thing that
 * can do anything about it — it holds the data key, and the server does not.
 */
export async function putVault(vault, baseVersion) {
  try {
    const body = await request('/vault', { method: 'PUT', body: { vault, baseVersion } });
    return { ok: true, version: body.vaultVersion };
  } catch (err) {
    if (err.status === 409) {
      return {
        ok: false,
        conflict: true,
        vault: err.payload?.vault ?? null,
        version: err.payload?.vaultVersion ?? 0,
      };
    }
    throw err;
  }
}
