# The import CSV format

The app rebuilds a whole account — open positions, closed trades, cash,
deposits, dividends — from one file. That file is an Interactive Brokers
Activity Statement in CSV.

Anyone whose broker is not IBKR can still use the importer by converting their
own statement into this shape. This is the exact contract the parser in
[`src/features/ibkr.js`](../src/features/ibkr.js) reads, and every rule below is
one the code actually enforces.

## The shape

Not one table but a stack of them. Every line begins with the name of the
section it belongs to, then `Header` or `Data`, then that section's own columns:

```
Section name,Header,Column A,Column B
Section name,Data,value,value
```

Standard CSV quoting. A field containing a comma is quoted. Section names are
matched case-insensitively, in English or French. Unknown sections are ignored
rather than rejected, so extra ones are harmless.

## Sections

Only `Open Positions` **or** `Trades` is strictly required — with neither, the
file is refused. Everything else improves the result.

### Open Positions

```
Open Positions,Header,Asset Category,Currency,Symbol,Quantity,Cost Price,Close Price
Open Positions,Data,Stocks,USD,NVDA,30,180.2500,217.5500
```

| Column | Meaning |
|---|---|
| `Symbol` | Ticker. Spaces become dots, so `BRK B` arrives as `BRK.B`. |
| `Quantity` | Shares held. Must be greater than zero. |
| `Cost Price` | **Per share**, not the position's total. Must be greater than zero. |
| `Close Price` | Market price per share. Optional; falls back to `Cost Price`. |

The per-share point is the one that goes wrong most often. An IBKR statement has
both `Cost Price` and `Cost Basis` beside each other and they differ by a factor
of the quantity; feeding the total in as `Cost Price` inflates the book by that
factor.

### Trades

Every buy and every sell, in date order.

```
Trades,Header,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Basis,Realized P/L,Comm/Fee
Trades,Data,Stocks,USD,AMD,"2026-02-03, 09:41:22",40,120.0000,4800.00,0,-1.00
Trades,Data,Stocks,USD,AMD,"2026-03-14, 15:02:10",-40,142.1000,-4800.00,884.00,-1.00
```

| Column | Meaning |
|---|---|
| `Quantity` | Positive is a buy, negative is a sell. |
| `Date/Time` | Must start `YYYY-MM-DD`. Anything after a comma is ignored. |
| `Basis` | Cost basis of the shares in this row. The sign is ignored. |
| `Realized P/L` | Profit on a sell. Zero on a buy. |
| `Comm/Fee` | Optional, summed as commissions. |

A sell becomes a closed trade only when it has **both** a non-zero `Basis` and a
non-zero `Realized P/L`. The return percentage is `Realized P/L / Basis`.

Buys are not stored as trades, but keep them in: the earliest buy for a symbol
becomes the opening date of the closed trade it eventually matches.

Whoever produced the statement has already done lot matching. Do not recompute
profit from buys and sells — the answer will differ from the broker's own books,
and the broker's is the one that is right.

### Net Asset Value

Where the cash balance comes from. Needs a row whose first column is exactly
`Cash`, and a `Current Total` column.

```
Net Asset Value,Header,Asset Class,Prior Total,Current Total,Change
Net Asset Value,Data,Stock,21000.00,28340.34,7340.34
Net Asset Value,Data,Cash,5365.95,8359.63,2993.68
```

### Change in NAV

A list of named values rather than a table. Labels are matched by pattern, so
the wording can vary a little.

```
Change in NAV,Header,Field Name,Field Value
Change in NAV,Data,Starting Value,26365.95
Change in NAV,Data,Ending Value,36699.97
Change in NAV,Data,Deposits & Withdrawals,8497.00
Change in NAV,Data,Dividends,142.30
Change in NAV,Data,Interest,12.44
Change in NAV,Data,Commissions,-58.20
Change in NAV,Data,Withholding Tax,-42.69
```

`Starting Value` is what makes a real return possible: it anchors the period so
the app measures growth rather than guessing from trades.

### Deposits & Withdrawals

```
Deposits & Withdrawals,Header,Currency,Settle Date,Description,Amount
Deposits & Withdrawals,Data,USD,2026-02-11,Wire transfer,5000.00
Deposits & Withdrawals,Data,USD,2026-05-06,Wire transfer,3497.00
```

Dates must be `YYYY-MM-DD`. Negative amounts are withdrawals. Rows whose
description mentions an internal transfer are dropped, because a movement
between two of your own accounts is not money arriving.

**The dates matter more than the total.** A return computed without them treats
every deposit as though it had been there since January, which on one real
account reported 24% where the broker said 29%.

### Dividends, Interest, Withholding Tax

Only the total is read, from a row containing the word `Total`, taking the last
numeric field on it.

```
Dividends,Header,Currency,Date,Description,Amount
Dividends,Data,USD,2026-04-02,NVDA cash dividend,12.30
Dividends,Data,Total,,,142.30
```

### Statement

Optional, and worth including. It carries the period, which sets the start date
the return is measured from.

```
Statement,Header,Field Name,Field Value
Statement,Data,Period,"January 1, 2026 - August 28, 2026"
```

The month is read by name, in English or French. Without this section the app
falls back to the earliest date it can find in the file — later than the true
start, so the reported return is conservative rather than inflated.

## Two rules that catch people out

**Never put the word "Total" in a data row** of Open Positions, Trades or
Deposits & Withdrawals. Any row containing a field starting with `total` is
treated as a subtotal and skipped. Subtotal rows are fine — that is what the
rule is for — but a stock named in a way that trips it will vanish.

**Numbers are plain.** Thousands separators and spaces are stripped, so
`1,234.56` is fine, but currency symbols and parenthesised negatives are not:
write `-800.00`, never `(800.00)` or `$800`.

## Checking it

A file that parses will still be wrong if the columns were misread, so check the
figures rather than the fact that it loaded:

- open positions: count and tickers match the broker
- cash matches the statement to the cent
- realised P&L across closed trades matches the broker's own realised total
- deposits net to the same figure as `Change in NAV`

The importer replaces the journal rather than merging into it, and says what it
is about to do before it does it. Read that summary.
