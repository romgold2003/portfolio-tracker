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
 * open, after the close, or not said. A time inside the session is not said
 * either: companies do not report mid-session, and Yahoo put Oracle's
 * after-the-close December report at midday.
 */
function sessionOf(sec) {
  if (!Number.isFinite(sec)) return null;
  const d = new Date(sec * 1000);
  const ny = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(d));
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) return null;
  if (ny < 9.5) return 'before open';
  if (ny >= 16) return 'after close';
  return null;
}

/**
 * One company, from Yahoo's summary (modules earnings, calendarEvents,
 * earningsTrend, price) and its quarterly revenue series `[{date, value}]`.
 *
 * `last` is the newest quarter with a reported EPS; its revenue is that
 * quarter's, and the year-ago revenue the quarter four back. `next` is the
 * coming report, only when it falls after the last one.
 */
export function readCompany(symbol, summary, revenue = [], now = Date.now()) {
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

  /**
   * A quarter whose revenue is out before its EPS.
   *
   * Yahoo's revenue chart takes a release within the hour; its EPS can take
   * the rest of the day. SoFi reported on 27 October before the open, and two
   * hours on Yahoo had its $1.371B revenue and not yet its EPS, so the panel,
   * keyed on EPS, still showed the forecast alone. A newer quarter in the
   * revenue chart, on a report day already reached, is that report: the
   * revenue now, the EPS when it comes.
   */
  const order = (label) => { const m = /^(\d)Q(\d{4})$/.exec(label ?? ''); return m ? Number(m[2]) * 4 + Number(m[1]) : -1; };
  const fin = summary?.earnings?.financialsChart?.quarterly ?? [];
  const newest = fin.reduce((best, f) => (order(f.date) > order(best?.date) ? f : best), null);
  const today = new Date(now).toISOString().slice(0, 10);
  if (newest && raw(newest.revenue) != null && order(newest.date) > order(q?.date) && nextDate && nextDate <= today) {
    // The quarter's own end: the analysts' current quarter, until Yahoo moves on from it.
    const step = order(newest.date) - order(q?.date);
    const shifted = q ? new Date(Date.parse(iso(raw(q.periodEndDate))) + step * 91.3 * DAY) : null;
    const periodEnd = trend?.endDate && (!last?.periodEnd || trend.endDate > last.periodEnd)
      ? trend.endDate
      : shifted ? shifted.toISOString().slice(0, 10) : null;
    // The fiscal name moves with the calendar one: Microsoft's 3Q2025 was its Q1 FY26.
    const fiscalStep = q ? order(q.fiscalQuarter) - order(q.date) : 0;
    const n = order(newest.date) + fiscalStep;
    const fiscal = `${((n - 1) % 4) + 1}Q${Math.floor((n - 1) / 4)}`;
    const rev = raw(newest.revenue);
    const yearAgo = periodEnd ? near(new Date(Date.parse(periodEnd) - 365 * DAY).toISOString().slice(0, 10), 20)?.value ?? null : null;
    last = {
      quarter: fiscalLabel(fiscal),
      periodEnd,
      reported: nextDate,
      eps: null,
      epsEst: raw(trend?.earningsEstimate?.avg) ?? raw(cal?.earningsAverage),
      epsSurprise: null,
      revenue: rev,
      revenueYearAgo: yearAgo,
      revenueYoY: pct(rev, yearAgo),
      // Yahoo has the revenue and not yet the EPS.
      epsPending: true,
    };
  }
  // Yahoo's own flag: the company has not confirmed the day yet, and its time of day means nothing.
  const estimated = Boolean(cal?.isEarningsDateEstimate ?? chart?.isEarningsDateEstimate);
  /**
   * The quarter coming: its forecast always, from the analysts' trend for the
   * current quarter, and its day once Yahoo has one after the last report.
   * Tesla reported on 21 October with no next day set, and its December
   * quarter was already forecast; that forecast is what the panel shows.
   */
  const dated = nextDate && (!last?.reported || nextDate > last.reported);
  const periodEnd = trend?.endDate ?? null;
  const ahead = periodEnd && (!last?.periodEnd || periodEnd > last.periodEnd);
  const next = ahead || dated
    ? {
      date: dated ? nextDate : null,
      session: dated && !estimated ? sessionOf(nextSec) : null,
      estimated: dated ? estimated : false,
      periodEnd: ahead ? periodEnd : null,
      epsEst: (ahead ? raw(trend?.earningsEstimate?.avg) : null) ?? (dated ? raw(cal?.earningsAverage) : null),
      revenueEst: (ahead ? raw(trend?.revenueEstimate?.avg) : null) ?? (dated ? raw(cal?.revenueAverage) : null),
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

/** What a listing is called past the company's name, in either directory. */
const SECURITY_WORDS = /\s*(?:-\s+)?(?:New\s+)?(?:Class [A-Z]\s+)?(?:Common Stock|Common Shares?|Ordinary Shares?|Capital Stock|American Deposit[ao]ry|Deposit[ao]ry Shares|New York Registry|Shares of Beneficial|(?:Exchangeable\s+)?(?:Limited\s+|Subordinate\s+)?Voting Shares|Common Units|Units representing|Registered Shares|N(?:ew )?Y(?:ork)? Registry|Ord(?:inary)? Shares?|Deposit[ao]ry units|shares representing|Shares$)\b.*$/i;
/** Listings that share a company's name and are not its shares. */
const NOT_SHARES = /\b(warrants?|units?\b(?! representing)|rights?|notes? due|debentures?|preferred|preference|subordinated|trust certificates|exchange[- ]traded notes?|bonds?)\b|\d\s?%/i;
const EXCHANGES = { N: 'NYSE', A: 'NYSE American' };

/**
 * Nasdaq's two directories → the companies listed on Nasdaq, the NYSE and NYSE
 * American, as `{s, n, x, c?}` — ticker, name, exchange, and the share class
 * when a company lists two (Alphabet's A and C, Berkshire's A and B) —
 * alphabetical by name.
 *
 * `nasdaq` is nasdaqlisted.txt; `other` is otherlisted.txt, which carries the
 * NYSE: Oracle was missing from a list of Nasdaq alone (October 2026). Funds,
 * test issues, and the warrants, units, rights, notes and preferred shares that
 * share a company's name are left out. NYSE Arca and Cboe list funds.
 */
export function readListings({ nasdaq = '', other = '' } = {}) {
  const out = new Map();
  const read = (text, pick) => {
    const lines = String(text ?? '').split(/\r?\n/);
    const head = lines[0]?.split('|') ?? [];
    const col = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
    for (const line of lines.slice(1)) {
      const f = line.split('|');
      const row = pick(f, col);
      if (!row || out.has(row.s)) continue;
      const security = (f[col['Security Name']] ?? '').replace(/\s+/g, ' ').trim();
      if (f[col['Test Issue']] === 'Y' || f[col.ETF] === 'Y' || NOT_SHARES.test(security)) continue;
      const name = security.replace(SECURITY_WORDS, '').trim();
      if (!name) continue;
      // The class from the name, or from the ticker: BRK.B is Berkshire's B shares.
      const shareClass = /\bClass ([A-Z])\b/.exec(security)?.[1] ?? /\.([A-Z])$/.exec(row.s)?.[1];
      out.set(row.s, { s: row.s, n: name, x: row.x, ...(shareClass ? { c: shareClass } : {}) });
    }
  };
  read(nasdaq, (f, col) => {
    const s = f[col.Symbol]?.trim();
    return s && /^[A-Z]{1,5}$/.test(s) ? { s, x: 'Nasdaq' } : null;
  });
  read(other, (f, col) => {
    const s = f[col['ACT Symbol']]?.trim();
    const x = EXCHANGES[f[col.Exchange]?.trim()];
    return s && x && /^[A-Z]{1,5}(\.[A-Z])?$/.test(s) ? { s, x } : null;
  });
  const list = [...out.values()];
  // The class only tells two listings of one company apart; alone it is noise.
  const seen = new Map();
  for (const c of list) seen.set(c.n, (seen.get(c.n) ?? 0) + 1);
  for (const c of list) if (seen.get(c.n) === 1) delete c.c;
  return list.sort((a, b) => a.n.localeCompare(b.n, 'en', { sensitivity: 'base' }) || a.s.localeCompare(b.s));
}

/* ───────────────────────── fetching ───────────────────────── */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const SESSION_MS = 6 * 60 * 60 * 1000;
let session = null;

/** A Yahoo cookie and crumb, kept for a few hours and renewed when refused. */
async function yahooSession(fetcher, renew = false) {
  if (!renew && session && Date.now() - session.at < SESSION_MS) return session;
  const first = await fetcher('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(8000) });
  const cookies = (first.headers.getSetCookie?.() ?? [first.headers.get('set-cookie')].filter(Boolean))
    .map((c) => c.split(';')[0]).join('; ');
  if (!cookies) throw new Error('Yahoo gave no session.');
  const crumbRes = await fetcher('https://query2.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: cookies }, signal: AbortSignal.timeout(8000) });
  const crumb = (await crumbRes.text()).trim();
  if (!crumbRes.ok || !crumb || crumb.length > 40) throw new Error('Yahoo gave no crumb.');
  session = { cookie: cookies, crumb, at: Date.now() };
  return session;
}

async function yahooJson(fetcher, url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await yahooSession(fetcher, attempt > 0);
    const res = await fetcher(`${url}${url.includes('?') ? '&' : '?'}crumb=${encodeURIComponent(s.crumb)}`, {
      headers: { 'User-Agent': UA, Cookie: s.cookie, Accept: 'application/json' }, signal: AbortSignal.timeout(10000),
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
  // Yahoo writes a class with a dash: BRK.B is BRK-B.
  const yahoo = symbol.replace(/\./g, '-');
  const now = Math.floor(Date.now() / 1000);
  const [summary, series] = await Promise.all([
    yahooJson(fetcher, `${base}/v10/finance/quoteSummary/${encodeURIComponent(yahoo)}?modules=earnings,calendarEvents,earningsTrend,price`),
    yahooJson(fetcher, `${base}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(yahoo)}?type=quarterlyTotalRevenue&period1=${now - 600 * 86400}&period2=${now}`)
      .catch(() => null),
  ]);
  const result = summary?.quoteSummary?.result?.[0];
  const value = result ? readCompany(symbol, result, readRevenueSeries(series)) : null;
  cache.set(symbol, { at: Date.now(), value });
  return value;
}

let listed = { at: 0, list: null };
const DIRECTORY = 'https://www.nasdaqtrader.com/dynamic/SymDir';

/** Both of Nasdaq's directories, as text. */
export async function fetchDirectories(fetcher = fetch) {
  const [nasdaq, other] = await Promise.all(['nasdaqlisted.txt', 'otherlisted.txt'].map(async (file) => {
    const res = await fetcher(`${DIRECTORY}/${file}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Nasdaq answered ${res.status}.`);
    return res.text();
  }));
  return { nasdaq, other };
}

/**
 * Every company listed on Nasdaq, the NYSE and NYSE American, alphabetical,
 * refreshed daily.
 *
 * From Nasdaq's directories when they answer, and otherwise from the copy kept
 * in the repository (listedCompanies.js, `npm run refresh:listings`): on the
 * day the picker shipped the directory answered from a laptop and not from
 * Vercel, and the picker said the list was unavailable. A failed attempt is
 * not retried for an hour, so the copy serves at once in the meantime.
 */
export async function listedCompanies(fetcher = fetch) {
  if (listed.list && Date.now() - listed.at < (listed.live ? DAY : 60 * 60 * 1000)) return listed.list;
  try {
    const list = readListings(await fetchDirectories(fetcher));
    if (list.length < 3000) throw new Error('The list came back short.');
    listed = { at: Date.now(), list, live: true };
  } catch {
    const { COMPANIES } = await import('./listedCompanies.js');
    listed = { at: Date.now(), list: COMPANIES, live: false };
  }
  return listed.list;
}
