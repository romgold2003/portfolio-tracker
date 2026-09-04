#!/usr/bin/env node
// Build a liquidation map from real exchange data and print levels you can paste
// into the "Paste levels" field of the Liquidation Levels indicator.
//
// This exists because Pine Script cannot make HTTP requests. The indicator models
// the map from what TradingView carries; this script models it from the exchange
// directly, where two things are available that Pine cannot see:
//
//   1. real taker buy/sell volume, instead of inferring aggression from candle shape
//   2. open-interest history at a finer grain than the chart timeframe
//
// No API key, no dependencies. Node 18+.
//
//   node fetch-levels.mjs                                  BTC, 1h, Binance
//   node fetch-levels.mjs --coin ETH --interval 15m
//   node fetch-levels.mjs --source hyperliquid --coin BTC
//   node fetch-levels.mjs --levels 15 --json

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    const key = a.slice(2);
    const next = process.argv[i + 1];
    if (next && !next.startsWith("--")) { args.set(key, next); i++; }
    else args.set(key, "true");
  }
}

const COIN     = (args.get("coin") || "BTC").toUpperCase();
const INTERVAL = args.get("interval") || "1h";
const SOURCE   = (args.get("source") || "binance").toLowerCase();
const LEVELS   = parseInt(args.get("levels") || "12", 10);
const BUCKET   = parseFloat(args.get("bucket") || "0.25") / 100;   // log bucket width
const MERGE    = parseFloat(args.get("merge")  || "0.75") / 100;   // cluster merge distance
const BAND     = parseFloat(args.get("band")   || "20")   / 100;   // ignore levels beyond this
const DECAY    = parseFloat(args.get("decay")  || "0.15") / 100;   // per interval
const MM       = parseFloat(args.get("mm")     || "0.5")  / 100;   // maintenance margin
const AS_JSON  = args.has("json");

const TIERS = [
  { lev: 10,  w: 1.0 },
  { lev: 25,  w: 1.0 },
  { lev: 50,  w: 0.8 },
  { lev: 100, w: 0.6 },
];

const LOG_G = Math.log(1 + BUCKET);
const idxOf   = (p) => Math.floor(Math.log(p) / LOG_G);
const bktLo   = (i) => Math.exp(i * LOG_G);
const bktHi   = (i) => Math.exp((i + 1) * LOG_G);
const bktMid  = (i) => Math.exp((i + 0.5) * LOG_G);

async function getJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`);
  return res.json();
}

// ---------------------------------------------------------------- binance
// Returns bars with real taker flow and open interest, oldest first.
async function loadBinance() {
  const symbol = `${COIN}USDT`;
  const [klines, oiHist] = await Promise.all([
    getJson(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${INTERVAL}&limit=500`),
    getJson(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=${INTERVAL}&limit=500`),
  ]);

  // openInterestHist only goes back 30 days, so it is usually the shorter series.
  const oiAt = new Map(oiHist.map((o) => [o.timestamp, parseFloat(o.sumOpenInterest)]));

  return klines.map((k) => ({
    time:  k[0],
    open:  parseFloat(k[1]),
    high:  parseFloat(k[2]),
    low:   parseFloat(k[3]),
    close: parseFloat(k[4]),
    vol:   parseFloat(k[5]),
    takerBuy: parseFloat(k[9]),   // real aggressive-buy base volume
    oi:    oiAt.has(k[0]) ? oiAt.get(k[0]) : null,
  }));
}

// ------------------------------------------------------------ hyperliquid
// Hyperliquid publishes current open interest but no open-interest *history*,
// so there is no way to tell opening flow from closing flow after the fact.
// This path therefore falls back to the volume model and says so.
async function loadHyperliquid() {
  const end = Date.now();
  const ms = { "1m": 6e4, "5m": 3e5, "15m": 9e5, "1h": 36e5, "4h": 144e5, "1d": 864e5 }[INTERVAL] || 36e5;
  const candles = await getJson("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "candleSnapshot",
      req: { coin: COIN, interval: INTERVAL, startTime: end - ms * 500, endTime: end },
    }),
  });
  if (!candles.length) throw new Error(`Hyperliquid returned no candles for ${COIN} ${INTERVAL}`);

  return candles.map((c) => ({
    time:  c.t,
    open:  parseFloat(c.o),
    high:  parseFloat(c.h),
    low:   parseFloat(c.l),
    close: parseFloat(c.c),
    vol:   parseFloat(c.v),
    takerBuy: null,   // not published per candle
    oi:    null,      // no history endpoint
  }));
}

// ------------------------------------------------------------------ model
function buildMap(bars) {
  const heat = new Map();   // bucket index -> { l, s }
  const bump = (i, l, s) => {
    const cur = heat.get(i) || { l: 0, s: 0 };
    cur.l += l; cur.s += s;
    heat.set(i, cur);
  };

  let usedOI = false;

  for (let n = 0; n < bars.length; n++) {
    const b = bars[n];
    const prev = bars[n - 1];

    // positions fade
    if (DECAY > 0) for (const v of heat.values()) { v.l *= 1 - DECAY; v.s *= 1 - DECAY; }

    // anything price traded through is already liquidated
    for (let i = idxOf(b.low); i <= idxOf(b.high); i++) heat.delete(i);

    // notional opened on this bar
    let opened;
    if (b.oi != null && prev && prev.oi != null) {
      opened = Math.max(b.oi - prev.oi, 0) * ((b.high + b.low) / 2);
      usedOI = true;
    } else {
      opened = b.vol * ((b.high + b.low) / 2) * 0.3;
    }
    if (opened <= 0) continue;

    // side split: real taker flow when we have it, candle shape otherwise
    const buyShare = b.takerBuy != null && b.vol > 0
      ? Math.min(Math.max(b.takerBuy / b.vol, 0), 1)
      : Math.min(Math.max((b.close - b.low) / Math.max(b.high - b.low, 1e-9), 0), 1);

    const entry = (b.high + b.low + b.close) / 3;
    const longNot = opened * buyShare;
    const shortNot = opened * (1 - buyShare);

    for (const { lev, w } of TIERS) {
      const gap = 1 / lev - MM;
      if (gap <= 0) continue;
      bump(idxOf(entry * (1 - gap)), longNot * w, 0);
      bump(idxOf(entry * (1 + gap)), 0, shortNot * w);
    }
  }

  return { heat, usedOI };
}

// Collapse neighbouring buckets into the handful of levels that actually matter.
function cluster(heat, price) {
  const live = [...heat.entries()]
    .filter(([i, v]) => v.l + v.s > 0 && Math.abs(bktMid(i) / price - 1) <= BAND)
    .sort((a, b) => a[0] - b[0]);

  const out = [];
  for (const [i, v] of live) {
    const t = v.l + v.s;
    const last = out[out.length - 1];
    if (last && bktLo(i) <= last.hi * (1 + MERGE)) {
      last.hi = Math.max(last.hi, bktHi(i));
      last.l += v.l; last.s += v.s; last.total += t;
      last.num += bktMid(i) * t;
    } else {
      out.push({ lo: bktLo(i), hi: bktHi(i), l: v.l, s: v.s, total: t, num: bktMid(i) * t });
    }
  }
  for (const c of out) c.price = c.num / c.total;
  return out.sort((a, b) => b.total - a.total).slice(0, LEVELS);
}

const usd = (v) =>
  v >= 1e9 ? (v / 1e9).toFixed(2) + "B" :
  v >= 1e6 ? (v / 1e6).toFixed(2) + "M" :
  v >= 1e3 ? (v / 1e3).toFixed(1) + "K" : v.toFixed(0);

// ------------------------------------------------------------------- main
try {
  const bars = SOURCE === "hyperliquid" ? await loadHyperliquid() : await loadBinance();
  if (bars.length < 10) throw new Error(`only ${bars.length} bars returned; nothing to model`);

  const { heat, usedOI } = buildMap(bars);
  const price = bars[bars.length - 1].close;
  const clusters = cluster(heat, price);
  if (!clusters.length) throw new Error("no clusters survived; try a wider --band");

  const max = clusters[0].total;
  const paste = clusters
    .map((c) => `${c.price.toFixed(1)}:${(1 + 5 * Math.pow(c.total / max, 0.6)).toFixed(1)}`)
    .join(", ");

  if (AS_JSON) {
    console.log(JSON.stringify({ coin: COIN, source: SOURCE, interval: INTERVAL, price, usedOI, clusters, paste }, null, 2));
  } else {
    console.log(`\n  ${COIN}  ${INTERVAL}  ${SOURCE}   price ${price.toFixed(1)}   ${bars.length} bars`);
    console.log(usedOI
      ? "  open interest: yes, with real taker flow"
      : "  open interest: NOT available, fell back to the volume model (levels are rougher)");
    console.log("\n  Level          Dist      Side     Size");
    console.log("  " + "-".repeat(44));
    for (const c of clusters) {
      const dist = (c.price / price - 1) * 100;
      const side = c.l >= c.s ? "long " : "short";
      console.log(
        `  ${c.price.toFixed(1).padStart(11)}  ${(dist >= 0 ? "+" : "") + dist.toFixed(2) + "%"}`.padEnd(28) +
        `${side}    $${usd(c.total)}`
      );
    }
    console.log("\n  Paste this into the indicator's \"price:size\" field:\n");
    console.log("  " + paste + "\n");
  }
} catch (err) {
  console.error(`\n  failed: ${err.message}\n`);
  process.exit(1);
}
