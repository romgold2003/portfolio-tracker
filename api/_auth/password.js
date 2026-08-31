/**
 * Change the password on a signed-in account.
 *
 * The journal is not re-encrypted and the data key does not change — the client
 * simply rewraps the same key under the new password and sends the new wrapper.
 * That is what makes this instant no matter how large the book is.
 *
 * Every other session is destroyed on success, including on other devices. The
 * reason someone changes a password is usually that they think somebody else
 * knows the old one, and leaving that person's session alive would defeat the
 * entire exercise. The device doing the change gets a fresh cookie so it is not
 * signed out of its own account mid-edit.
 */
import {
  send, fail, methodIs, readJson, readCookies, setCookie, sameOrigin,
} from '../_lib/http.js';
import {
  userForToken, updateAuth, endAllSessions, startSession, isWrapper,
} from '../_lib/accounts.js';

const SESSION_COOKIE = 'pt_session';

export default async function handler(req, res) {
  if (!methodIs(req, res, 'POST')) return;
  if (!sameOrigin(req)) return fail(res, 403, 'Cross-origin request refused.');

  const user = await userForToken(readCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Not signed in.');

  const body = await readJson(req).catch(() => null);
  const { authSalt, authSecret, passwordWrapper } = body ?? {};
  const isSalt = (v) => typeof v === 'string' && v.length >= 16 && v.length <= 64;
  const isSecret = (v) => typeof v === 'string' && v.length >= 32 && v.length <= 128;
  if (!isSalt(authSalt) || !isSecret(authSecret) || !isWrapper(passwordWrapper)) {
    return fail(res, 400, 'Malformed request.');
  }

  await updateAuth(user.id, { authSalt, authSecret, passwordWrapper });
  await endAllSessions(user.id);

  const { token, maxAge } = await startSession(user.id);
  setCookie(res, SESSION_COOKIE, token, maxAge);
  send(res, 200, { ok: true });
}
