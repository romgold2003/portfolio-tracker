/**
 * The US releases due this week, with forecast and previous.
 *
 * Reads ForexFactory's own weekly calendar feed and keeps the ones worth
 * watching. Nothing is stored: the feed covers the current week and rolls over
 * by itself every Monday, so the panel is always about the week it is being
 * looked at in. The selection lives in _lib/econ.js.
 *
 * Server-side because the feed is a third-party host the content security
 * policy does not admit.
 */
import { fail, methodIs, readCookies } from './_lib/http.js';
import { userForToken } from './_lib/accounts.js';
import { selectReleases, orderReleases, weekOf } from './_lib/econ.js';

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

  const releases = orderReleases(selectReleases(events));

  /**
   * An hour. The week's schedule is fixed on Monday; only the forecasts move
   * within it, and those are revised in days rather than minutes.
   *
   * It is worth being explicit that this does not delay the Monday rollover:
   * the cache is an hour old at worst, and the week turns over at midnight.
   */
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    week: weekOf(new Date().toISOString().slice(0, 10)),
    releases,
  }));
}
