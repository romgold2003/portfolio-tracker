/**
 * Handing over a copy of the data key, for an account that predates reset links.
 *
 * Only reachable with a live session, which means the browser has already
 * unlocked the journal and therefore already holds the key it is sending. This
 * endpoint cannot be used to *obtain* a key — only to store one — so the worst
 * an attacker with a stolen session can do here is give the server something it
 * could have been given at sign-up.
 *
 * The key is not checked against the vault, because the server cannot check it:
 * it has no way to tell a right key from a wrong one. A client that sent
 * nonsense would break only its own future resets, and it is the same client
 * that would have to live with that.
 */
import {
  send, fail, methodIs, readJson, readCookies, sameOrigin, rateLimit, clientIp,
} from '../_lib/http.js';
import { userForToken, storeEscrow, hasEscrow } from '../_lib/accounts.js';
import { escrowAvailable } from '../_lib/crypto.js';

const SESSION_COOKIE = 'pt_session';

export default async function handler(req, res) {
  if (!methodIs(req, res, 'POST')) return;
  if (!sameOrigin(req)) return fail(res, 403, 'Cross-origin request refused.');

  const user = await userForToken(readCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Not signed in.');

  if (!escrowAvailable()) {
    return fail(res, 409, 'This deployment does not hold keys.');
  }

  if (!await rateLimit(`escrow:${clientIp(req)}`, 20, 60)) {
    return fail(res, 429, 'Too many attempts. Wait an hour and try again.');
  }

  const body = await readJson(req).catch(() => null);
  const dataKey = body?.dataKey;
  if (typeof dataKey !== 'string' || dataKey.length < 32 || dataKey.length > 128) {
    return fail(res, 400, 'Malformed request.');
  }

  // Already holding one. Overwriting on every sign-in would be churn, and a
  // second answer here is not better than the first.
  if (await hasEscrow(user.id)) return send(res, 200, { escrowed: true });

  await storeEscrow(user.id, dataKey);
  send(res, 200, { escrowed: true });
}
