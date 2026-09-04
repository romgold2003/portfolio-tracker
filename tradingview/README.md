# Liquidation Levels for TradingView

[`liquidation-heatmap.pine`](liquidation-heatmap.pine) — a CoinGlass-style liquidation map drawn on
the chart, built from data TradingView already has.
[`tools/fetch-levels.mjs`](tools/fetch-levels.mjs) — pulls the same map from Binance or Hyperliquid
directly, for when you want real exchange numbers rather than a model.
[`tools/fetch-hyperliquid-true.mjs`](tools/fetch-hyperliquid-true.mjs) — the only *true* liquidation
prices available anywhere: real per-account positions read off Hyperliquid.

## Install

1. TradingView → **Pine Editor** → **Open** → *New indicator*.
2. Delete the template, paste the whole `.pine` file, **Save**, **Add to chart**.
3. Use a perpetual futures symbol so open interest exists: `BINANCE:BTCUSDT.P`,
   `BYBIT:BTCUSDT.P`, `OKX:BTC-USDT-SWAP`. On spot it falls back to a weaker volume model.

## What it draws

Two modes, set by `Mode` at the top of the settings.

**Heatmap** (default) — the CoinGlass look. Every surviving row is drawn from the bar where it
formed out to the right edge, on the **Viridis** ramp: deep purple for cold, teal and green through
the middle, bright yellow for the heaviest rows. Up to 480 rows, since TradingView caps drawings at
500 per indicator.

**Levels** — a short stub at the right edge showing only the dominant clusters, for when the full
heatmap is too busy.

Either way the top clusters get a **coloured marker** on the right labelled with the notional
(`$3.58B`). **Hover it** for level, side, long/short split, distance, price span and rank.

### The wipe

This is the behaviour you asked for and it is the core of the model: **the moment price trades
through a row, that row is deleted for good.** Those positions were liquidated, so the liquidity is
gone. It is why the map develops empty corridors behind price instead of accumulating forever, and
it is what produces the magnet-then-vacuum behaviour. Controlled by `Wipe a level once price trades
through it`, on by default — leave it on.

## Timeframe scaling

`Scale resolution to the chart timeframe` (on by default) slides three knobs off the chart's
interval, so the map means something at every zoom level:

| Chart | Bucket size | Reach from price | Merge distance |
|---|---|---|---|
| 1m  | 0.05% | ±4%  | 0.15% |
| 15m | 0.14% | ±10% | 0.42% |
| 1h  | 0.25% | ±17% | 0.75% |
| 4h  | 0.44% | ±29% | 1.3%  |
| 1D  | 0.80% | ±50% | 2.4%  |

Higher timeframe also means each bar carries more open-interest change and `Bars to model` covers a
far longer window, so daily clusters are naturally much larger than 5-minute ones. Turn the toggle
off to set bucket, reach and merge by hand.

## Why it cannot just call CoinGlass or Hyperliquid

Pine Script has no network access. No HTTP client, no API-key field, no webhook reader.
`request.security()` reads TradingView symbols and nothing else. This is a platform restriction —
no indicator on TradingView, paid or free, gets around it.

So the work is split:

| | Real-time? | What it gives you |
|---|---|---|
| The indicator | yes, every bar | Models the map from open interest. Runs unattended. |
| `tools/fetch-levels.mjs` | on demand | Real exchange data, better model, prints a string you paste in. |
| Pine Seeds (`request.seed()`) | daily bars only, needs approval | Useless for a liquidation map. |

## tools/fetch-levels.mjs

No API key, no dependencies, Node 18+.

```bash
node tools/fetch-levels.mjs --coin BTC --interval 1h
```

```
  BTC  1h  binance   price 80909.9   500 bars
  open interest: yes, with real taker flow

  Level          Dist      Side     Size
  --------------------------------------------
      72780.0  -10.05%      long     $3.38B
      85291.4  +5.42%       short    $2.26B
      79816.3   -1.35%      long     $237.60M
      65666.7  -18.84%      long     $164.54M

  Paste this into the indicator's "price:size" field:

  72780.0:6.0, 85291.4:4.9, 79816.3:2.0, 65666.7:1.8
```

Copy that last line into the indicator's **Paste levels** field and tick *Draw pasted levels*.

It beats the in-chart model on two counts Pine cannot match:

- **Real taker buy/sell volume.** Binance publishes aggressive-buy volume per bar. The indicator has
  to infer aggression from where the candle closed in its range; this reads it directly.
- **Open-interest history at its own grain**, independent of your chart timeframe.

Flags: `--coin` `--interval` `--source binance|hyperliquid` `--levels` `--band` `--bucket`
`--merge` `--decay` `--mm` `--json`.

**Hyperliquid caveat:** it publishes current open interest but no open-interest *history*, so there
is no way to separate opening flow from closing flow after the fact. That path falls back to the
volume model and prints a warning. Level *locations* still line up closely with Binance (72,446 vs
72,780; 85,370 vs 85,291), but the sizes run several times too large. Use Binance for sizes.

**CoinGlass:** the heatmap endpoint is on their paid tier. If you have a key, the drop-in point is
`loadBinance()` — swap the fetch, keep everything downstream.

## tools/fetch-hyperliquid-true.mjs — the only *true* levels available

Everything else here estimates. This does not. Hyperliquid is an on-chain perp exchange, so each
account's positions are public and the API reports the exchange's own liquidation price:

```
{"type":"clearinghouseState","user":"0x..."} -> assetPositions[].position.liquidationPx
```

Enumerate accounts, read real positions, bucket real liquidation prices by real notional. No
leverage guessing, no OI inference, no taker-flow proxy.

```bash
node tools/fetch-hyperliquid-true.mjs --coin BTC --limit 3000
```

```
  BTC  Hyperliquid  TRUE liquidation prices   mark 81052
  3000 accounts scanned (0 failed), 236 open BTC positions, 236 cross-margin
  notional seen $1.77B, inside +/-25% $534.85M

  Level          Dist      Side     Notional
  ----------------------------------------------
      89828.1  +10.83%      short    $103.52M
      67538.2  -16.67%      long     $61.93M
      72386.0  -10.69%      long     $56.96M
      77434.2   -4.46%      long     $17.98M
```

3000 accounts takes about 2 minutes and captures roughly **61% of Hyperliquid's total BTC open
interest** ($1.77B of $2.90B). Scanning more accounts raises coverage; the leaderboard has ~45k.

### Three caveats that decide how much you trust it

1. **Everyone is on cross margin.** All 236 BTC positions in that scan were cross, zero isolated. A
   cross position's `liquidationPx` depends on the *whole portfolio*, so it moves when the account's
   unrelated positions move. The number is exact right now and drifts later. `--isolated-only`
   exists but currently returns almost nothing for BTC.
2. **Coverage is the leaderboard**, not every account — large traders, not all liquidity.
3. **Hyperliquid is a minority of the BTC market.** Its BTC open interest is ~$2.9B against
   Binance's ~$9.1B. These levels are true, and they are true about a slice.

### Live mode — the closest thing to real-time on-chain

```bash
node tools/fetch-hyperliquid-true.mjs --coin BTC --limit 3000 --watch 300 --out levels.txt
```

Re-scans the chain every 5 minutes and reports what changed between sweeps:

```
  LIQUIDATED  72386.0  $56.96M      <- level vanished, price was on top of it
  new         79812.4  $22.10M      <- fresh positions opened here
```

That `LIQUIDATED` line is the wipe happening in real data — a real cluster of real accounts that
actually got taken out. `--out` keeps a file with the current paste string so you always have the
latest levels to hand.

**Where the automation stops.** The scan is live; TradingView is not. Pine cannot read a file, a
URL, or a webhook, so the last step — moving the string into the indicator's input — is manual. A
browser userscript could drive the settings dialog for you, but it would break every time
TradingView changes their markup, so it is not included here.

### Combining true and estimated

Run both and look for levels that appear in each:

```bash
node tools/fetch-levels.mjs --coin BTC --interval 1h            # estimated, whole Binance book
node tools/fetch-hyperliquid-true.mjs --coin BTC --limit 3000   # true, Hyperliquid only
```

A level both agree on is the strongest signal available here. In the run above the estimated map put
a large long cluster at 72,780 and the true map put one at 72,386 — the same pocket. Note that both
tools share the same log-bucket grid, so when prices match to the decimal that is the grid, not
independent precision; judge agreement by proximity, not by identical digits.

## How the model works

1. **New positions.** `Δ open interest > 0` means positions were opened around this bar's price.
   Volume alone can't tell opening from closing, which is why OI matters.
2. **Which side.** Real taker flow in the script; candle close position in the indicator.
3. **Where they die.** Per leverage tier, `entry × (1 ∓ (1/L − maintenance margin))`.
4. **Buckets decay** each bar, standing in for positions closed voluntarily.
5. **Buckets get wiped** when price trades through them — already liquidated, liquidity gone. This is
   what produces the magnet-then-vacuum behaviour on CoinGlass.

## Reading it

- **Bright levels are fuel, not support.** A big red band above price is trapped shorts being
  force-bought. Price tends to reach for it, not bounce off it.
- **Nearest levels matter most.** Distance is on every marker and in the table.
- **Both sides loaded** = squeeze risk either way; size down.
- Orange triangle = price entered reach of a large cluster. Right-click → Add alert on
  *Liquidation magnet near price*.

## Settings worth touching

| Input | Effect |
|---|---|
| `Main levels to show` | 10 by default. This is the "don't give me a million lines" knob. |
| `Stub width` / `reach past last bar` | How far the levels extend left and right of now. |
| `Bars to model` | How long positions are assumed to survive. 500 intraday, 2000+ swing. |
| `Position decay per bar` | Higher = only recent positioning counts. Raise on low timeframes. |
| `Colouring` | *Long vs short* (red/green) or *Heat* (blue→red by size). |
| Leverage weights | Which crowd you think is in the market. Cut 100x on quiet trend days. |

## Tested

- **`fetch-levels.mjs`** — run against live Binance and Hyperliquid for BTC and ETH at 1h and 15m.
  All paths work; output above is real.
- **The indicator** — compiles clean on Pine v6 (`BINANCE:BTCUSDT.P`). An earlier version was
  confirmed rendering end-to-end on 1D and 1H, which is where two bugs were caught and fixed: a
  doubled sign in the distance column (`-+10.37%`), and far-off clusters dragging the price
  autoscale until the candles collapsed into a ribbon.
- **The heatmap rendering** — compiled and confirmed drawing on `BINANCE:BTCUSDT.P` 1H: thin Viridis
  rows running from where each formed to the right edge, visible wiped corridors where price traded
  through, and the hover markers on the right. The first pass drew rows far too thick, so the auto
  bucket size was cut from 0.25% to 0.10% on 1H.

One TradingView quirk: after adding or updating a script the chart sometimes will not repaint until
you interact with it. Scroll, or press `End`. It is not the script.

## Honest limits

- It is a **model, not a feed**. Trade the shape and the locations, not the exact dollar figures.
- One exchange at a time. CoinGlass aggregates across all of them.
- Cross-margin and portfolio-margin positions do not liquidate at these prices at all.
- Binance's open-interest history only goes back 30 days.
