/**
 * Company earnings for the News page: what each chosen company last reported —
 * EPS against the estimate, revenue against a year earlier — and when it
 * reports next, with what is expected (October 2026).
 *
 * Yahoo has all of it within minutes of a release, quarterly or half-yearly
 * alike, and needs a session cookie and its "crumb" for the summary endpoint;
 * the chart endpoint the rest of the app uses does not. The list of companies
 * to choose from is Nasdaq's own directory of everything listed there.
 *
 * The parsers are pure and take what the sources return, so they are tested
 * on real answers (tests/earnings.test.mjs); the fetching is at the bottom.
 */

const DAY = 86400000;
const iso = (sec) => (Number.isFinite(sec) ? new Date(sec * 1000).toISOString().slice(0, 10) : null);
const raw = (v) => (typeof v?.raw === 'number' && Number.isFinite(v.raw) ? v.raw : null);
const pct = (now, then) => (now != null && then > 0 ? ((now - then) / Math.abs(then)) * 100 : null);

/** "1Q2027" → "Q1 FY27", the way a company names its own quarter. */
function fiscalLabel(q) {
  const m = /^(\d)Q(\d{4})$/.exec(q ?? '');
  return m ? `Q${m[1]} FY${m[2].slice(2)}` : (q ?? '');
}

/**
 * When in the day an earnings date falls, from Yahoo's timestamp: before the
 * open, after the close, or not said (a date at midnight).
 */
function sessionOf(sec) {
  if (!Number.isFinite(sec)) return null;
  const d = new Date(sec * 1000);
  const ny = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(d));
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) return null;
  if (ny < 9.5) return 'before open';
  if (ny >= 16) return 'after close';
  return 'during the session';
}

/**
 * One company, from Yahoo's summary (modules earnings, calendarEvents,
 * earningsTrend, price) and its quarterly revenue series `[{date, value}]`.
 *
 * `last` is the newest quarter with a reported EPS; its revenue is that
 * quarter's, and the year-ago revenue the quarter four back. `next` is the
 * coming report, only when it falls after the last one.
 */
export function readCompany(symbol, summary, revenue = []) {
  const chart = summary?.earnings?.earningsChart;
  const quarters = (chart?.quarterly ?? []).filter((q) => raw(q.actual) != null);
  const q = quarters[quarters.length - 1];
  const series = [...revenue].filter((r) => r?.date && r.value > 0).sort((a, b) => a.date.localeCompare(b.date));
  const near = (date, days) => series.find((r) => Math.abs(Date.parse(r.date) - Date.parse(date)) <= days * DAY);

  let last = null;
  if (q) {
    const periodEnd = iso(raw(q.periodEndDate));
    const fromChart = (summary?.earnings?.financialsChart?.quarterly ?? []).find((f) => f.date === q.date);
    const rev = (periodEnd && near(periodEnd, 10)?.value) ?? raw(fromChart?.revenue);
    const yearAgo = periodEnd ? near(new Date(Date.parse(periodEnd) - 365 * DAY).toISOString().slice(0, 10), 20)?.value ?? null : null;
    const eps = raw(q.actual);
    const epsEst = raw(q.estimate);
    last = {
      quarter: fiscalLabel(q.fiscalQuarter ?? q.date),
      periodEnd,
      reported: iso(raw(q.reportedDate)),
      eps,
      epsEst,
      // Against the size of the estimate, so a loss narrower than expected is a beat.
      epsSurprise: epsEst ? ((eps - epsEst) / Math.abs(epsEst)) * 100 : null,
      revenue: rev ?? null,
      revenueYearAgo: yearAgo,
      revenueYoY: pct(rev, yearAgo),
    };
  }

  const cal = summary?.calendarEvents?.earnings;
  const nextSec = raw(cal?.earningsDate?.[0]);
  const nextDate = iso(nextSec);
  const trend = (summary?.earningsTrend?.trend ?? []).find((t) => t.period === '0q');
  // Yahoo's own flag: the company has not confirmed the day yet, and its time of day means nothing.
  const estimated = Boolean(cal?.isEarningsDateEstimate ?? chart?.isEarningsDateEstimate);
  const next = nextDate && (!last?.reported || nextDate > last.reported)
    ? {
      date: nextDate,
      session: estimated ? null : sessionOf(nextSec),
      estimated,
      periodEnd: trend?.endDate ?? null,
      epsEst: raw(cal?.earningsAverage),
      revenueEst: raw(cal?.revenueAverage),
    }
    : null;

  const price = summary?.price ?? {};
  return {
    symbol,
    name: price.longName || price.shortName || symbol,
    // What the figures are in: ASML reports in euros though it trades in dollars.
    currency: summary?.earnings?.financialCurrency || price.currency || 'USD',
    last,
    next,
  };
}

/** Yahoo's fundamentals timeseries for quarterly revenue → [{date, value}]. */
export function readRevenueSeries(json) {
  const result = json?.timeseries?.result ?? [];
  const rows = result.find((r) => r?.meta?.type?.[0] === 'quarterlyTotalRevenue')?.quarterlyTotalRevenue ?? [];
  return rows.filter(Boolean).map((r) => ({ date: r.asOfDate, value: raw(r.reportedValue) })).filter((r) => r.date && r.value > 0);
}

/**
 * Nasdaq's directory (nasdaqlisted.txt) → the companies listed there, as
 * `{s, n, c?}` (ticker, name, share class), alphabetical by name.
 *
 * Funds, test issues, and the warrants, units, rights and notes that share a
 * company's name are left out: what is wanted is the company. Its name is what
 * comes before " - Class A Common Stock" and the like.
 */
export function readNasdaqListed(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const head = lines[0]?.split('|') ?? [];
  const col = (name) => head.indexOf(name);
  const [S, N, T, E] = [col('Symbol'), col('Security Name'), col('Test Issue'), col('ETF')];
  if (S < 0 || N < 0) return [];
  const out = [];
  for (const line of lines.slice(1)) {
    const f = line.split('|');
    const symbol = f[S]?.trim();
    const security = f[N]?.trim() ?? '';
    if (!symbol || !/^[A-Z]{1,5}$/.test(symbol)) continue;
    if (f[T] === 'Y' || f[E] === 'Y') continue;
    if (/\b(warrants?|units?|rights?|notes? due|debentures?|preferred|subordinated)\b/i.test(security)) continue;
    const name = security.split(' - ')[0].replace(/\s+(Common Stock|Ordinary Shares?|Class [A-C] (Common Stock|Ordinary Shares?))$/i, '').trim();
    // The share class when the name has one: Alphabet lists A (GOOGL) and C (GOOG).
    const shareClass = /\bClass ([A-Z])\b/.exec(security)?.[1];
    if (name) out.push(shareClass ? { s: symbol, n: name, c: shareClass } : { s: symbol, n: name });
  }
  // The class only tells two listings of one company apart; alone it is noise.
  const seen = new Map();
  for (const c of out) seen.set(c.n, (seen.get(c.n) ?? 0) + 1);
  for (const c of out) if (seen.get(c.n) === 1) delete c.c;
  return out.sort((a, b) => a.n.localeCompare(b.n, 'en', { sensitivity: 'base' }) || a.s.localeCompare(b.s));
}

/* ───────────────────────── fetching ───────────────────────── */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const SESSION_MS = 6 * 60 * 60 * 1000;
let session = null;

/** A Yahoo cookie and crumb, kept for a few hours and renewed when refused. */
async function yahooSession(fetcher, renew = false) {
  if (!renew && session && Date.now() - session.at < SESSION_MS) return session;
  const first = await fetcher('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, redirect: 'manual' });
  const cookies = (first.headers.getSetCookie?.() ?? [first.headers.get('set-cookie')].filter(Boolean))
    .map((c) => c.split(';')[0]).join('; ');
  if (!cookies) throw new Error('Yahoo gave no session.');
  const crumbRes = await fetcher('https://query2.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: cookies } });
  const crumb = (await crumbRes.text()).trim();
  if (!crumbRes.ok || !crumb || crumb.length > 40) throw new Error('Yahoo gave no crumb.');
  session = { cookie: cookies, crumb, at: Date.now() };
  return session;
}

async function yahooJson(fetcher, url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await yahooSession(fetcher, attempt > 0);
    const res = await fetcher(`${url}${url.includes('?') ? '&' : '?'}crumb=${encodeURIComponent(s.crumb)}`, {
      headers: { 'User-Agent': UA, Cookie: s.cookie, Accept: 'application/json' },
    });
    if (res.status === 401 || res.status === 403) continue;
    if (!res.ok) throw new Error(`Yahoo answered ${res.status}.`);
    return res.json();
  }
  throw new Error('Yahoo refused the session.');
}

const cache = new Map();
const CACHE_MS = 5 * 60 * 1000;

/** One company's earnings, cached five minutes. Null when Yahoo has nothing for it. */
export async function companyEarnings(symbol, fetcher = fetch) {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const base = 'https://query2.finance.yahoo.com';
  const now = Math.floor(Date.now() / 1000);
  const [summary, series] = await Promise.all([
    yahooJson(fetcher, `${base}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=earnings,calendarEvents,earningsTrend,price`),
    yahooJson(fetcher, `${base}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?type=quarterlyTotalRevenue&period1=${now - 600 * 86400}&period2=${now}`)
      .catch(() => null),
  ]);
  const result = summary?.quoteSummary?.result?.[0];
  const value = result ? readCompany(symbol, result, readRevenueSeries(series)) : null;
  cache.set(symbol, { at: Date.now(), value });
  return value;
}

let listed = { at: 0, list: null };

/** Every company listed on Nasdaq, alphabetical, refreshed daily. */
export async function nasdaqCompanies(fetcher = fetch) {
  if (listed.list && Date.now() - listed.at < DAY) return listed.list;
  const res = await fetcher('https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt', { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Nasdaq answered ${res.status}.`);
  const list = readNasdaqListed(await res.text());
  if (list.length < 500) throw new Error('Nasdaq\'s list came back short.');
  listed = { at: Date.now(), list };
  return list;
}
