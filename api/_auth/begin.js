/**
 * Step one of signing in: hand back the salt for an address.
 *
 * The browser cannot derive anything until it knows the salt that was used when
 * the account was made, and it has to ask before it has proved who it is. That
 * is unavoidable, and it is why the salt is not a secret.
 *
 * What must not leak is *whether the account exists*. An address with no account
 * gets a salt too — random-looking, and the same one every time it is asked, so
 * the answer cannot be told apart from a real one by looking at it or by asking
 * twice. Signing in with it then fails exactly the way a wrong password does.
 */
import {
  send, fail, methodIs, readJson, rateLimit, clientIp,
} from '../_lib/http.js';
import {
  findUserByEmail, looksLikeEmail, normalizeEmail, serverPepper,
} from '../_lib/accounts.js';
import { decoySalt } from '../_lib/crypto.js';

export default async function handler(req, res) {
  if (!methodIs(req, res, 'POST')) return;

  const body = await readJson(req).catch(() => null);
  const email = normalizeEmail(body?.email);
  if (!looksLikeEmail(email)) return fail(res, 400, 'Enter a valid email address.');

  // Cheap endpoint, but still the one that would be used to enumerate accounts.
  if (!await rateLimit(`begin:${clientIp(req)}`, 60, 15)) {
    return fail(res, 429, 'Too many attempts. Wait a few minutes.');
  }

  const user = await findUserByEmail(email);
  const pepper = await serverPepper();
  // Both salts, so the recovery screen does not need a second endpoint that
  // would itself have to be careful about revealing who has an account.
  send(res, 200, {
    authSalt: user ? user.auth_salt : decoySalt(email, pepper),
    recoverySalt: user ? user.rec_salt : decoySalt(`recovery:${email}`, pepper),
  });
}
