/**
 * Signing in with the recovery key instead of the password.
 *
 * This is the only way back into a cloud account whose password has been
 * forgotten. There is no email reset, and there cannot be one: a reset link
 * proves you own the mailbox, and the server would still have no idea what the
 * data key is. Only the recovery key can open the journal, which is why the
 * sign-up screen refuses to move on until the user confirms they saved it.
 *
 * Held to the same rate limits as a password, and tighter — a recovery key is
 * the last line, so guessing at it should be slow.
 */
import {
  send, fail, methodIs, readJson, setCookie, sameOrigin,
  rateLimit, clearRateLimit, clientIp,
} from '../_lib/http.js';
import {
  authenticateRecovery, startSession, publicUser, readVault,
  normalizeEmail, looksLikeEmail,
} from '../_lib/accounts.js';

const SESSION_COOKIE = 'pt_session';

export default async function handler(req, res) {
  if (!methodIs(req, res, 'POST')) return;
  if (!sameOrigin(req)) return fail(res, 403, 'Cross-origin request refused.');

  const body = await readJson(req).catch(() => null);
  const email = normalizeEmail(body?.email);
  const recoverySecret = body?.recoverySecret;
  if (!looksLikeEmail(email) || typeof recoverySecret !== 'string' || !recoverySecret) {
    return fail(res, 400, 'Enter your email and recovery key.');
  }

  const bucket = `recover:${email}:${clientIp(req)}`;
  if (!await rateLimit(bucket, 5, 60) || !await rateLimit(`recover:${email}`, 20, 60)) {
    return fail(res, 429, 'Too many recovery attempts. Wait an hour and try again.');
  }

  const user = await authenticateRecovery(email, recoverySecret);
  if (!user) return fail(res, 401, 'That recovery key does not match that account.');

  await clearRateLimit(bucket);

  const { token, maxAge } = await startSession(user.id);
  setCookie(res, SESSION_COOKIE, token, maxAge);

  const vault = await readVault(user.id);
  send(res, 200, {
    user: publicUser(user),
    vault: vault ? { iv: vault.iv, ct: vault.ct } : null,
    vaultVersion: vault ? vault.version : 0,
  });
}
