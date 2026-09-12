const url = 'https://query1.finance.yahoo.com/v8/finance/chart/ETHA?interval=1d&range=10d&events=div%2Csplit';
const j = await (await fetch(url, { headers: { 'User-Agent': 'portfolio-tracker', Accept: 'application/json' } })).json();
const r = j?.chart?.result?.[0];
const m = r?.meta ?? {};
console.log('meta.regularMarketPrice   ', m.regularMarketPrice);
console.log('meta.chartPreviousClose   ', m.chartPreviousClose);
console.log('meta.previousClose        ', m.previousClose);
console.log('events                    ', JSON.stringify(r?.events ?? {}));
console.log('');
const ts = r.timestamp, q = r.indicators.quote[0], adj = r.indicators.adjclose?.[0]?.adjclose;
console.log('date         close     adjclose    volume');
for (let i = 0; i < ts.length; i++) {
  console.log(
    new Date(ts[i]*1000).toISOString().slice(0,10),
    String(q.close[i]).padStart(9),
    String(adj ? adj[i] : '-').padStart(11),
    String(q.volume[i]).padStart(11));
}
