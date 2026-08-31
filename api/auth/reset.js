/**
 * Finishing a password reset, in two steps against one token.
 *
 * Step "open" hands back the data key. Step "commit" takes the new password's
 * salt, secret and wrapper, spends the token, and signs the browser in.
 *
 * Two steps because the browser cannot build the new wrapper until it has the
 * key to put inside it, and it must not send the new password anywhere to get
 * one. So the key comes here, is wrapped there, and only the wrapper goes back.
 *
 * Be clear about what this endpoint is: a live token is enough to read someone's
 * journal. That is the deal a reset link makes, and it is why the token is
 * single-use, expires in 45 minutes, is superseded by any newer request, and is
 * rate limited on the way in.
 */
import {
  send, fail, methodIs, readJson, setCookie, sameOrigin,
  rateLimit, clientIp,
} from '../_lib/http.js';
import {
  userForResetToken, consumeResetToken, updateAuth, storeEscrow, readEscrow,
  startSession, endAllSessions, publicUser, readVault, isWrapper,
} from '../_lib/accounts.js';

const SESSION_COOKIE = 'pt_session';

const isSalt = (v) => typeof v === 'string' && v.length >= 16 && v.length <= 64;
const isSecret = (v) => typeof v === 'string' && v.length >= 32 && v.length <= 128;
const isDataKey = (v) => typeof v === 'string' && v.length >= 32 && v.length <= 128;

export default async function handler(req, res) {
  if (!methodIs(req, res, 'POST')) return;
  if (!sameOrigin(req)) return fail(res, 403, 'Cross-origin request refused.');

  const body = await readJson(req).catch(() => null);
  const token = typeof body?.token === 'string' ? body.token : '';
  if (!token) return fail(res, 400, 'That reset link is not valid.');

  // Guessing at tokens is hopeless — they are 256 random bits — but the attempt
  // should still not be free.
  if (!await rateLimit(`reset:${clientIp(req)}`, 20, 60)) {
    return fail(res, 429, 'Too many attempts. Wait an hour and try again.');
  }

  const user = await userForResetToken(token);
  if (!user) return fail(res, 400, 'That reset link has expired or has already been used.');

  return body.step === 'commit'
    ? commit(req, res, user, token, body)
    : open(res, user);
}

/** Step one: prove the link, get the key. The token stays live for the commit. */
async function open(res, user) {
  const dataKey = await readEscrow(user.id);
  if (!dataKey) {
    return fail(res, 409, 'This account cannot be reset by email. Use your recovery key.');
  }
  send(res, 200, { email: user.email, dataKey });
}

/** Step two: the new password's derivations, and a session. */
async function commit(req, res, user, token, body) {
  const { authSalt, authSecret, passwordWrapper, dataKey } = body;
  if (!isSalt(authSalt) || !isSecret(authSecret) || !isWrapper(passwordWrapper)) {
    return fail(res, 400, 'Malformed request.');
  }
  if (!isDataKey(dataKey)) return fail(res, 400, 'Malformed request.');

  // Spend the token first. If anything below fails the user asks for a new
  // link, which is a far better outcome than a link that stays usable.
  if (!await consumeResetToken(token)) {
    return fail(res, 400, 'That reset link has expired or has already been used.');
  }

  await updateAuth(user.id, { authSalt, authSecret, passwordWrapper });
  // Re-sealed under the new random IV. The key itself has not changed — the
  // journal is not re-encrypted by a password reset, only re-wrapped.
  await storeEscrow(user.id, dataKey);

  // Whoever knew the old password is the reason this was needed. Any session
  // they still hold would sail straight past the change.
  await endAllSessions(user.id);

  const { token: sessionToken, maxAge } = await startSession(user.id);
  setCookie(res, SESSION_COOKIE, sessionToken, maxAge);

  const vault = await readVault(user.id);
  send(res, 200, {
    user: publicUser({ ...user, auth_salt: authSalt, pw_wrapper: JSON.stringify(passwordWrapper) }),
    vault: vault ? { iv: vault.iv, ct: vault.ct } : null,
    vaultVersion: vault ? vault.version : 0,
  });
}
