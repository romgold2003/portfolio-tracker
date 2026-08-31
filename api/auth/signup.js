/**
 * Create a cloud account.
 *
 * Everything cryptographic has already happened in the browser by the time this
 * runs. The client generated a data key, wrapped it twice — once under the
 * password, once under a recovery key it showed the user — encrypted the journal
 * under it, and derived a separate auth secret to prove itself with. This
 * endpoint stores those results. It could not decrypt them if it wanted to.
 */
import {
  send, fail, methodIs, readJson, setCookie, sameOrigin, rateLimit, clientIp,
} from '../_lib/http.js';
import {
  createUser, startSession, publicUser, looksLikeEmail, normalizeEmail,
  isWrapper, isVaultBlob, storeEscrow,
} from '../_lib/accounts.js';

const SESSION_COOKIE = 'pt_session';

export default async function handler(req, res) {
  if (!methodIs(req, res, 'POST')) return;
  if (!sameOrigin(req)) return fail(res, 403, 'Cross-origin request refused.');

  const body = await readJson(req).catch((err) => {
    if (err.status === 413) return 'TOO_BIG';
    return null;
  });
  if (body === 'TOO_BIG') return fail(res, 413, 'That journal is too large to store.');

  const email = normalizeEmail(body?.email);
  if (!looksLikeEmail(email)) return fail(res, 400, 'Enter a valid email address.');

  const {
    authSalt, authSecret, recoverySalt, recoverySecret,
    passwordWrapper, recoveryWrapper, vault,
  } = body ?? {};
  const isSalt = (v) => typeof v === 'string' && v.length >= 16 && v.length <= 64;
  const isSecret = (v) => typeof v === 'string' && v.length >= 32 && v.length <= 128;
  const isDataKey = (v) => typeof v === 'string' && v.length >= 32 && v.length <= 128;

  if (!isSalt(authSalt) || !isSalt(recoverySalt)) return fail(res, 400, 'Malformed request.');
  if (!isSecret(authSecret) || !isSecret(recoverySecret)) return fail(res, 400, 'Malformed request.');
  if (!isWrapper(passwordWrapper) || !isWrapper(recoveryWrapper)) {
    return fail(res, 400, 'Malformed request.');
  }
  if (!isVaultBlob(vault)) return fail(res, 400, 'Malformed request.');

  // Signup is expensive — an scrypt hash and two inserts — and it is the way
  // someone would fill the database with junk accounts.
  if (!await rateLimit(`signup:${clientIp(req)}`, 5, 60)) {
    return fail(res, 429, 'Too many accounts created from here. Try again later.');
  }

  const user = await createUser({
    email, authSalt, authSecret, recoverySalt, recoverySecret,
    passwordWrapper, recoveryWrapper, vault,
  });
  // Deliberately explicit. Hiding this behind a vague error would leave someone
  // unable to sign up and unable to find out why, and an address that already
  // has an account is discoverable from the sign-in screen anyway.
  if (!user) return fail(res, 409, 'An account already exists for that email.');

  /**
   * The copy of the data key that makes a reset link possible.
   *
   * Optional on both sides. A client that does not send one — an older build,
   * or a deployment the user chose not to trust with it — simply gets an
   * account that can only be recovered with its key, and everything else about
   * it works the same.
   */
  if (isDataKey(body?.escrowDataKey)) await storeEscrow(user.id, body.escrowDataKey);

  const { token, maxAge } = await startSession(user.id);
  setCookie(res, SESSION_COOKIE, token, maxAge);
  send(res, 201, { user: publicUser(user), vaultVersion: 1 });
}
