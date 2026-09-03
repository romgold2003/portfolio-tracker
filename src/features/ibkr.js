/**
 * Reading an Interactive Brokers Activity Statement.
 *
 * The statement is not one table but a stack of them: every row begins with the
 * name of the section it belongs to, then Header or Data, then that section's
 * own columns. So parsing means grouping rows by their first field and reading
 * each group against its own header.
 *
 * Section and column names come out in the account's language. Both English and
 * French are recognised, because that is what this was built against; a
 * statement in a third language will parse to nothing rather than to something
 * wrong, which is the right way round.
 *
 * What it takes from the file:
 *
 *   open positions   symbol, quantity and cost basis, to rebuild the book
 *   trades           every sell, with the profit and cost basis IBKR calculated
 *   cash             the closing balance, so the account reconciles
 *   deposits         with their dates, which is what makes a real return
 *                    possible rather than one that mistakes funding for profit
 *   dividends, fees  the money that moves without a trade behind it
 *
 * Nothing here writes anything. It returns what it found and lets the caller
 * decide, so a bad file cannot half-replace a journal.
 */

/** One line of CSV, respecting quoted fields — IBKR puts commas inside dates. */
function parseLine(line) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(field); field = ''; } else field += c;
  }
  out.push(field);
  return out;
}

/** Strip a byte-order mark, which Excel and IBKR both like to leave behind. */
const clean = (s) => s.replace(/^﻿/, '').trim();

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[\s,]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Section names, in the languages this understands. Matched loosely because
 * IBKR varies the wording between statement types.
 */
const SECTIONS = {
  positions: [/^open positions$/i, /^positions ouvertes$/i],
  trades: [/^trades$/i, /^transactions$/i],
  nav: [/^net asset value$/i, /^actif net$/i],
  navChange: [/^change in nav$/i, /^changes? in net asset value$/i, /^changements de l'actif net$/i],
  flows: [/^deposits & withdrawals$/i, /^deposits and withdrawals$/i, /^dépôts et retraits$/i],
  dividends: [/^dividends$/i, /^dividendes$/i],
  interest: [/^interest$/i, /^intérêt$/i],
  tax: [/^withholding tax$/i, /^retenues d'impôts$/i],
  statement: [/^statement$/i],
};

function sectionOf(name) {
  const label = clean(name);
  for (const [key, patterns] of Object.entries(SECTIONS)) {
    if (patterns.some((p) => p.test(label))) return key;
  }
  return null;
}

/** Column lookup by any of several names, returning its index. */
function columnIndex(header, ...names) {
  const wanted = names.map((n) => n.toLowerCase());
  return header.findIndex((h) => wanted.includes(clean(h).toLowerCase()));
}

/**
 * Group the file into { section: { header, rows } }.
 *
 * A section can declare its header more than once — IBKR repeats it for
 * subtotals — so the first is kept and later ones are skipped rather than
 * shifting every column after them.
 */
function groupSections(text) {
  const groups = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = parseLine(line);
    const key = sectionOf(fields[0]);
    if (!key) continue;

    const kind = clean(fields[1]).toLowerCase();
    if (!groups.has(key)) groups.set(key, { header: null, rows: [] });
    const group = groups.get(key);

    if (kind === 'header') {
      if (!group.header) group.header = fields.slice(2);
    } else if (kind === 'data') {
      group.rows.push(fields.slice(2));
    }
  }
  return groups;
}

/** Rows that are subtotals rather than records. */
function isTotalRow(fields) {
  return fields.some((f) => /^total/i.test(clean(f)));
}

function readOpenPositions(group) {
  if (!group?.header) return [];
  const h = group.header;
  const iSymbol = columnIndex(h, 'Symbol', 'Symbole');
  const iQty = columnIndex(h, 'Quantity', 'Quantité');
  // Cost per share, not the "Cost Basis" / "Coût d'acquisition" beside it,
  // which is the whole position. Matched exactly so the two cannot be confused.
  const iCost = columnIndex(h, 'Cost Price', 'Coût', 'Prix de revient', 'Cours de revient');
  const iClose = columnIndex(h, 'Close Price', 'Cours de clôt.', 'Cours de clôture');
  if (iSymbol < 0 || iQty < 0) return [];

  return group.rows
    .filter((r) => !isTotalRow(r) && clean(r[iSymbol]))
    .map((r) => ({
      ticker: clean(r[iSymbol]).replace(/\s+/g, '.'),
      qty: num(r[iQty]),
      entry: num(r[iCost]),
      cur: iClose >= 0 ? num(r[iClose]) : num(r[iCost]),
    }))
    .filter((p) => p.qty > 0 && p.entry > 0);
}

/**
 * Every sell, as a finished trade.
 *
 * IBKR has already done the hard part: each closing row carries the cost basis
 * of the shares that left and the profit it booked, matched by its own lot
 * accounting. Recomputing that from buys and sells here would mean guessing at
 * which lot went with which sale, and getting a different answer from the
 * broker's own books.
 *
 * A buy contributes nothing except the date, which is used to say when the
 * position that was eventually sold had first been opened.
 */
function readTrades(group) {
  if (!group?.header) return { closed: [], commissions: 0 };
  const h = group.header;
  const iSymbol = columnIndex(h, 'Symbol', 'Symbole');
  const iDate = columnIndex(h, 'Date/Time', 'Date/Heure');
  const iQty = columnIndex(h, 'Quantity', 'Quantité');
  const iBasis = columnIndex(h, 'Basis', 'Base');
  const iPnl = columnIndex(h, 'Realized P/L', 'P/L réalisé');
  const iComm = columnIndex(h, 'Comm/Fee', 'Comm/Tarif');
  if (iSymbol < 0 || iDate < 0 || iQty < 0) return { closed: [], commissions: 0 };

  const firstBuy = new Map();
  const closed = [];
  let commissions = 0;

  for (const r of group.rows) {
    if (isTotalRow(r)) continue;
    const ticker = clean(r[iSymbol]).replace(/\s+/g, '.');
    const date = clean(r[iDate]).split(',')[0].trim();
    if (!ticker || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const qty = num(r[iQty]);
    if (iComm >= 0) commissions += num(r[iComm]);

    if (qty > 0) {
      if (!firstBuy.has(ticker)) firstBuy.set(ticker, date);
      continue;
    }

    const pnl = iPnl >= 0 ? num(r[iPnl]) : 0;
    const cost = Math.abs(iBasis >= 0 ? num(r[iBasis]) : 0);
    // Without a cost basis there is no percentage to report, and a closed trade
    // with no size is not worth storing.
    if (!cost || !pnl) continue;

    closed.push({
      ticker,
      open: firstBuy.get(ticker) || date,
      close: date,
      pnl,
      pct: (pnl / cost) * 100,
      cost,
    });
  }

  return { closed, commissions, firstBuy };
}

/**
 * The broker's own time-weighted return for the period.
 *
 * IBKR prints it inside the Net Asset Value section, under a second header of
 * its own, as a lone percentage on an otherwise empty row. There is no column
 * to look it up by and the label is in the account's language, so it is found
 * by shape instead: the only row in that section holding one field that reads
 * as a percentage.
 *
 * Worth having because it is not a number this app can derive. A true
 * time-weighted return needs the account valued on every day money moved, and
 * a journal cannot see that — but the broker computed it daily and wrote it
 * down, and it is the figure their own app shows.
 */
function readTimeWeightedReturn(group) {
  for (const row of group?.rows ?? []) {
    const fields = row.map(clean).filter(Boolean);
    if (fields.length !== 1) continue;
    const match = /^(-?[\d.,]+)\s*%$/.exec(fields[0]);
    if (match) {
      const value = num(match[1]);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

function readNavCash(group) {
  if (!group?.header) return null;
  const iClass = 0;
  const iCurrent = columnIndex(group.header, 'Current Total', 'Total actuel');
  if (iCurrent < 0) return null;
  const row = group.rows.find((r) => /^(cash|trésorerie)$/i.test(clean(r[iClass])));
  return row ? num(row[iCurrent]) : null;
}

/** The "Change in NAV" block is a list of named values rather than a table. */
function readNavChange(group) {
  const out = {};
  if (!group) return out;
  const names = {
    startNav: [/starting value/i, /valeur de départ/i],
    endNav: [/ending value/i, /valeur en fin de période/i],
    deposits: [/deposits/i, /dépôts et retraits/i],
    dividends: [/^dividends$/i, /^dividendes$/i],
    interest: [/^interest$/i, /^intérêt$/i],
    commissions: [/commissions/i],
    tax: [/withholding tax/i, /retenue fiscale/i],
    mtm: [/mark-to-market/i, /évalué au prix du marché/i],
  };
  for (const r of group.rows) {
    const label = clean(r[0]);
    for (const [key, patterns] of Object.entries(names)) {
      if (patterns.some((p) => p.test(label))) out[key] = num(r[1]);
    }
  }
  return out;
}

/**
 * Money in and out, with dates.
 *
 * The dates are the point. A return measured without them treats every deposit
 * as though it had been there since January, which is what made this account
 * report 24% where its broker said 29%.
 *
 * Transfers between two of your own accounts are dropped: they are movements
 * within the same pot, and counting the leg that arrives without the leg that
 * left would invent money.
 */
function readFlows(group) {
  if (!group?.header) return [];
  const h = group.header;
  const iDate = columnIndex(h, 'Settle Date', 'Date de règlement', 'Date');
  const iDesc = columnIndex(h, 'Description');
  const iAmount = columnIndex(h, 'Amount', 'Montant');
  if (iDate < 0 || iAmount < 0) return [];

  return group.rows
    .filter((r) => !isTotalRow(r))
    .map((r) => ({
      date: clean(r[iDate]),
      amount: num(r[iAmount]),
      description: iDesc >= 0 ? clean(r[iDesc]) : '',
    }))
    .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.date) && f.amount !== 0)
    .filter((f) => !/internal transfer|transfert interne/i.test(f.description));
}

/**
 * The first day the statement covers.
 *
 * IBKR writes the period as prose in the account's language — "January 1, 2026
 * - August 28, 2026" — so the month has to be read by name. Both languages this
 * understands are listed; anything else falls back to the earliest date seen in
 * the file, which is later than the true start but never earlier, so a return
 * computed from it is conservative rather than inflated.
 */
const MONTH_NAMES = [
  ['january', 'janvier'], ['february', 'février', 'fevrier'], ['march', 'mars'],
  ['april', 'avril'], ['may', 'mai'], ['june', 'juin'], ['july', 'juillet'],
  ['august', 'août', 'aout'], ['september', 'septembre'], ['october', 'octobre'],
  ['november', 'novembre'], ['december', 'décembre', 'decembre'],
];

/** "Août 28, 2026" as 2026-08-28, or null if the month is not one we know. */
function readWrittenDate(text) {
  const match = /([\p{L}]+)\s+(\d{1,2}),?\s+(\d{4})/u.exec(text);
  if (!match) return null;
  const month = MONTH_NAMES.findIndex((names) => names.includes(match[1].toLowerCase()));
  if (month < 0) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${match[3]}-${pad(month + 1)}-${pad(Number(match[2]))}`;
}

/**
 * The days the statement covers.
 *
 * The last day matters as much as the first: everything the broker computed is
 * true up to it and no further, so it is where this app has to take over.
 */
function readPeriod(groups, fallbackDates) {
  const statement = groups.get('statement');
  const row = statement?.rows.find((r) => /^period$/i.test(clean(r[0])));
  const text = row ? clean(row[1]) : '';
  const halves = text.split(/\s+-\s+/);

  const from = readWrittenDate(halves[0] ?? '')
    ?? fallbackDates.filter(Boolean).sort()[0]
    ?? null;
  // A one-day statement writes a single date, which is both ends of it.
  const to = halves.length > 1 ? readWrittenDate(halves[1]) : from;
  return { from, to };
}

/** Totals from the simple income sections. */
function readTotal(group) {
  if (!group?.header) return 0;
  const row = group.rows.find((r) => isTotalRow(r));
  if (!row) return 0;
  // The amount is the last numeric field on the total line.
  for (let i = row.length - 1; i >= 0; i--) {
    const v = clean(row[i]);
    if (v && Number.isFinite(Number(v.replace(/,/g, '')))) return num(v);
  }
  return 0;
}

/**
 * Read a statement. Throws only when the file is not one.
 */
export function parseIbkrStatement(text) {
  const groups = groupSections(text);
  if (!groups.size) {
    throw new Error('That does not look like an Interactive Brokers activity statement.');
  }

  const positions = readOpenPositions(groups.get('positions'));
  const { closed, commissions, firstBuy } = readTrades(groups.get('trades'));
  const navChange = readNavChange(groups.get('navChange'));
  const cash = readNavCash(groups.get('nav'));
  const flows = readFlows(groups.get('flows'));
  const dividends = readTotal(groups.get('dividends'));
  const interest = readTotal(groups.get('interest'));
  const tax = readTotal(groups.get('tax'));
  const period = readPeriod(groups, [
    ...closed.map((c) => c.close),
    ...flows.map((f) => f.date),
  ]);
  const periodStart = period.from;
  const twr = readTimeWeightedReturn(groups.get('nav'));

  if (!positions.length && !closed.length) {
    throw new Error('No positions or trades found in that statement.');
  }

  return {
    positions,
    closed,
    firstBuy,
    periodStart,
    periodEnd: period.to,
    twr,
    cash: cash ?? null,
    flows,
    income: {
      dividends,
      interest,
      tax,
      // The trades section carries commissions per trade; the NAV summary
      // carries the total. They should agree, and the summary wins when it is
      // present because it also covers anything that was not a trade.
      commissions: navChange.commissions ?? commissions,
    },
    navChange,
  };
}

/**
 * Turn a parsed statement into a whole journal.
 *
 * This rebuilds the book rather than merging into it. A statement is a complete
 * picture of the account on its closing date — every position, every trade, the
 * cash balance — so merging would mean deciding, for each of a hundred rows,
 * whether it is the same trade as one already there. Getting that wrong
 * duplicates profit, and there is no way to tell by looking. Replacing is the
 * only version whose result is knowable, which is why the caller confirms it.
 *
 * Closed trades come in as results rather than prices, the same shape the
 * "already closed" form produces: IBKR's own lot accounting decided the profit
 * and the cost basis, and recomputing them here would only invent a second
 * opinion.
 */
export function statementToJournal(parsed, existing = {}) {
  let id = Date.now() * 1000;
  const nextId = () => { id += 1; return id; };

  const open = parsed.positions.map((p) => ({
    id: nextId(),
    ticker: p.ticker,
    cls: 'Stocks',
    dir: 'Long',
    status: 'Open',
    // A holding bought before the statement period has no purchase in it, so
    // its opening date is genuinely unknown and stays null. That is what marks
    // it as carried in from an earlier year rather than opened this one.
    open: parsed.firstBuy?.get(p.ticker) ?? null,
    close: null,
    entry: p.entry,
    cur: p.cur,
    qty: p.qty,
    amount: p.entry * p.qty,
    reason: null,
  }));

  const closed = parsed.closed.map((c) => {
    const ended = c.cost + c.pnl;
    return {
      id: nextId(),
      ticker: c.ticker,
      cls: 'Stocks',
      dir: 'Long',
      status: 'Closed',
      open: c.open,
      close: c.close,
      entry: c.cost,
      cur: ended,
      qty: 1,
      origQty: 1,
      amount: c.cost,
      summary: true,
      reason: null,
      exits: [{ d: c.close, qty: 1, price: ended, pnl: c.pnl, pct: 100, prevClose: null }],
    };
  });

  return {
    positions: [...closed, ...open],
    cash: parsed.cash ?? 0,
    // The recorded account curve is left alone: it is a log of what this app
    // observed on the days it was open, and no statement can restate that.
    snapshots: existing.snapshots ?? [],
    cashFlows: parsed.flows,
    income: parsed.income,
    /**
     * What the broker says about the window it covered.
     *
     * `value` anchors the opening balance so profit falls out of the balance
     * sheet. `twr` and the closing pair are what let the app report the same
     * return the broker's own app shows — see accountPerformance.
     */
    openingNav: parsed.periodStart && parsed.navChange?.startNav != null
      ? {
        date: parsed.periodStart,
        value: parsed.navChange.startNav,
        through: parsed.periodEnd ?? null,
        throughValue: parsed.navChange.endNav ?? null,
        twr: parsed.twr ?? null,
      }
      : null,
    apiKey: existing.apiKey ?? '',
  };
}

/** A human summary of what a file holds, for the confirmation step. */
export function describeStatement(parsed) {
  const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const net = parsed.flows.reduce((s, f) => s + f.amount, 0);
  const realised = parsed.closed.reduce((s, c) => s + c.pnl, 0);

  return [
    `${parsed.positions.length} open position${parsed.positions.length === 1 ? '' : 's'}`,
    `${parsed.closed.length} closed trade${parsed.closed.length === 1 ? '' : 's'} worth ${money(realised)}`,
    parsed.cash != null ? `cash ${money(parsed.cash)}` : null,
    parsed.flows.length ? `${parsed.flows.length} deposits and withdrawals netting ${money(net)}` : null,
    parsed.income.dividends ? `${money(parsed.income.dividends)} dividends` : null,
    parsed.income.commissions ? `${money(parsed.income.commissions)} commissions` : null,
  ].filter(Boolean).join(' · ');
}
