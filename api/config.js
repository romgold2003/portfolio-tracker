/**
 * Does this deployment have a cloud behind it?
 *
 * The same source builds three things: a file you double-click, a static site
 * on GitHub Pages, and this. Only the last has a database, so the app asks
 * before it offers anyone a cloud account. On the other two the request 404s
 * and the app stays local, which is why the answer must never be assumed.
 */
import { databaseAvailable } from './_lib/db.js';
import { send, methodIs } from './_lib/http.js';
import { escrowAvailable } from './_lib/crypto.js';
import { mailAvailable } from './_lib/mail.js';

export default async function handler(req, res) {
  if (!methodIs(req, res, 'GET')) return;
  let cloud = false;
  try {
    cloud = await databaseAvailable();
  } catch {
    cloud = false;
  }
  /**
   * Whether a forgotten password can be reset by email, which needs three
   * things at once: somewhere to store accounts, a secret to encrypt the held
   * data keys under, and a way to send mail. Missing any of them, the sign-in
   * screen keeps offering recovery keys, and sign-up keeps issuing them.
   *
   * Reported rather than assumed so the same build works either way, and so
   * turning it on is a matter of setting two environment variables.
   */
  const emailReset = cloud && escrowAvailable() && mailAvailable();
  send(res, 200, { cloud, emailReset });
}
