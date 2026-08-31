/**
 * "I forgot my password." Sends the link, and says nothing about who has an
 * account here.
 *
 * The response is the same for an address with an account, an address without
 * one, an account created before escrow was switched on, and a mail provider
 * that just refused the message. That is not vagueness for its own sake: an
 * endpoint that answers "no such account" is a free membership list for a site
 * that knows what people trade.
 *
 * So every path below ends in the same 200, and the failures are logged where
 * an operator can see them instead.
 */
import {
  send, fail, methodIs, readJson, sameOrigin, rateLimit, clientIp,
} from '../_lib/http.js';
import {
  findUserByEmail, createResetToken, readEscrow,
  normalizeEmail, looksLikeEmail,
} from '../_lib/accounts.js';
import { mailAvailable, sendResetEmail } from '../_lib/mail.js';

/** What every caller is told, whatever actually happened. */
const SAME_ANSWER = {
  ok: true,
  message: 'If there is an account for that address, a reset link is on its way.',
};

export default async function handler(req, res) {
  if (!methodIs(req, res, 'POST')) return;
  if (!sameOrigin(req)) return fail(res, 403, 'Cross-origin request refused.');

  const body = await readJson(req).catch(() => null);
  const email = normalizeEmail(body?.email);
  if (!looksLikeEmail(email)) return fail(res, 400, 'Enter a valid email address.');

  // Sending mail costs money somewhere and lands in someone's inbox, so this is
  // limited harder than a login: per address, and per source.
  if (!await rateLimit(`forgot:${email}`, 4, 60) || !await rateLimit(`forgot:${clientIp(req)}`, 12, 60)) {
    return fail(res, 429, 'Too many reset requests. Wait an hour and try again.');
  }

  try {
    if (mailAvailable()) await maybeSend(req, email);
  } catch (err) {
    // Logged, never returned. See the note at the top.
    console.error('Password reset could not be sent:', err);
  }

  send(res, 200, SAME_ANSWER);
}

async function maybeSend(req, email) {
  const user = await findUserByEmail(email);
  if (!user) return;

  // An account with no escrowed key cannot be reset by email — there would be
  // nothing to give back, and a link that ends in an empty journal is worse
  // than no link. Those accounts still have their recovery key.
  if (await readEscrow(user.id) === null) return;

  const token = await createResetToken(user.id);
  await sendResetEmail(user.email, resetLink(req, token));
}

/**
 * The link, built from the request rather than a configured base URL.
 *
 * Vercel gives a deployment several hostnames — the production domain, the
 * branch alias, the immutable per-deploy URL — and a hardcoded one sends people
 * from a preview to production and back to a token that is not there. Whichever
 * host they actually asked from is the one that works.
 */
function resetLink(req, token) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  // Vercel sets the header. Locally there is none, and a link to https://localhost
  // goes nowhere, so the host is what decides.
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    || (/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host) ? 'http' : 'https');
  return `${proto}://${host}/?reset=${encodeURIComponent(token)}`;
}
