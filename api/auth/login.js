/**
 * Step two of signing in: prove the auth secret, get the vault.
 *
 * What comes back is still encrypted. The browser unwraps the data key with the
 * password the user typed and decrypts the journal locally, so a successful
 * login here is permission to *fetch* the ciphertext, not permission to read it.
 */
import {
  send, fail, methodIs, readJson, setCookie, sameOrigin,
  rateLimit, clearRateLimit, clientIp,
} from '../_lib/http.js';
import {
  authenticate, startSession, publicUser, readVault, normalizeEmail, looksLikeEmail,
} from '../_lib/accounts.js';

const SESSION_COOKIE = 'pt_session';

export default async function handler(req, res) {
  if (!methodIs(req, res, 'POST')) return;
  if (!sameOrigin(req)) return fail(res, 403, 'Cross-origin request refused.');

  const body = await readJson(req).catch(() => null);
  const email = normalizeEmail(body?.email);
  const authSecret = body?.authSecret;
  if (!looksLikeEmail(email) || typeof authSecret !== 'string' || !authSecret) {
    return fail(res, 400, 'Enter your email and password.');
  }

  /**
   * Two limits, because they stop different attacks. The per-address one stops
   * a password being guessed against one account from many machines; the
   * per-address-and-IP one is what a single attacker actually trips first.
   */
  const byEmail = `login:${email}`;
  const byIp = `login:${email}:${clientIp(req)}`;
  if (!await rateLimit(byIp, 10, 15) || !await rateLimit(byEmail, 30, 15)) {
    return fail(res, 429, 'Too many sign-in attempts. Wait a few minutes and try again.');
  }

  const user = await authenticate(email, authSecret);
  // One message for "no such account" and for "wrong password". Telling them
  // apart is how an attacker turns a login form into a list of customers.
  if (!user) return fail(res, 401, 'Wrong email or password.');

  await clearRateLimit(byIp);
  await clearRateLimit(byEmail);

  const { token, maxAge } = await startSession(user.id);
  setCookie(res, SESSION_COOKIE, token, maxAge);

  const vault = await readVault(user.id);
  send(res, 200, {
    user: publicUser(user),
    vault: vault ? { iv: vault.iv, ct: vault.ct } : null,
    vaultVersion: vault ? vault.version : 0,
  });
}
