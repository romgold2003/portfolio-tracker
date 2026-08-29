/**
 * Deleting an account, permanently.
 *
 * A valid session is not enough. Deletion is the one action here that cannot be
 * undone from a backup the server holds — because the server holds none it can
 * read — so it asks for the password again, exactly as the sign-in screen does.
 * A borrowed laptop with a live session should not be able to destroy someone's
 * trading record in two clicks.
 *
 * What proves the password is the same derived secret used to sign in; the
 * password itself still never reaches this server.
 */
import {
  send, fail, methodIs, readJson, readCookies, clearCookie, sameOrigin,
  rateLimit, clientIp,
} from './_lib/http.js';
import { userForToken, authenticate, deleteUser } from './_lib/accounts.js';

const SESSION_COOKIE = 'pt_session';

export default async function handler(req, res) {
  // POST rather than DELETE: this is reached from a form in the browser, and
  // the body carries the re-authentication.
  if (!methodIs(req, res, 'POST')) return;
  if (!sameOrigin(req)) return fail(res, 403, 'Cross-origin request refused.');

  const token = readCookies(req)[SESSION_COOKIE];
  const user = await userForToken(token);
  if (!user) return fail(res, 401, 'Not signed in.');

  const body = await readJson(req).catch(() => null);
  const authSecret = body?.authSecret;
  if (typeof authSecret !== 'string' || !authSecret) {
    return fail(res, 400, 'Confirm your password to delete the account.');
  }

  // Guessing a password through this endpoint should be no cheaper than
  // guessing it through the sign-in screen.
  if (!await rateLimit(`delete:${user.email}:${clientIp(req)}`, 5, 15)) {
    return fail(res, 429, 'Too many attempts. Wait a few minutes.');
  }

  const confirmed = await authenticate(user.email, authSecret);
  if (!confirmed || confirmed.id !== user.id) {
    return fail(res, 401, 'That password is not right.');
  }

  await deleteUser(user.id);
  clearCookie(res, SESSION_COOKIE);
  send(res, 200, { deleted: true });
}
