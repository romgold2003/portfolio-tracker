/**
 * The market history the Insights page reads beside a person's own trades
 * (November 2026):
 *
 *  - fearGreed: CNN's Fear & Greed index, one reading a trading day, from 2024
 *    — "the market's mood the day you bought" (Insights #15).
 *  - bigDays: the days the biggest US news landed — Fed decisions (the Fed's
 *    own meeting calendar), CPI (found on Nasdaq's economic calendar) and the
 *    jobs report (both from Nasdaq's economic calendar) — "your account on big-news
 *    days" (Insights #4).
 *
 * The same for everyone and slow-moving, so it is cached for half a day and
 * shared. Each source is on its own: one failing leaves the other.
 */
import { fail, methodIs, readCookies } from '../_lib/http.js';
import { userForToken } from '../_lib/accounts.js';
import { guestFor } from '../_lib/guest.js';

const SESSION_COOKIE = 'pt_session';
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** CNN's daily Fear & Greed readings since `from`, as [{ date, value }]. */
export async function fearGreedHistory(from = '2024-01-01', fetchImpl = fetch) {
  const res = await fetchImpl(`https://production.dataviz.cnn.io/index/fearandgreed/graphdata/${from}`, {
    headers: { 'User-Agent': BROWSER, Accept: 'application/json, text/plain, */*', Referer: 'https://edition.cnn.com/', Origin: 'https://edition.cnn.com' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`CNN answered ${res.status}`);
  const points = (await res.json())?.fear_and_greed_historical?.data ?? [];
  const byDay = new Map();
  for (const p of points) {
    if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) continue;
    byDay.set(new Date(p.x).toISOString().slice(0, 10), Math.round(p.y));
  }
  return [...byDay].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Fed decision days from the Fed's meeting calendar: the second day of each
 * two-day meeting, which is when the decision is announced. A meeting that
 * spans two months ("April/May", "30-1") is announced in the second.
 */
export function parseFomc(html) {
  const out = [];
  const years = String(html).split(/(\d{4}) FOMC Meetings/);
  for (let i = 1; i < years.length; i += 2) {
    const year = Number(years[i]);
    const block = years[i + 1] ?? '';
    const re = /fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>([^<]+)</g;
    let m;
    while ((m = re.exec(block))) {
      const months = m[1].toLowerCase().split('/').map((s) => MONTHS.findIndex((n) => n.startsWith(s.trim().slice(0, 3))));
      // A two-day meeting only: notation votes and unscheduled calls are not decision days.
      if (!/^\s*\d{1,2}\s*-\s*\d{1,2}\s*\*?\s*$/.test(m[2])) continue;
      const days = m[2].replace(/[^\d-]/g, '').split('-').map(Number).filter(Boolean);
      if (!days.length || months.some((x) => x < 0)) continue;
      const month = months[months.length - 1];
      out.push(iso(year, month, days[days.length - 1]));
    }
  }
  return [...new Set(out)].sort();
}

async function fomcDays(fetchImpl = fetch) {
  const res = await fetchImpl('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', {
    headers: { 'User-Agent': BROWSER }, signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Fed calendar answered ${res.status}`);
  return parseFomc(await res.text());
}

/**
 * CPI days already past, found once on Nasdaq's calendar (and the three it
 * lacked from BLS's own schedule: 13 Nov 2024, and 24 Oct and 18 Dec 2025,
 * moved by the shutdown). A date in the past never changes, so only the last
 * two months are looked up as the page is used.
 */
export const KNOWN_CPI = [
  '2024-01-11', '2024-02-13', '2024-03-12', '2024-04-10', '2024-05-15', '2024-06-12', '2024-07-11', '2024-08-14',
  '2024-09-11', '2024-10-10', '2024-11-13', '2024-12-11',
  '2025-01-15', '2025-02-12', '2025-03-12', '2025-04-10', '2025-05-13', '2025-06-11', '2025-07-15', '2025-08-12',
  '2025-09-11', '2025-10-24', '2025-12-18',
  '2026-01-13', '2026-02-13', '2026-03-11', '2026-04-10', '2026-05-12', '2026-06-10', '2026-07-14', '2026-08-12',
  '2026-09-11', '2026-10-14', '2026-11-10',
];

/**
 * Jobs-report days already past (US Nonfarm Payrolls), found once on Nasdaq's
 * calendar in November 2026, plus the three it lacks from BLS's own schedule
 * (7 March, 4 April and 5 September 2025). Not "the first Friday": it was a
 * Thursday on 3 July 2025 and 2 July 2026, a week later than that in several
 * months, and the 2025 shutdown moved two reports to 20 November and
 * 16 December. June 2026 is missing from Nasdaq and left out rather than
 * guessed.
 */
export const KNOWN_JOBS = [
  '2024-01-05', '2024-02-02', '2024-03-08', '2024-04-05', '2024-05-03', '2024-06-07', '2024-07-05', '2024-08-02',
  '2024-09-06', '2024-10-04', '2024-11-01', '2024-12-06',
  '2025-01-10', '2025-02-07', '2025-03-07', '2025-04-04', '2025-05-02', '2025-06-06', '2025-07-03', '2025-08-01',
  '2025-09-05', '2025-11-20', '2025-12-16',
  '2026-01-09', '2026-02-11', '2026-03-06', '2026-04-03', '2026-05-08', '2026-07-02', '2026-08-07', '2026-09-04',
  '2026-10-02', '2026-11-06',
];

/**
 * The last `months` months of CPI and jobs-report days from Nasdaq's
 * calendar, so a new release joins without a code change. Nasdaq files a
 * day's events under the next day's date. The 2nd to the 22nd of each month
 * are asked for at once (both reports land in that span), each with a short
 * timeout, so the scan never holds the page for long.
 */
export async function releaseDays(months = 2, fetchImpl = fetch, now = new Date()) {
  const asks = [];
  for (let k = 0; k < months; k++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
    for (let day = 2; day <= 22; day++) {
      const q = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), day));
      if (q <= now) asks.push(q.toISOString().slice(0, 10));
    }
  }
  const cpi = new Set();
  const jobs = new Set();
  await Promise.all(asks.map(async (date) => {
    try {
      const res = await fetchImpl(`https://api.nasdaq.com/api/calendar/economicevents?date=${date}`, {
        headers: { 'User-Agent': BROWSER, Accept: 'application/json, text/plain, */*', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return;
      const rows = ((await res.json())?.data?.rows ?? []).filter((r) => /united states/i.test(r?.country ?? ''));
      const q = new Date(`${date}T00:00:00Z`);
      q.setUTCDate(q.getUTCDate() - 1);
      const day = q.toISOString().slice(0, 10);
      if (rows.some((r) => /^CPI$/i.test(String(r?.eventName ?? '').trim()))) cpi.add(day);
      if (rows.some((r) => String(r?.eventName ?? '').trim() === 'Nonfarm Payrolls')) jobs.add(day);
    } catch { /* one day missing is one release fewer */ }
  }));
  return { cpi: [...cpi].sort(), jobs: [...jobs].sort() };
}

export default async function handler(req, res) {
  if (!methodIs(req, res, 'GET')) return;
  const viewer = (await userForToken(readCookies(req)[SESSION_COOKIE])) ?? guestFor(req);
  if (!viewer) return fail(res, 401, 'Not signed in.');

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const [fear, fomc, recent] = await Promise.allSettled([fearGreedHistory(), fomcDays(), releaseDays(2)]);
  const latest = recent.status === 'fulfilled' ? recent.value : { cpi: [], jobs: [] };
  const bigDays = [
    ...(fomc.status === 'fulfilled' ? fomc.value.filter((d) => d <= today).map((date) => ({ date, kind: 'Fed decision' })) : []),
    ...[...new Set([...KNOWN_CPI, ...latest.cpi])].map((date) => ({ date, kind: 'CPI' })),
    ...[...new Set([...KNOWN_JOBS, ...latest.jobs])].map((date) => ({ date, kind: 'Jobs report' })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  res.setHeader('Cache-Control', 'public, s-maxage=43200, stale-while-revalidate=86400');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    fearGreed: fear.status === 'fulfilled' ? fear.value : [],
    bigDays,
  }));
}
