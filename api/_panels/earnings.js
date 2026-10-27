/**
 * Earnings for the companies chosen on the News page, and the list to choose
 * them from (api/_lib/earnings.js).
 *
 *   GET /api/earnings?symbols=GOOGL,MSFT   each company's last report and next date
 *   GET /api/earnings?list=companies       every company on Nasdaq, the NYSE and NYSE American
 *
 * Server-side because neither Yahoo's summary nor Nasdaq's directories can be
 * read from the browser.
 */
import { fail, send, methodIs, readCookies } from '../_lib/http.js';
import { userForToken } from '../_lib/accounts.js';
import { companyEarnings, listedCompanies } from '../_lib/earnings.js';

const SESSION_COOKIE = 'pt_session';
/** More than anyone reads in one panel, and a bound on what one request can ask of Yahoo. */
const MAX_SYMBOLS = 40;

export default async function handler(req, res) {
  if (!methodIs(req, res, 'GET')) return;
  const user = await userForToken(readCookies(req)[SESSION_COOKIE]);
  if (!user) return fail(res, 401, 'Not signed in.');

  const url = new URL(req.url, 'http://local');
  try {
    if (url.searchParams.get('list')) {
      const companies = await listedCompanies();
      return send(res, 200, { companies });
    }

    const symbols = [...new Set(String(url.searchParams.get('symbols') ?? '').toUpperCase().split(','))]
      .map((s) => s.trim()).filter((s) => /^[A-Z][A-Z.-]{0,9}$/.test(s)).slice(0, MAX_SYMBOLS);
    if (!symbols.length) return send(res, 200, { companies: [] });

    // Six at a time, each on its own: one company Yahoo does not know leaves the rest.
    const companies = [];
    for (let i = 0; i < symbols.length; i += 6) {
      const batch = await Promise.allSettled(symbols.slice(i, i + 6).map((s) => companyEarnings(s)));
      batch.forEach((r, j) => companies.push(r.status === 'fulfilled' && r.value
        ? r.value
        : { symbol: symbols[i + j], name: symbols[i + j], last: null, next: null, missing: true }));
    }
    return send(res, 200, { companies, at: new Date().toISOString() });
  } catch (err) {
    return fail(res, 502, `Earnings are unavailable right now (${err.message}).`);
  }
}
