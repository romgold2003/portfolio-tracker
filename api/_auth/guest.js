/**
 * Enter as a guest: a twelve-hour pass for the market data, and nothing else
 * (api/_lib/guest.js). No account is made and nothing is stored.
 */
import {
  send, fail, methodIs, sameOrigin, setCookie, rateLimit, clientIp,
} from '../_lib/http.js';
import { issueGuestPass, GUEST_COOKIE, GUEST_HOURS } from '../_lib/guest.js';

export default async function handler(req, res) {
  if (!methodIs(req, res, 'POST')) return;
  if (!sameOrigin(req)) return fail(res, 403, 'Cross-origin request refused.');
  // A pass is free to ask for, so a script asking for thousands is held back.
  if (!await rateLimit(`guest:${clientIp(req)}`, 30, 60)) {
    return fail(res, 429, 'Too many guest visits from here. Try again later, or create a free account.');
  }
  const pass = issueGuestPass();
  if (!pass) return fail(res, 503, 'Guest visits are not available right now.');
  setCookie(res, GUEST_COOKIE, pass, GUEST_HOURS * 3600);
  return send(res, 200, { guest: true, hours: GUEST_HOURS });
}
