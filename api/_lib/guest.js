/**
 * Guests (November 2026): someone can look around Riskbook without an account.
 *
 * A guest gets a pass — a cookie the server signed, good for twelve hours —
 * that opens the market data any visitor would see (prices, history, the News
 * and Crypto panels) and nothing else. No account row, no vault, no friends,
 * no questionnaire, no Admin: those still ask for a real sign-in, and a guest
 * saves nothing anywhere. The app says so the moment they enter.
 *
 * Signed with a key derived from the deployment's own secret, so a pass cannot
 * be made up, and it carries only its expiry.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readCookies } from './http.js';

export const GUEST_COOKIE = 'pt_guest';
export const GUEST_HOURS = 12;

/** The signing key; none means guests are off on this deployment. */
function key() {
  const secret = process.env.GUEST_SECRET || process.env.CRON_SECRET || process.env.ESCROW_SECRET;
  return secret ? createHmac('sha256', secret).update('riskbook guest pass v1').digest() : null;
}

const sign = (k, body) => createHmac('sha256', k).update(body).digest('base64url');

/** A new pass, or null when guests are off. */
export function issueGuestPass(now = Date.now()) {
  const k = key();
  if (!k) return null;
  const body = `${now + GUEST_HOURS * 3600_000}.${randomBytes(9).toString('base64url')}`;
  return `${body}.${sign(k, body)}`;
}

/** Whether a pass is one this server signed and has not run out. */
export function validGuestPass(pass, now = Date.now()) {
  const k = key();
  if (!k || typeof pass !== 'string') return false;
  const parts = pass.split('.');
  if (parts.length !== 3) return false;
  const [expires, nonce, mac] = parts;
  const expected = Buffer.from(sign(k, `${expires}.${nonce}`));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  return Number(expires) > now;
}

/** The guest reading a request, or null. */
export function guestFor(req) {
  return validGuestPass(readCookies(req)[GUEST_COOKIE]) ? { guest: true, id: 'guest' } : null;
}
