/**
 * The US releases due this week, with what printed, what was expected, and
 * what it was last time.
 *
 * Reads ForexFactory's own weekly calendar feed and keeps the ones worth
 * watching. Nothing is stored: the feed covers the current week and rolls over
 * by itself every Monday, so the panel is always about the week it is being
 * looked at in. The selection lives in _lib/econ.js.
 *
 * The calendar feed carries no actual figure on any row, so once a release has
 * landed the printed number is read from FRED and matched back on — see
 * _lib/fred.js for how a figure is proved to belong to the release before it
 * is shown.
 *
 * Server-side because both are third-party hosts the content security policy
 * does not admit.
 */
import { fail, methodIs, readCookies } from './_lib/http.js';
import { userForToken } from './_lib/accounts.js';
import { selectReleases, orderReleases, weekOf } from './_lib/econ.js';
import { fetchActuals, attachActuals } from './_lib/fred.js';
import { fetchActuals as fetchBls } from './_lib/bls.js';

const SESSION_COOKIE = 'pt_session';
const FEED = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

export default async function handler(req, res) {
  if (!methodIs(req, res, 'GET')) return;

  const user = await userForToken(readCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Not signed in.');

  let events;
  try {
    const feed = await fetch(FEED, {
      headers: { 'User-Agent': 'portfolio-tracker', Accept: 'application/json' },
    });
    if (!feed.ok) return fail(res, 503, 'The economic calendar is not answering.');
    events = await feed.json();
  } catch {
    return fail(res, 503, 'The economic calendar is not answering.');
  }

  const scheduled = orderReleases(selectReleases(events));

  /**
   * A statistics service that will not answer costs the printed figures and
   * nothing else. The schedule is the panel's first job and it is already in
   * hand by this point.
   */
  /**
   * BLS first, FRED behind it.
   *
   * FRED republishes rather than publishes, and the delay is real: the August
   * unemployment rate printed at 08:30 and FRED still had July half an hour
   * later, while BLS had it at once. So whatever BLS owns comes from BLS, and
   * FRED covers the rest — claims, retail sales, GDP — and stands in wherever
   * BLS could not answer.
   */
  let releases = scheduled;
  try {
    const [fred, bls] = await Promise.all([
      fetchActuals(scheduled),
      fetchBls(scheduled),
    ]);
    releases = attachActuals(scheduled, new Map([...fred, ...bls]));
  } catch (err) {
    console.error('Release figures unavailable:', err);
  }

  /**
   * Two minutes.
   *
   * The week's schedule is fixed on Monday and its forecasts are revised in
   * days, so this is not about them — it is about the half-hour after 08:30,
   * when a figure has printed and the panel is being watched for it. Fifteen
   * minutes here plus fifteen in the browser meant a number could be half an
   * hour old before it was ever drawn, on top of whatever the source itself
   * took. That was the larger part of the delay and it was ours.
   */
  res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    week: weekOf(new Date().toISOString().slice(0, 10)),
    releases,
  }));
}
