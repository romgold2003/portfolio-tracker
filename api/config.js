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

export default async function handler(req, res) {
  if (!methodIs(req, res, 'GET')) return;
  let cloud = false;
  try {
    cloud = await databaseAvailable();
  } catch {
    cloud = false;
  }
  send(res, 200, { cloud });
}
