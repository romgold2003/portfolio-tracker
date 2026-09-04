#!/usr/bin/env node
// TRUE liquidation levels from Hyperliquid.
//
// Every other tool here estimates. This one does not. Hyperliquid is an on-chain
// perp exchange, so each account's positions are public, and the API reports the
// exact liquidation price the exchange itself will use:
//
//   {"type":"clearinghouseState","user":"0x..."} -> assetPositions[].position.liquidationPx
//
// So we enumerate accounts, read their real positions, and bucket the real
// liquidation prices weighted by real notional. No leverage guessing, no open
// interest inference, no candle-shape proxy for taker flow.
//
// Two things stop this from being the whole truth, and you should know both:
//
//   1. COVERAGE. Accounts come from the public leaderboard (~45k addresses). That
//      is the large traders, not every account. Treat the output as "where the
//      big money gets liquidated", not "all liquidity".
//   2. CROSS MARGIN. A cross position's liquidationPx depends on the whole
//      portfolio, so it moves when unrelated positions move, and is often absurdly
//      far away. Isolated positions have a stable, meaningful liqPx.
//      --isolated-only gives you the trustworthy subset.
//
// No API key, no dependencies. Node 18+.
//
//   node fetch-hyperliquid-true.mjs --coin BTC --limit 2000
//   node fetch-hyperliquid-true.mjs --coin ETH --isolated-only
//   node fetch-hyperliquid-true.mjs --coin BTC --limit 5000 --json

import { writeFileSync } from "node:fs";

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    const k = a.slice(2), n = process.argv[i + 1];
    if (n && !n.startsWith("--")) { args.set(k, n); i++; } else args.set(k, "true");
  }
}

const COIN     = (args.get("coin") || "BTC").toUpperCase();
const LIMIT    = parseInt(args.get("limit") || "1500", 10);
const CONC     = parseInt(args.get("concurrency") || "8", 10);
const LEVELS   = parseInt(args.get("levels") || "12", 10);
const BUCKET   = parseFloat(args.get("bucket") || "0.25") / 100;
const MERGE    = parseFloat(args.get("merge") || "0.75") / 100;
const BAND     = parseFloat(args.get("band") || "35") / 100;
const ISO_ONLY = args.has("isolated-only");
const AS_JSON  = args.has("json");
const WATCH    = args.has("watch") ? Math.max(parseInt(args.get("watch"), 10) || 300, 60) : 0;
const OUT      = args.get("out") || null;

const LOG_G  = Math.log(1 + BUCKET);
const idxOf  = (p) => Math.floor(Math.log(p) / LOG_G);
const bktLo  = (i) => Math.exp(i * LOG_G);
const bktHi  = (i) => Math.exp((i + 1) * LOG_G);
const bktMid = (i) => Math.exp((i + 0.5) * LOG_G);

const usd = (v) =>
  v >= 1e9 ? (v / 1e9).toFixed(2) + "B" :
  v >= 1e6 ? (v / 1e6).toFixed(2) + "M" :
  v >= 1e3 ? (v / 1e3).toFixed(1) + "K" : v.toFixed(0);

const INFO = "https://api.hyperliquid.xyz/info";

async function info(body, tries = 4) {
  for (let t = 0; t < tries; t++) {
    const res = await fetch(INFO, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    // 429 is the rate limiter; back off and try again rather than losing the account
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** t));
      continue;
    }
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return null;
}

async function markPrice() {
  const [meta, ctxs] = await info({ type: "metaAndAssetCtxs" });
  const i = meta.universe.findIndex((u) => u.name === COIN);
  if (i < 0) throw new Error(`${COIN} is not listed on Hyperliquid`);
  return parseFloat(ctxs[i].markPx);
}

async function addresses() {
  const res = await fetch("https://stats-data.hyperliquid.xyz/Mainnet/leaderboard");
  if (!res.ok) throw new Error(`leaderboard: ${res.status}`);
  const { leaderboardRows = [] } = await res.json();
  // Biggest accounts first - they carry the notional that actually moves price.
  return leaderboardRows
    .map((r) => ({ addr: r.ethAddress, av: parseFloat(r.accountValue) || 0 }))
    .sort((a, b) => b.av - a.av)
    .slice(0, LIMIT)
    .map((r) => r.addr);
}

// Walk the address list with a small worker pool so we stay under the rate limit.
async function scan(addrs, onPos) {
  let next = 0, done = 0, failed = 0;
  const worker = async () => {
    while (next < addrs.length) {
      const a = addrs[next++];
      try {
        const st = await info({ type: "clearinghouseState", user: a });
        if (st) for (const ap of st.assetPositions || []) {
          const p = ap.position;
          if (p.coin === COIN && p.liquidationPx) onPos(p, ap.type);
        }
      } catch { failed++; }
      if (++done % 250 === 0) process.stderr.write(`  scanned ${done}/${addrs.length}\r`);
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));
  process.stderr.write(" ".repeat(40) + "\r");
  return { done, failed };
}

async function runOnce(previous) {
  const t0 = Date.now();
  const [price, addrs] = await Promise.all([markPrice(), addresses()]);
  process.stderr.write(`  ${COIN} mark ${price}  -  scanning ${addrs.length} accounts\n`);

  const heat = new Map();               // bucket -> { long, short }
  let nPos = 0, nCross = 0, ntlSeen = 0, ntlUsed = 0;

  const { done, failed } = await scan(addrs, (p, marginType) => {
    const isCross = marginType === "oneWay" ? true : (p.leverage?.type !== "isolated");
    const liq = parseFloat(p.liquidationPx);
    const ntl = Math.abs(parseFloat(p.positionValue) || 0);
    const szi = parseFloat(p.szi);
    if (!isFinite(liq) || liq <= 0 || ntl <= 0) return;

    nPos++; ntlSeen += ntl;
    if (isCross) nCross++;
    if (ISO_ONLY && isCross) return;
    // A liquidation 35% away is not a level anyone trades against.
    if (Math.abs(liq / price - 1) > BAND) return;

    ntlUsed += ntl;
    const i = idxOf(liq);
    const cur = heat.get(i) || { long: 0, short: 0 };
    // szi > 0 is a long, and longs liquidate downward.
    if (szi > 0) cur.long += ntl; else cur.short += ntl;
    heat.set(i, cur);
  });

  // merge neighbours into levels
  const live = [...heat.entries()].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [i, v] of live) {
    const t = v.long + v.short;
    const last = out[out.length - 1];
    if (last && bktLo(i) <= last.hi * (1 + MERGE)) {
      last.hi = Math.max(last.hi, bktHi(i));
      last.long += v.long; last.short += v.short; last.total += t;
      last.num += bktMid(i) * t;
    } else {
      out.push({ lo: bktLo(i), hi: bktHi(i), long: v.long, short: v.short, total: t, num: bktMid(i) * t });
    }
  }
  for (const c of out) c.price = c.num / c.total;
  const clusters = out.sort((a, b) => b.total - a.total).slice(0, LEVELS);

  if (!clusters.length) throw new Error("no positions landed inside the band; try --band 60 or a bigger --limit");

  const max = clusters[0].total;
  const paste = clusters
    .map((c) => `${c.price.toFixed(1)}:${(1 + 5 * Math.pow(c.total / max, 0.6)).toFixed(1)}`)
    .join(", ");

  if (AS_JSON) {
    console.log(JSON.stringify({ coin: COIN, price, accounts: done, positions: nPos, cross: nCross, ntlSeen, ntlUsed, clusters, paste }, null, 2));
  } else {
    const stamp = new Date().toLocaleTimeString();
    console.log(`\n  ${COIN}  Hyperliquid  TRUE liquidation prices   mark ${price}   ${stamp}`);
    console.log(`  ${done} accounts scanned (${failed} failed), ${nPos} open ${COIN} positions, ${nCross} cross-margin`);
    console.log(`  notional seen $${usd(ntlSeen)}, inside +/-${(BAND * 100).toFixed(0)}% $${usd(ntlUsed)}${ISO_ONLY ? ", isolated only" : ""}`);
    console.log("\n  Level          Dist      Side     Notional");
    console.log("  " + "-".repeat(46));
    for (const c of clusters) {
      const d = (c.price / price - 1) * 100;
      console.log(
        `  ${c.price.toFixed(1).padStart(11)}  ${(d >= 0 ? "+" : "") + d.toFixed(2) + "%"}`.padEnd(28) +
        `${c.long >= c.short ? "long " : "short"}    $${usd(c.total)}`
      );
    }

    // What changed since the last sweep. A level that vanished while price was
    // near it is a cluster that actually got liquidated - the wipe, in real data.
    if (previous) {
      const near = (a, b) => Math.abs(a / b - 1) <= MERGE;
      const gone = previous.clusters.filter((p) => !clusters.some((c) => near(c.price, p.price)));
      const fresh = clusters.filter((c) => !previous.clusters.some((p) => near(c.price, p.price)));
      if (gone.length || fresh.length) {
        console.log("");
        for (const g of gone) {
          const hit = Math.abs(g.price / previous.price - 1) <= 0.02 || (g.price - previous.price) * (price - previous.price) < 0;
          console.log(`  ${hit ? "LIQUIDATED" : "gone      "}  ${g.price.toFixed(1)}  $${usd(g.total)}`);
        }
        for (const f of fresh) console.log(`  new         ${f.price.toFixed(1)}  $${usd(f.total)}`);
      }
    }

    console.log("\n  Paste into the indicator's \"price:size\" field:\n");
    console.log("  " + paste);
    console.log(`\n  (${((Date.now() - t0) / 1000).toFixed(0)}s)${WATCH ? `  next sweep in ${WATCH}s` : ""}\n`);
  }

  if (OUT) writeFileSync(OUT, paste + "\n");
  return { price, clusters, paste };
}

try {
  let prev = null;
  for (;;) {
    prev = await runOnce(prev);
    if (!WATCH) break;
    await new Promise((r) => setTimeout(r, WATCH * 1000));
  }
} catch (err) {
  console.error(`\n  failed: ${err.message}\n`);
  process.exit(1);
}
