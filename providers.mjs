/**
 * Every external provider the app depends on, asked directly.
 *
 * Not through the app — straight at the provider, so a failure here is the
 * provider's and a failure the app reports is the app's.
 */
const PROVIDERS = [
  ['CoinGecko markets', 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=1&page=1', 'crypto prices, top-50 list', 'none'],
  ['CoinGecko global', 'https://api.coingecko.com/api/v3/global', 'stablecoin dominance denominator', 'none'],
  ['Blockscout Ethereum', 'https://eth.blockscout.com/api/v2/stats', 'ETH transfers, token holders', 'none'],
  ['Blockscout Polygon', 'https://polygon.blockscout.com/api/v2/stats', 'Polygon transfers, holders', 'none'],
  ['Tronscan', 'https://apilist.tronscanapi.com/api/token_trc20/transfers?limit=1&start=0&sort=-timestamp', 'Tron transfers', 'none'],
  ['XRPL', 'https://s1.ripple.com:51234/', 'XRP payments', 'none', { method: 'POST', body: { method: 'server_info', params: [{}] } }],
  ['blockchain.info', 'https://blockchain.info/unconfirmed-transactions?format=json&limit=1', 'Bitcoin transfers', 'none'],
  ['DefiLlama CEX list', 'https://api.llama.fi/cexs', 'exchange balance history', 'none'],
  ['DefiLlama stablecoins', 'https://stablecoins.llama.fi/stablecoincharts/all', 'stablecoin market cap history', 'none'],
  ['Etherscan label mirror', 'https://raw.githubusercontent.com/brianleect/etherscan-labels/main/data/etherscan/combined/combinedAllLabels.json', 'exchange address labels', 'none'],
  ['Yahoo Finance', 'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d&interval=1d', 'stock quotes, week start', 'none'],
  ['FRED', 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10', 'macro series', 'none'],
  ['BLS', 'https://api.bls.gov/publicAPI/v2/timeseries/data/CUUR0000SA0', 'CPI', 'none'],
  ['Federal Reserve', 'https://www.federalreserve.gov/feeds/press_all.xml', 'Fed press releases', 'none'],
  ['Fear & Greed', 'https://feargreedmeter.com/api/fear-and-greed-index', 'sentiment gauge', 'none'],
  ['Polymarket gamma', 'https://gamma-api.polymarket.com/markets?limit=1', 'macro whale bets', 'none'],
  ['Kalshi', 'https://api.elections.kalshi.com/trade-api/v2/markets?limit=1', 'Fed probabilities', 'none'],
  ['Deribit', 'https://www.deribit.com/api/v2/public/get_index_price?index_name=btc_usd', 'options', 'none'],
  ['CBOE', 'https://cdn.cboe.com/api/global/delayed_quotes/options/_SPX.json', 'options chain', 'none'],
  ['SoSoValue', 'https://api.sosovalue.xyz/openapi/v2/etf/currentEtfDataMetrics', 'ETF flows', 'key'],
  ['Faireconomy', 'https://nfs.faireconomy.media/ff_calendar_thisweek.json', 'economic calendar', 'none'],
];

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
console.log(`${pad('PROVIDER', 26)}${pad('CODE', 6)}${pad('TIME', 8)}${pad('BYTES', 10)}FEATURE`);

const results = [];
for (const [name, url, feature, auth, opts = {}] of PROVIDERS) {
  const t0 = Date.now();
  let status = 0;
  let bytes = 0;
  let err = null;
  try {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    status = res.status;
    bytes = (await res.text()).length;
  } catch (e) {
    err = e.message;
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  results.push({ name, status, secs, bytes, feature, auth, err });
  console.log(`${pad(name, 26)}${pad(status || 'ERR', 6)}${pad(`${secs}s`, 8)}`
    + `${pad(bytes ? `${(bytes / 1024).toFixed(0)}KB` : '—', 10)}${feature}${err ? `  [${err}]` : ''}`);
}

const down = results.filter((r) => r.status === 0 || r.status >= 400);
console.log(`\n${results.length - down.length}/${results.length} providers answering`);
if (down.length) {
  console.log('\nNOT ANSWERING:');
  for (const r of down) console.log(`  ${r.name} (${r.status || r.err}) — used for: ${r.feature}`);
}
