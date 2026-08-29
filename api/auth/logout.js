/**
 * Sign out: delete the session server-side, then clear the cookie.
 *
 * In that order. Clearing only the cookie would leave a token that still works
 * for anyone who copied it.
 */
import {
  send, fail, methodIs, readCookies, clearCookie, sameOrigin,
} from '../_lib/http.js';
import { endSession } from '../_lib/accounts.js';

const SESSION_COOKIE = 'pt_session';

export default async function handler(req, res) {
  if (!methodIs(req, res, 'POST')) return;
  if (!sameOrigin(req)) return fail(res, 403, 'Cross-origin request refused.');

  await endSession(readCookies(req)[SESSION_COOKIE]);
  clearCookie(res, SESSION_COOKIE);
  send(res, 200, { ok: true });
}
