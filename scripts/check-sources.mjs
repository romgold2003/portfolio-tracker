/**
 * Is every outside source Riskbook reads still answering, and in the shape it
 * reads? (November 2026.)
 *
 * Asked for after Polymarket retired its v1 trades feed and Prediction Markets
 * went blank with nothing to say why. Each check asks the same address the app
 * asks and looks for the fields the app reads, so a source that moved, was
 * retired, started refusing, or renamed a field shows up here first.
 *
 *   node scripts/check-sources.mjs          a table; exits 1 if anything broke
 *   node scripts/check-sources.mjs --json   the same as JSON, for a routine
 *
 * Needs no keys and no account. Sources that need a key are only checked for
 * still existing (a 401 or 403 is fine there; a 404, 410 or 5xx is not).
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TIMEOUT_MS = 25_000;

const isArr = (v) => Array.isArray(v) && v.length > 0;
const need = (ok, why) => (ok ? null : why);

/**
 * Each: what it is, where the app uses it, the address, and what must be in
 * the answer — a function returning null when it is right, or what is wrong.
 */
const SOURCES = [
  // Prices and history
  {
    name: 'Yahoo chart (prices, history, Fed futures, week start)',
    used: 'api/quote.js, api/history.js, api/_panels/fed.js, api/_panels/weekstart.js',
    url: 'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=5d&interval=1d',
    json: (j) => need(j?.chart?.result?.[0]?.meta?.regularMarketPrice > 0 && isArr(j.chart.result[0].indicators?.quote?.[0]?.close), 'no chart.result[0] with a price and closes'),
  },
  {
    name: 'Yahoo earnings (cookie, crumb, quoteSummary)',
    used: 'api/_lib/earnings.js',
    url: 'https://query2.finance.yahoo.com/v10/finance/quoteSummary/MSFT?modules=earnings,calendarEvents,earningsTrend,price',
    // The same three steps as yahooSession: a cookie from fc.yahoo.com, a crumb, then the summary.
    run: async (signal) => {
      const first = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, redirect: 'manual', signal });
      const cookie = (first.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
      if (!cookie) return { status: first.status, problem: 'fc.yahoo.com set no cookie' };
      const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: cookie }, signal });
      const crumb = (await crumbRes.text()).trim();
      if (!crumbRes.ok || !crumb || crumb.length > 40) return { status: crumbRes.status, problem: 'no crumb' };
      const res = await fetch(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/MSFT?modules=earnings,calendarEvents,earningsTrend,price&crumb=${encodeURIComponent(crumb)}`, { headers: { 'User-Agent': UA, Cookie: cookie }, signal });
      const j = await res.json().catch(() => null);
      const r = j?.quoteSummary?.result?.[0];
      return { status: res.status, problem: need(r?.earningsTrend?.trend && r?.calendarEvents && r?.price, 'no quoteSummary.result[0] with earningsTrend, calendarEvents and price') };
    },
  },
  {
    name: 'Nasdaq quote (pre-market and after-hours prices)',
    used: 'api/quote.js (nasdaqExtended)',
    url: 'https://api.nasdaq.com/api/quote/AAPL/info?assetclass=stocks',
    // The same headers api/quote.js sends; without a browser's, Nasdaq does not answer.
    run: async (signal) => {
      const res = await fetch('https://api.nasdaq.com/api/quote/AAPL/info?assetclass=stocks', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
          Accept: 'application/json, text/plain, */*', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/',
        },
        signal,
      });
      const d = (await res.json().catch(() => null))?.data;
      return {
        status: res.status,
        problem: need(typeof d?.marketStatus === 'string' && /\$[\d,.]+/.test(d?.primaryData?.lastSalePrice ?? '') && 'isRealTime' in (d?.primaryData ?? {}),
          'no data.marketStatus and primaryData.lastSalePrice / isRealTime'),
      };
    },
  },
  {
    name: 'Nasdaq Trader listings',
    used: 'api/_lib/earnings.js (company picker)',
    url: 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt',
    text: (t) => need(/^Symbol\|Security Name\|/m.test(t) && t.split('\n').length > 1000, 'header "Symbol|Security Name|" or the rows are missing'),
  },
  {
    name: 'Nasdaq Trader other listings (NYSE)',
    used: 'api/_lib/earnings.js (company picker)',
    url: 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt',
    text: (t) => need(/^ACT Symbol\|Security Name\|/m.test(t), 'header "ACT Symbol|Security Name|" is missing'),
  },
  {
    name: 'CoinGecko markets',
    used: 'api/_lib/topcoins.js, crypto prices',
    url: 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=5&page=1',
    json: (j) => need(isArr(j) && j[0].id && j[0].current_price > 0 && j[0].symbol, 'no list of coins with id, symbol and current_price'),
  },
  // News page
  {
    name: 'FRED (effective Fed funds, economic actuals)',
    used: 'api/_panels/fed.js, api/_lib/fred.js',
    url: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=EFFR',
    text: (t) => need(/^observation_date,EFFR|^DATE,EFFR/m.test(t) && /\d{4}-\d{2}-\d{2},\d/.test(t), 'header "observation_date,EFFR" or dated values missing'),
  },
  {
    name: 'BLS (economic actuals)',
    used: 'api/_lib/bls.js',
    url: 'https://api.bls.gov/publicAPI/v2/timeseries/data/LNS14000000',
    json: (j) => need(j?.status === 'REQUEST_SUCCEEDED' && isArr(j?.Results?.series?.[0]?.data), 'status is not REQUEST_SUCCEEDED or no series data'),
  },
  {
    name: 'ForexFactory calendar',
    used: 'api/_lib/econ.js (US data this week)',
    url: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
    json: (j) => need(isArr(j) && 'title' in j[0] && 'country' in j[0] && 'date' in j[0] && 'forecast' in j[0], 'no events with title, country, date and forecast'),
  },
  {
    name: 'Polymarket events (Fed odds, prediction markets)',
    used: 'api/_panels/fed.js, src/services/gamble.js',
    url: 'https://gamma-api.polymarket.com/events?closed=false&limit=3&order=volume24hr&ascending=false',
    json: (j) => need(isArr(j) && j[0].id && Array.isArray(j[0].markets) && j[0].markets[0]?.conditionId, 'no events with id and markets[].conditionId'),
  },
  {
    name: 'Polymarket markets',
    used: 'src/services/gamble.js (settled markets)',
    url: 'https://gamma-api.polymarket.com/markets?limit=2',
    json: (j) => need(isArr(j) && 'conditionId' in j[0] && 'closed' in j[0], 'no markets with conditionId and closed'),
  },
  {
    name: 'Polymarket trades v2 (big bets)',
    used: 'src/services/gamble.js',
    url: 'https://data-api.polymarket.com/v2/trades?limit=5&filterType=CASH&filterAmount=10000',
    json: (j) => need(Array.isArray(j?.data) && (j.data.length === 0 || (j.data[0].condition_id && j.data[0].proxy_wallet && j.data[0].size > 0)), 'no data[] with condition_id, proxy_wallet and size'),
  },
  {
    name: 'Kalshi (Fed odds)',
    used: 'api/_panels/fed.js',
    url: 'https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=2',
    json: (j) => need(Array.isArray(j?.markets), 'no markets[]'),
  },
  {
    name: 'Fear & Greed',
    used: 'api/_panels/sentiment.js',
    url: 'https://feargreedmeter.com/',
    text: (t) => need(/fear|greed/i.test(t) && t.length > 2000, 'the page no longer mentions fear or greed'),
  },
  {
    name: 'Deribit options (BTC)',
    used: 'api/_panels/options.js',
    url: 'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option',
    json: (j) => need(isArr(j?.result) && j.result[0].instrument_name && 'open_interest' in j.result[0], 'no result[] with instrument_name and open_interest'),
  },
  {
    name: 'Cboe options (SPX)',
    used: 'api/_panels/options.js',
    url: 'https://cdn.cboe.com/api/global/delayed_quotes/options/_SPX.json',
    json: (j) => need(isArr(j?.data?.options) && j.data.options[0].option && 'gamma' in j.data.options[0], 'no data.options[] with option and gamma'),
  },
  {
    name: 'SoSoValue ETF flows',
    used: 'api/_panels/etf.js',
    // Needs the deployment's SOSO_API_KEY; CoinMarketCap below is read first anyway.
    url: 'https://openapi.sosovalue.com/openapi/v2/etf/historicalInflowChart',
    method: 'POST',
    body: { type: 'us-btc-spot' },
    keyed: true,
  },
  {
    name: 'CoinMarketCap ETF flows',
    used: 'api/_panels/etf.js',
    url: 'https://api.coinmarketcap.com/data-api/v3/etf/overview/netflow/chart?category=btc&range=30d',
    json: (j) => need(j?.data != null, 'no data'),
  },
  // Crypto page
  {
    name: 'Hyperliquid',
    used: 'crypto whales, positioning',
    url: 'https://api.hyperliquid.xyz/info',
    method: 'POST',
    body: { type: 'meta' },
    json: (j) => need(isArr(j?.universe) && j.universe[0].name, 'no universe[] with name'),
  },
  {
    name: 'GMX (Arbitrum)',
    used: 'api/_lib/gmxlev.js',
    url: 'https://arbitrum-api.gmxinfra.io/prices/tickers',
    json: (j) => need(isArr(j) && j[0].tokenSymbol, 'no tickers with tokenSymbol'),
  },
  {
    name: 'GeckoTerminal (DEX spot)',
    used: 'api/_lib/dexspot.js',
    url: 'https://api.geckoterminal.com/api/v2/networks/eth/trending_pools',
    json: (j) => need(isArr(j?.data) && j.data[0].attributes, 'no data[] with attributes'),
  },
  {
    name: 'DefiLlama exchanges',
    used: 'api/_lib/cexflow.js',
    url: 'https://api.llama.fi/cexs',
    json: (j) => need(isArr(j?.cexs) || isArr(j), 'no cexs[]'),
  },
  {
    name: 'DefiLlama stablecoins',
    used: 'api/_lib/stablecoins.js',
    url: 'https://stablecoins.llama.fi/stablecoincharts/all',
    json: (j) => need(isArr(j) && j[0].date && j[0].totalCirculating, 'no days with date and totalCirculating'),
  },
  {
    name: 'TradingView stablecoin dominance',
    used: 'api/_lib/stablecoins.js',
    url: 'https://scanner.tradingview.com/symbol?symbol=CRYPTOCAP%3ASTABLE.C.D&fields=close,change_abs',
    json: (j) => need(typeof j?.close === 'number', 'no close'),
  },
  {
    name: 'Exchange wallet labels',
    used: 'api/_lib/exchanges.js',
    url: 'https://raw.githubusercontent.com/brianleect/etherscan-labels/main/data/etherscan/combined/combinedAllLabels.json',
    json: (j) => need(j && typeof j === 'object' && Object.keys(j).length > 100, 'the labels file is gone or empty'),
  },
  {
    name: 'Bitcoin mempool',
    used: 'api/_lib/chainfeeds.js',
    url: 'https://blockchain.info/unconfirmed-transactions?format=json&limit=5',
    json: (j) => need(Array.isArray(j?.txs), 'no txs[]'),
  },
  {
    name: 'Whale Alert status',
    used: 'api/_lib/whalealert.js',
    url: 'https://leviathan.whale-alert.io/status',
    keyed: true,
  },
  // Keyed: only that they still exist.
  { name: 'Finnhub quote (user key)', used: 'src/services/prices.js', url: 'https://finnhub.io/api/v1/quote?symbol=AAPL', keyed: true },
  { name: 'Alpha Vantage (user key)', used: 'src/services/benchmark.js', url: 'https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=SPY', keyed: true },
];

async function check(source) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    if (source.run) {
      const { status, problem } = await source.run(controller.signal);
      return { ...source, ok: !problem, status, ms: Date.now() - started, problem };
    }
    const res = await fetch(source.url, {
      method: source.method ?? 'GET',
      headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*', ...(source.body ? { 'Content-Type': 'application/json' } : {}) },
      body: source.body ? JSON.stringify(source.body) : undefined,
      signal: controller.signal,
      redirect: 'follow',
    });
    const ms = Date.now() - started;
    if (source.keyed) {
      const gone = res.status === 404 || res.status === 410 || res.status >= 500;
      return { ...source, ok: !gone, status: res.status, ms, problem: gone ? `answered ${res.status}` : null };
    }
    const raw = await res.text();
    if (!res.ok) return { ...source, ok: false, status: res.status, ms, problem: `answered ${res.status}: ${raw.slice(0, 160).replace(/\s+/g, ' ')}` };
    let problem = null;
    if (source.json) {
      let body;
      try { body = JSON.parse(raw); } catch { problem = `not JSON: ${raw.slice(0, 120).replace(/\s+/g, ' ')}`; }
      if (!problem) problem = source.json(body);
    } else if (source.text) {
      problem = source.text(raw);
    }
    return { ...source, ok: !problem, status: res.status, ms, problem };
  } catch (err) {
    return { ...source, ok: false, status: 0, ms: Date.now() - started, problem: err.name === 'AbortError' ? `no answer in ${TIMEOUT_MS / 1000}s` : err.message };
  } finally {
    clearTimeout(timer);
  }
}

const results = [];
// A few at a time: some of these rate-limit a burst from one address.
for (let i = 0; i < SOURCES.length; i += 4) {
  results.push(...await Promise.all(SOURCES.slice(i, i + 4).map(check)));
}

const broken = results.filter((r) => !r.ok);
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    broken: broken.length,
    results: results.map(({ name, used, url, ok, status, ms, problem }) => ({ name, used, url, ok, status, ms, problem })),
  }, null, 2));
} else {
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${String(r.status).padEnd(3)}  ${String(r.ms).padStart(5)}ms  ${r.name}${r.problem ? `\n        ${r.problem}\n        used by ${r.used}` : ''}`);
  console.log(`\n${results.length - broken.length} of ${results.length} sources fine${broken.length ? `, ${broken.length} broken` : ''}.`);
}
process.exitCode = broken.length ? 1 : 0;
