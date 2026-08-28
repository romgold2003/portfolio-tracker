# Architecture

The app is vanilla JavaScript with no build step. That is a deliberate
constraint: a trading journal you own should still open in ten years without a
toolchain to resurrect. What follows is how the code is kept honest without one.

## Layers

```
config  ->  core  ->  services  ->  ui/views  ->  ui/render  ->  app/actions
```

Imports only ever point right to left. Nothing below reaches back up.

| Layer | Owns | Never does |
| --- | --- | --- |
| `config/` | Constants: symbol maps, betas, storage keys, timers | Anything with a side effect |
| `core/` | State and domain logic | Touch the DOM or the network |
| `services/` | Price feeds and the rolling price log | Touch the DOM |
| `ui/` | Rendering | Mutate state, call actions |
| `app/actions.js` | Orchestration | Contain domain rules |

Two consequences worth naming:

- **`core/portfolio.js` is entirely pure.** Every P&L rule is an input/output
  function, so the tricky ones (daily move, blended exits) can be read and
  checked on their own.
- **Views are string builders.** `positionCard(p, isOpen)` returns HTML and
  changes nothing. If a screen looks wrong, the bug is in the view; if a number
  is wrong, the bug is in `core/`.

## The one deliberate global

The markup drives the app through inline `onclick` attributes. ES modules are
scoped, so those handlers have to resolve against something global.

`installActions()` in `src/app/actions.js` is the only place that writes to
`window`, and it does so with one explicit `Object.assign` listing every name
the HTML depends on. That keeps the HTML→JS contract in a single readable block
instead of scattered across the codebase.

**If you add an inline handler to `index.html`, add its name to
`installActions()`.**

## Circular dependencies, and how they are avoided

Two places genuinely need to call "upward":

- The **router** must re-render a page after it becomes visible.
- The **theme** must rebuild charts after the palette changes.

Rather than import the render layer (which would close a cycle), each exposes a
setter — `setPageEnterHandler`, `setThemeChangeHandler` — that `main.js` wires at
boot. The same pattern gives the voice module its `app` object, so the grammar
in `features/voice.js` never imports actions.

## Domain rules that are easy to get wrong

These are the rules the code exists to protect. Each one is commented at its
implementation as well.

### Net liquidation value excludes realised P&L

```
account = value of open positions + cash
```

Realised P&L is **not** added. Closing a trade already paid its proceeds into
cash, so adding it again double-counts. See `accountTotals()`.

### Today's move is measured from the previous close

Not from the entry price, and not from current value:

```
prevClose   = cur / (1 + dailyChg/100)
dollar move = (cur - prevClose) * qty
```

Shorts flip the sign. See `dailyDollar()`.

### Shares sold today still moved today

If you sell a winner at 11am, that gain belongs to today's number. Each exit
records the asset's previous close at the moment of sale, so it keeps counting
toward the day's total after the shares are gone. Without this, closing a winner
makes the daily figure collapse. See `dailyDollarExits()`.

### Percentages are always of the original position

A partial close of "50%" means half the original size, whether it is the first
exit or the third. The remainder is never the denominator. See `baseQtyOf()`.

### A partially closed trade is not a closed trade

Partial exits accumulate on the position and stay out of the monthly report. The
final exit collapses them into one blended closed trade: quantity returns to the
original size and `cur` becomes the quantity-weighted average exit, so that

```
realized() = (avgExit - entry) * origQty = sum of every exit's P&L
```

This is why the monthly totals equal money actually taken off the table. See
`closePosition()`.

## State

| Kind | Where | Persisted |
| --- | --- | --- |
| Positions, cash, snapshots, API key | `core/store.js` (`state`) | yes |
| Rolling price log | `services/priceLog.js` | yes |
| Expanded card, sort, timeframe | `ui/uiState.js` (`ui`) | no |

View state is deliberately not persisted — a reload should return to a clean
view. Storage access is wrapped everywhere, because `localStorage` throws in
private mode and a render must never die on it.

## Rendering

There is no virtual DOM and no diffing. `renderAll()` rebuilds the three data
screens from state. Actions mutate, then call it. For a journal with tens of
positions this is fast enough and impossible to get subtly out of sync.

Charts are the exception: Chart.js bakes colours in at construction, so each
redraw destroys the previous instance and resolves palette values from the live
computed style. That is also why the theme toggle re-renders rather than just
swapping a class.

## Failure behaviour

Price fetches return `null` on every failure path rather than throwing. A
missing quote degrades to the last known price; it never breaks a render. The
app is fully usable with stale prices, and with no API key at all.

## Known gaps

- No automated tests. `core/portfolio.js` is pure and is the obvious first
  target.
- The account curve is synthesised until two real daily snapshots exist, so a
  fresh install shows an illustrative line rather than history.
- Fees, taxes and multi-currency are not modelled.
