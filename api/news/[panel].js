/**
 * Every News-page data endpoint, behind one serverless function.
 *
 * The same trick api/auth/[action].js plays, and it is here for the same reason
 * — except this time the limit was not approached carefully, it was crossed.
 *
 * A Hobby deployment allows twelve functions. Counting `ls api/*.js` gives
 * twelve and misses `api/auth/[action].js`, which is a thirteenth: a file in a
 * subdirectory is still a function. Adding the whale tracker put the count at
 * thirteen, and Vercel's response to that is not a failed build with a message.
 * It simply stops deploying. Production went on serving the last good build for
 * four commits while every push appeared to succeed.
 *
 * So the seven panels that feed one page now share one function, which drops
 * the total from thirteen to seven and leaves real headroom rather than sitting
 * one file away from the same silent failure.
 *
 * The old URLs are unchanged. `vercel.json` rewrites /api/fed to
 * /api/news/fed and so on, so nothing in the browser had to learn about this —
 * which is the point: a deployment problem should not become a client problem.
 *
 * Loaded on demand. A cold start for the Fed panel should not also pay to parse
 * five chain adapters it will not use.
 */
import { fail } from '../_lib/http.js';

const PANELS = {
  fed: () => import('../_panels/fed.js'),
  econ: () => import('../_panels/econ.js'),
  sentiment: () => import('../_panels/sentiment.js'),
  etf: () => import('../_panels/etf.js'),
  options: () => import('../_panels/options.js'),
  weekstart: () => import('../_panels/weekstart.js'),
  whales: () => import('../_panels/whales.js'),
};

/**
 * Which panel was asked for.
 *
 * Read off the path rather than from req.query, so this behaves the same under
 * the dev server, which has no framework to populate that.
 */
function panelFrom(url) {
  const path = String(url || '').split('?')[0].replace(/\/+$/, '');
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * The longest any one panel may take.
 *
 * The whale tracker's poll reads five chains against public indexers and needs
 * about twenty seconds; Blockscout alone takes ten for a single token feed. The
 * ten second default would cut every poll short. The other six panels answer in
 * well under a second and are unaffected by a ceiling they never reach.
 */
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const load = PANELS[panelFrom(req.url)];
  if (!load) return fail(res, 404, 'No such panel.');
  const { default: run } = await load();
  return run(req, res);
}
