/**
 * The two fear-and-greed readings, fetched server-side.
 *
 * The parsing lives in _lib/sentiment.js; this is the part that talks to the
 * network. Server-side because the source is a third-party host the content
 * security policy does not admit, and because one fetch here answers for every
 * reader rather than each browser asking for itself.
 */
import { fail, methodIs, readCookies } from './_lib/http.js';
import { userForToken } from './_lib/accounts.js';
import { readSentiment } from './_lib/sentiment.js';

const SESSION_COOKIE = 'pt_session';
const SOURCE = 'https://feargreedmeter.com/';

export default async function handler(req, res) {
  if (!methodIs(req, res, 'GET')) return;

  const user = await userForToken(readCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Not signed in.');

  let html;
  try {
    const page = await fetch(SOURCE, {
      headers: {
        // A plain page request. The site renders its data server-side, so this
        // is the same response a reader gets.
        'User-Agent': 'Mozilla/5.0 (compatible; portfolio-tracker)',
        Accept: 'text/html',
      },
    });
    if (!page.ok) return fail(res, 503, 'The sentiment source is not answering.');
    html = await page.text();
  } catch {
    return fail(res, 503, 'The sentiment source is not answering.');
  }

  const sentiment = readSentiment(html);
  // The page came back but not in the shape expected — it has been redesigned,
  // or something else was served. Say nothing rather than publish a guess.
  if (!sentiment) return fail(res, 503, 'The sentiment source could not be read.');

  /**
   * Half an hour. The stock index recomputes through the session and the crypto
   * one once a day; neither is a number anyone needs to the minute.
   */
  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(sentiment));
}
