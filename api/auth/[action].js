/**
 * Every auth endpoint, behind one serverless function.
 *
 * They used to be ten files, which is the natural way to write them and the way
 * Vercel's routing expects. It is also ten of the twelve functions a Hobby
 * deployment is allowed, and adding the three the password-reset flow needs
 * pushed the build past the limit — where it does not warn, it simply stops
 * deploying. This collapses all of them into one dynamic route and leaves the
 * URLs exactly as they were.
 *
 * The implementations live in api/_auth/. A leading underscore is how Vercel is
 * told a file is a module rather than an endpoint, which is the same reason
 * api/_lib/ is spelled that way.
 *
 * Loaded on demand rather than up front: a cold start for a login should not
 * also be paying to parse the account-deletion path.
 */
import { fail } from '../_lib/http.js';

const ACTIONS = {
  begin: () => import('../_auth/begin.js'),
  signup: () => import('../_auth/signup.js'),
  login: () => import('../_auth/login.js'),
  logout: () => import('../_auth/logout.js'),
  session: () => import('../_auth/session.js'),
  recover: () => import('../_auth/recover.js'),
  password: () => import('../_auth/password.js'),
  forgot: () => import('../_auth/forgot.js'),
  reset: () => import('../_auth/reset.js'),
  escrow: () => import('../_auth/escrow.js'),
};

/**
 * Which endpoint was asked for.
 *
 * Read off the path rather than from req.query, so this behaves the same under
 * the dev server, which has no framework to populate that.
 */
function actionFrom(url) {
  const path = String(url || '').split('?')[0].replace(/\/+$/, '');
  return path.slice(path.lastIndexOf('/') + 1);
}

export default async function handler(req, res) {
  const load = ACTIONS[actionFrom(req.url)];
  if (!load) return fail(res, 404, 'No such endpoint.');
  const { default: run } = await load();
  return run(req, res);
}
