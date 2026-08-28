# Portfolio Tracker

A local-first trading journal. Track open and closed positions, log why you
entered each trade, close in slices, and see what you actually made month by
month — with live prices pulled straight from the browser.

Everything lives in your browser's `localStorage`. There is no backend, no
account, and no data leaves your machine except the price requests you can see
in the network tab.

## Features

- **Positions** — long or short, across crypto, stocks and commodities, with an
  entry-reason note on every trade so you can review your thinking later.
- **Partial exits** — close 25%, 50% or any slice you like. Percentages are
  always measured against the original position size, and nothing is booked to
  the monthly report until the position is fully closed.
- **DCA** — add to a position and see the new average entry before committing.
- **Live prices** — crypto from CoinGecko with no key at all; stocks and ETFs
  from Finnhub with your own free key, stored on-device.
- **Real daily and 7-day change** — computed from the previous close, not from
  your entry price, with shares sold today still counted toward today's move.
- **Monthly P&L** — a twelve-bar year chart, a month-by-month table, and a
  drill-down showing exactly how each position was closed.
- **Portfolio beta** — size-weighted, with shorts contributing negatively.
- **Voice control** — hands-free navigation in Chrome ("go home", "expand BTC",
  "show March 2026").
- **IBKR sync** — optional, read-only, via a Client Portal Gateway you run
  yourself.
- **Light and dark themes**, following your OS by default.

## Getting started

Requires [Node.js](https://nodejs.org) 18 or newer — only to serve the files.
There are no dependencies to install.

```bash
npm start
```

Then open <http://localhost:4173>.

> **Why a server?** The app is built from ES modules, which browsers refuse to
> load over `file://`. `npm start` runs a ~60-line static server from
> `scripts/dev-server.mjs`; any other static server works just as well.

### Or build a single file you can just double-click

```bash
npm run build
```

Writes `dist/portfolio-tracker.html`: one self-contained file, about 350 KB,
with every module, stylesheet and Chart.js inlined. No server, no install, no
network except live prices. Copy it anywhere and open it.

Note that a journal is tied to where the app is opened from, so the standalone
file and the served version keep separate books. Move one to the other with
Export backup and Import backup.

To use a different port:

```bash
npm start -- 8080
```

## Live prices

Crypto works immediately. For stocks, ETFs and gold proxies:

1. Get a free API key at [finnhub.io](https://finnhub.io).
2. In the app, open **⚙ Live price settings** in the sidebar.
3. Paste the key and save.

The key is stored in `localStorage` on your device and is sent only to Finnhub.

## Project structure

```
index.html            markup only — no styles, no logic
styles/               tokens -> base -> layout -> components
src/
  main.js             entry point: boot order and background timers
  config/             symbol maps, betas, storage keys, timers
  core/               state and pure domain logic (no DOM, no network)
    store.js          the position book + its localStorage mirror
    portfolio.js      all P&L mathematics, as pure functions
    positions.js      every write to the book: add, edit, DCA, close, delete
    snapshots.js      the daily account-value curve
    migrations.js     one-way upgrades of stored data
  services/           the outside world: price feeds, rolling price log
  features/           self-contained extras: voice, IBKR sync, backup/restore
  ui/                 rendering only — views return HTML strings
    views/            one module per screen
    render.js         the single entry point for redrawing
  app/actions.js      user intent -> mutation -> re-render -> feedback
scripts/dev-server.mjs
```

Dependencies flow one way:

```
config -> core -> services -> ui/views -> ui/render -> app/actions
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the reasoning behind that
split and the domain rules it protects.

## Data and privacy

| What | Where |
| --- | --- |
| Positions, cash, snapshots, price log | `localStorage`, this browser only |
| Finnhub API key | `localStorage`, sent only to Finnhub |
| IBKR credentials | never touched — you log into the gateway yourself |

Storage is scoped per origin, so the journal belongs to the exact URL you opened
it on. Clearing your browser data clears it.

**Back it up:** ⚙ Live price settings → **Export backup** writes a JSON file with
every position, your cash balance and the account-value history. **Import backup**
loads it back, on this machine or another one. The API key is excluded on purpose
— a backup should not carry a secret.

Coming from the old single-file version and can't see your trades? Your data is
safe, just in a different origin — see
[docs/RECOVER-OLD-DATA.md](docs/RECOVER-OLD-DATA.md).

## Browser support

Any modern browser. Voice control needs the Web Speech API, which today means
Chrome or Edge.

## License

MIT — see [LICENSE](LICENSE).
