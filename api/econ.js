/**
 * Forecast and previous for the US releases that move rates.
 *
 * Reads ForexFactory's own weekly calendar feed, keeps the handful of releases
 * worth watching, and folds them into what was seen before. The selection and
 * the folding live in _lib/econ.js; this is the part that talks to the network
 * and the database.
 *
 * Server-side because the feed is a third-party host the content security
 * policy does not admit, and because the accumulated history belongs to the
 * deployment rather than to one browser's storage.
 */
import { fail, methodIs, readCookies } from './_lib/http.js';
import { userForToken } from './_lib/accounts.js';
import { query } from './_lib/db.js';
import { selectReleases, mergeReleases, orderReleases } from './_lib/econ.js';

const SESSION_COOKIE = 'pt_session';
const FEED = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

async function readStored() {
  const { rows } = await query(
    'SELECT id, label, release_at, impact, forecast, previous FROM econ', [],
  );
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    date: r.release_at,
    impact: r.impact,
    forecast: r.forecast,
    previous: r.previous,
  }));
}

async function store(rows) {
  const now = new Date().toISOString();
  for (const r of rows) {
    const params = [r.label, r.date, r.impact, r.forecast, r.previous, now, r.id];
    const { rows: updated } = await query(
      `UPDATE econ SET label = $1, release_at = $2, impact = $3, forecast = $4,
              previous = $5, updated_at = $6
        WHERE id = $7 RETURNING id`,
      params,
    );
    if (!updated.length) {
      await query(
        `INSERT INTO econ (label, release_at, impact, forecast, previous, updated_at, id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        params,
      );
    }
  }
}

export default async function handler(req, res) {
  if (!methodIs(req, res, 'GET')) return;

  const user = await userForToken(readCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Not signed in.');

  const stored = await readStored().catch(() => []);

  let fresh = [];
  try {
    const feed = await fetch(FEED, {
      headers: { 'User-Agent': 'portfolio-tracker', Accept: 'application/json' },
    });
    if (feed.ok) fresh = selectReleases(await feed.json());
  } catch {
    // The feed being down is not a reason to show nothing: what was stored is
    // still the last true reading of each of these.
  }

  const merged = mergeReleases(stored, fresh);
  if (fresh.length) await store(fresh).catch(() => { /* the read still works */ });

  if (!merged.length) return fail(res, 503, 'No economic releases available yet.');

  /**
   * Fifteen minutes. These change when a release prints, which is a handful of
   * scheduled moments a month, not a tape.
   */
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ releases: orderReleases(merged) }));
}
