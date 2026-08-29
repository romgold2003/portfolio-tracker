/**
 * The cloud, from the browser's side.
 *
 * This module is only ever a courier. Everything it sends is already encrypted
 * or already one-way — a wrapped data key, an auth secret, a block of AES-GCM
 * ciphertext — and everything it receives is still encrypted when it hands it
 * back. The password does not appear in this file, and neither does the data
 * key. That is the whole point, and it is worth keeping true as this grows.
 *
 * Whether there is a cloud at all is a property of the deployment, not a
 * setting: the same source is also a file you double-click and a static site
 * with no server behind it. So the app asks once, at boot, and falls back to
 * local accounts when the answer is no or the question cannot be reached.
 */

const BASE = '/api';

/** null until detectCloud() has run. */
let available = null;

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
  } catch {
    available = false;
  }
  return available;
}

export function cloudEnabled() {
  return available === true;
}

/** Test seam, and the way the app is forced local by a failed detection. */
export function setCloudEnabled(value) {
  available = value;
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
