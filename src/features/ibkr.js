/**
 * Reading an Interactive Brokers Activity Statement.
 *
 * The statement is not one table but a stack of them: every row begins with the
 * name of the section it belongs to, then Header or Data, then that section's
 * own columns. So parsing means grouping rows by their first field and reading
 * each group against its own header.
 *
 * Section and column names come out in the account's language. English and
 * French are recognised by name. Any other language is read by shape: IBKR
 * keeps the same sections with the same columns in the same order in every
 * language, and some markers are never translated — DataDiscriminator,
 * Summary, Order, ISO dates, ISIN codes — so a section whose name is unknown is
 * identified by what it holds, and its columns are given their English names
 * by position.
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

import { looksLikeHtmlStatement, htmlStatementToCsv } from './ibkrHtml.js';

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
  /**
   * The mark-to-market summary, which is the only place the statement states
   * what was held when the period *opened*. Everything else describes the
   * close, and a period's opening holdings cannot be inferred from its closing
   * ones without assuming every movement in between is recorded.
   */
  mtm: [/^mark-to-market performance summary$/i,
    /^synthèse de la performance évaluée au prix du marché$/i],
  /** Shares moved between two accounts of the same statement. */
  transfers: [/^transfers$/i, /^transferts$/i],
  /** Splits, which change a share count without a trade. */
  corporateActions: [/^corporate actions$/i, /^opérations sur titres$/i],
  statement: [/^statement$/i],
  account: [/^account information$/i, /^informations sur le compte$/i, /^informations du compte$/i],
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
  // Every section in the file, by its own name and in order.
  const raw = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = parseLine(line);
    const name = clean(fields[0] ?? '');
    if (!name) continue;
    if (!raw.has(name)) raw.set(name, { header: null, rows: [] });
    const section = raw.get(name);
    const kind = clean(fields[1] ?? '').toLowerCase();
    if (kind === 'header') {
      if (!section.header) section.header = fields.slice(2);
    } else if (kind === 'data') {
      section.rows.push(fields.slice(2));
    }
  }

  // Named sections first, merged when two spellings name the same one.
  const groups = new Map();
  const named = new Set();
  for (const [name, section] of raw) {
    const key = sectionOf(name);
    if (!key) continue;
    named.add(name);
    if (!groups.has(key)) groups.set(key, { header: section.header, rows: [...section.rows] });
    else {
      const group = groups.get(key);
      if (!group.header) group.header = section.header;
      group.rows.push(...section.rows);
    }
  }

  // Then any section in a language not named above, by its shape.
  for (const [name, section] of raw) {
    if (named.has(name)) continue;
    const key = shapeOf(section);
    if (!key || groups.has(key)) continue;
    const english = CANONICAL[key]?.[section.header?.length];
    groups.set(key, { header: english ?? section.header, rows: section.rows });
  }
  return groups;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2},\s*\d{1,2}:\d{2}/;
const ISIN = /\([A-Z]{2}[A-Z0-9]{9}\d\)/;
const isNumber = (v) => /^-?\d[\d,]*(\.\d+)?$|^-?\.\d+$/.test(clean(String(v ?? '')));

/**
 * The English columns of each section, by how many there are.
 *
 * IBKR writes the same columns in the same order in every language, so a
 * section recognised by its shape is given these names by position and read by
 * the same code as an English statement. Checked against real English and
 * French statements, column for column.
 */
const CANONICAL = {
  positions: {
    12: ['DataDiscriminator', 'Asset Category', 'Currency', 'Symbol', 'Quantity', 'Mult', 'Cost Price',
      'Cost Basis', 'Close Price', 'Value', 'Unrealized P/L', 'Code'],
  },
  trades: {
    15: ['DataDiscriminator', 'Asset Category', 'Currency', 'Account', 'Symbol', 'Date/Time', 'Quantity',
      'T. Price', 'C. Price', 'Proceeds', 'Comm/Fee', 'Basis', 'Realized P/L', 'MTM P/L', 'Code'],
    14: ['DataDiscriminator', 'Asset Category', 'Currency', 'Symbol', 'Date/Time', 'Quantity',
      'T. Price', 'C. Price', 'Proceeds', 'Comm/Fee', 'Basis', 'Realized P/L', 'MTM P/L', 'Code'],
  },
  nav: { 6: ['Asset Class', 'Prior Total', 'Current Long', 'Current Short', 'Current Total', 'Change'] },
  mtm: {
    12: ['Asset Category', 'Symbol', 'Prior Quantity', 'Current Quantity', 'Prior Price', 'Current Price',
      'Mark-to-Market P/L Position', 'Mark-to-Market P/L Transaction', 'Mark-to-Market P/L Commissions',
      'Mark-to-Market P/L Other', 'Mark-to-Market P/L Total', 'Code'],
  },
  navChange: { 2: ['Field Name', 'Field Value'] },
  flows: {
    5: ['Currency', 'Account', 'Settle Date', 'Description', 'Amount'],
    4: ['Currency', 'Settle Date', 'Description', 'Amount'],
  },
  dividends: {
    5: ['Currency', 'Account', 'Date', 'Description', 'Amount'],
    4: ['Currency', 'Date', 'Description', 'Amount'],
  },
  interest: {
    5: ['Currency', 'Account', 'Date', 'Description', 'Amount'],
    4: ['Currency', 'Date', 'Description', 'Amount'],
  },
  tax: {
    6: ['Currency', 'Account', 'Date', 'Description', 'Amount', 'Code'],
    5: ['Currency', 'Date', 'Description', 'Amount', 'Code'],
  },
  transfers: {
    15: ['Asset Category', 'Currency', 'Account', 'Symbol', 'Date', 'Type', 'Direction', 'Xfer Company',
      'Xfer Account', 'Qty', 'Xfer Price', 'Market Value', 'Realized P/L', 'Cash Amount', 'Code'],
  },
};

/**
 * Which section this is, from what it holds rather than what it is called.
 *
 * Only for sections whose name is in a language not listed above. Each test
 * leans on what IBKR never translates:
 *
 *   positions       DataDiscriminator, and no trade times
 *   trades          DataDiscriminator, with trade date-times
 *   net asset value six columns, a label and five figures
 *   mark-to-market  twelve columns, a symbol, then quantities and prices
 *   change in NAV   two columns, a label and a figure on every line
 *   dividends       dated amounts whose descriptions carry an ISIN
 *   withholding tax the same with a code column after the amount
 *   interest        dated amounts described by month, as in "Jul-2026"
 *   deposits        the remaining dated amounts, in a currency
 *   transfers       fifteen columns with a date and a symbol
 */
function shapeOf(section) {
  const h = section.header ?? [];
  const rows = section.rows.filter((r) => r.some((f) => clean(f ?? '')));
  if (!h.length || !rows.length) return null;

  if (clean(h[0]) === 'DataDiscriminator') {
    const timed = rows.some((r) => r.some((f) => DATE_TIME.test(clean(f ?? ''))));
    if (timed && (h.length === 14 || h.length === 15)) return 'trades';
    if (!timed && h.length === 12) return 'positions';
    return null;
  }
  if (h.length === 6 && rows.some((r) => r.length >= 6 && [1, 2, 3, 4, 5].every((i) => isNumber(r[i])))) return 'nav';
  if (h.length === 12 && rows.some((r) => clean(r[1] ?? '') && isNumber(r[2]) && isNumber(r[4]))) return 'mtm';
  if (h.length === 2 && rows.length >= 2 && rows.every((r) => isNumber(r[1]))) return 'navChange';

  const dateAt = [1, 2].find((i) => rows.some((r) => ISO_DATE.test(clean(r[i] ?? ''))));
  if (dateAt != null && rows.some((r) => /^[A-Z]{3}$/.test(clean(r[0] ?? '')))) {
    const after = h.length - dateAt;
    const descriptions = rows.map((r) => clean(r[dateAt + 1] ?? ''));
    const withIsin = descriptions.some((d) => ISIN.test(d));
    if (after === 4 && withIsin) return 'tax';
    if (after === 3 && withIsin) return 'dividends';
    if (after === 3 && descriptions.some((d) => /\p{L}{3,}\.?-\d{4}\b/u.test(d))) return 'interest';
    if (after === 3) return 'flows';
  }
  if (h.length === 15 && rows.some((r) => ISO_DATE.test(clean(r[4] ?? '')) && clean(r[3] ?? ''))) return 'transfers';
  return null;
}

/** Rows that are subtotals rather than records. */
function isTotalRow(fields) {
  return fields.some((f) => /^total/i.test(clean(f)));
}

/**
 * What was held when the period opened, and at what price.
 *
 * The mark-to-market section carries a prior quantity and a prior price for
 * every instrument, which is exactly the opening state — stated by the broker
 * rather than derived by undoing the year. That difference matters: a movement
 * missing from the file would silently become a holding that was "always
 * there", and the error would be spread across every earlier day.
 *
 * Two kinds of row are skipped. The Forex line is the cash balance wearing a
 * symbol, and folding it in counts the cash twice — it put the opening balance
 * out by the whole cash figure. The Total rows carry no quantity but do carry
 * figures, and summing them would double the book.
 */
/**
 * What the statement says was held when the period opened — and null when it
 * does not say.
 *
 * Only the mark-to-market summary states this, and plenty of statements are
 * generated without that section. Reporting an empty set for those made "the
 * file is silent" indistinguishable from "the account held nothing", and the
 * two mean opposite things when a year is checked against the one before it.
 */
function readOpeningHoldings(group) {
  if (!group?.header) return { holdings: null, marks: null };
  const h = group.header;
  const iClass = columnIndex(h, 'Asset Category', "Catégorie d'actifs");
  const iSymbol = columnIndex(h, 'Symbol', 'Symbole');
  const iQty = columnIndex(h, 'Prior Quantity', 'Avant Quantité');
  const iPrice = columnIndex(h, 'Prior Price', 'Avant Prix');
  if (iSymbol < 0 || iQty < 0) return { holdings: null, marks: null };

  const holdings = {};
  const marks = {};
  for (const r of group.rows) {
    if (isTotalRow(r)) continue;
    const category = iClass >= 0 ? clean(r[iClass]) : '';
    /**
     * Holdings, not the cash line. The Forex row is the cash balance under a
     * currency's name; it is told apart by that shape rather than by the word
     * "Stocks", which is only English. Options and futures stay out as before.
     */
    const symbol = clean(r[iSymbol] ?? '');
    const cashLine = /^(forex|fx|devises?)$/i.test(category)
      || (/^[A-Z]{3}$/.test(symbol) && iPrice >= 0 && num(r[iPrice]) === 1);
    const notShares = /^(options?|futures?|bonds?|warrants?|cfds?)$/i.test(category);
    if (cashLine || notShares) continue;
    const ticker = clean(r[iSymbol]).replace(/\s+/g, '.');
    const qty = num(r[iQty]);
    if (!ticker || Math.abs(qty) < 1e-9) continue;
    holdings[ticker] = (holdings[ticker] ?? 0) + qty;
    const price = iPrice >= 0 ? num(r[iPrice]) : 0;
    if (price > 0) marks[ticker] = price;
  }
  return { holdings, marks };
}

/**
 * Shares moved between the accounts a combined statement covers.
 *
 * Both legs are present and cancel, which is the point: without them a holding
 * disappears from one account on the day it moved and only reappears in the
 * other, so the combined book dips for no reason.
 */
function readTransfers(group) {
  if (!group?.header) return [];
  const h = group.header;
  const iSymbol = columnIndex(h, 'Symbol', 'Symbole');
  const iDate = columnIndex(h, 'Date');
  const iQty = columnIndex(h, 'Qty', 'Qté', 'Quantity', 'Quantité');
  const iCash = columnIndex(h, 'Cash Amount', 'Montant trésorerie');
  if (iSymbol < 0 || iDate < 0 || iQty < 0) return [];

  const out = [];
  for (const r of group.rows) {
    if (isTotalRow(r)) continue;
    const ticker = clean(r[iSymbol]).replace(/\s+/g, '.');
    const date = clean(r[iDate]).split(',')[0].trim();
    const qty = num(r[iQty]);
    if (!ticker || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Math.abs(qty) < 1e-9) continue;
    out.push({ date, kind: 'transfer', ticker, qty, cash: iCash >= 0 ? num(r[iCash]) : 0 });
  }
  return out;
}

/**
 * Dated cash events: dividends, interest and withholding tax.
 *
 * The totals are already read for the income summary; what the daily history
 * needs is the dates, so a dividend lands on the day it was paid rather than
 * being smeared across the year.
 */
function readDatedCash(group, kind) {
  if (!group?.header) return [];
  const h = group.header;
  const iDate = columnIndex(h, 'Date');
  const iAmount = columnIndex(h, 'Amount', 'Montant');
  if (iDate < 0 || iAmount < 0) return [];

  const out = [];
  for (const r of group.rows) {
    if (isTotalRow(r)) continue;
    const date = clean(r[iDate]).split(',')[0].trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const cash = num(r[iAmount]);
    if (!Number.isFinite(cash) || cash === 0) continue;
    out.push({ date, kind, cash });
  }
  return out;
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
    /**
     * Shorts included. A negative quantity is a short position, and dropping it
     * left the account worth the whole short more than the broker says — USO
     * short 8 shares put a real account $1,294.88 above its net asset value.
     */
    .filter((p) => Math.abs(p.qty) > 0 && p.entry > 0);
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
  const iPrice = columnIndex(h, 'T. Price', 'Prix trans.');
  const iProceeds = columnIndex(h, 'Proceeds', 'Produit');
  if (iSymbol < 0 || iDate < 0 || iQty < 0) return { closed: [], commissions: 0 };

  const firstBuy = new Map();
  /**
   * Net shares traded per ticker over the period.
   *
   * Subtracted from the closing quantity it gives the opening one, which is the
   * only reliable way to tell a holding carried in from last year from one
   * opened this year. A first purchase inside the period is not that test: a
   * position held since last year and bought into again in May has one, and
   * dating the whole holding to May hides it from every day before then.
   */
  const netQty = new Map();
  /**
   * Every share movement with a date on it.
   *
   * The closed rows below record realised profit in money, which is what a
   * journal needs and what the broker reports. Valuing a past day needs shares,
   * and no amount of care with the closed rows recovers them — so the raw
   * movements are kept alongside.
   */
  const ledger = [];
  const closed = [];
  let commissions = 0;

  for (const r of group.rows) {
    if (isTotalRow(r)) continue;
    const ticker = clean(r[iSymbol]).replace(/\s+/g, '.');
    const date = clean(r[iDate]).split(',')[0].trim();
    if (!ticker || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const qty = num(r[iQty]);
    netQty.set(ticker, (netQty.get(ticker) ?? 0) + qty);
    if (iComm >= 0) commissions += num(r[iComm]);

    // Proceeds are positive on a sale and negative on a purchase, and the
    // commission is already signed, so the cash moved by exactly their sum.
    ledger.push({
      date,
      // To the second, because a split lands at a time of day and a trade on
      // the same date can fall either side of it.
      at: `${date} ${clean(r[iDate]).split(',')[1]?.trim() || '00:00:00'}`,
      ticker,
      qty,
      price: iPrice >= 0 ? num(r[iPrice]) : 0,
      cash: (iProceeds >= 0 ? num(r[iProceeds]) : 0) + (iComm >= 0 ? num(r[iComm]) : 0),
    });

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
      /**
       * Held before this statement began, so the purchase is not in it.
       *
       * The open date above falls back to the sale date, which keeps the row
       * readable but is not when the position was taken. Anything reconstructing
       * a past day has to know the difference: treating that fallback as a real
       * purchase makes the holding appear on the day it was sold and vanish from
       * every day before it, which on this book hid ninety per cent of January.
       *
       * Per tranche, not per ticker. A holding carried in from last year and
       * then bought into again in May has a first buy in this period, but the
       * shares sold in January were not those — dating them to May puts their
       * cost back into January cash and overstated that day by twenty-two
       * per cent.
       */
      carriedIn: !firstBuy.has(ticker) || date < firstBuy.get(ticker),
    });
  }

  return { closed, commissions, firstBuy, netQty, ledger };
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
  const row = navCashRow(group, iClass);
  return row ? num(row[iCurrent]) : null;
}

/**
 * Dividends declared but not yet paid.
 *
 * IBKR carries these as their own line in net asset value, so an account whose
 * holdings have gone ex-dividend is worth slightly more than its cash and
 * positions come to. Left out, the app's account value sits a little under the
 * broker's — eighty-two cents on this book, which is small but is the whole
 * remaining difference between the two figures, and "small" is not the same as
 * "explained".
 *
 * It is money owed to the account rather than a holding, so it rides with cash,
 * which is where the broker settles it days later anyway.
 */
/**
 * The accounts a statement covers.
 *
 * A consolidated export carries several, and that is worth saying out loud: the
 * figures here are the sum of them, while the broker's own app usually opens on
 * one. Two correct numbers that describe different sets of accounts look exactly
 * like one of them being wrong, and there is nothing inside the arithmetic that
 * can tell you which you are looking at.
 */
function readAccounts(group) {
  if (!group?.header) return [];
  const row = group.rows.find((r) => /accounts included|comptes inclus/i.test(clean(r[0])));
  if (!row) return [];
  return String(row[1] ?? '').split(/[,;]/).map((x) => clean(x)).filter(Boolean);
}

function readNavAccruals(group) {
  if (!group?.header) return null;
  const iCurrent = columnIndex(group.header, 'Current Total', 'Total actuel');
  if (iCurrent < 0) return null;
  const row = group.rows.find((r) => /dividend accrual|cumul.*dividende/i.test(clean(r[0])));
  return row ? num(row[iCurrent]) : null;
}

/**
 * The cash balance the period *opened* with.
 *
 * The same row carries both ends, and the forward walk needs the left-hand one:
 * it is the only figure that makes the first day a fact rather than an
 * inference. Everything after it is arithmetic on dated events.
 */
function readOpeningCash(group) {
  if (!group?.header) return null;
  const iPrior = columnIndex(group.header, 'Prior Total', 'Total précédent');
  if (iPrior < 0) return null;
  const row = navCashRow(group, 0);
  return row ? num(row[iPrior]) : null;
}

/**
 * The cash line of net asset value: by name where the language is known, and
 * otherwise the first line of figures, since IBKR always lists cash first.
 */
function navCashRow(group, iClass) {
  return group.rows.find((r) => /^(cash|trésorerie)$/i.test(clean(r[iClass] ?? '')))
    ?? group.rows.find((r) => r.length >= 6 && [1, 2, 3, 4, 5].every((i) => isNumber(r[i])));
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
  // In a language not named above: IBKR opens the list with the starting value and closes it with the ending one.
  const figures = group.rows.filter((r) => isNumber(r[1]));
  if (out.startNav == null && figures.length >= 2) out.startNav = num(figures[0][1]);
  if (out.endNav == null && figures.length >= 2) out.endNav = num(figures[figures.length - 1][1]);
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
  ['january', 'janvier', 'januar', 'enero', 'gennaio', 'janeiro', 'januari', 'январь', 'января', 'styczeń', 'stycznia', 'ocak', 'tammikuu', 'tammikuuta'],
  ['february', 'février', 'februar', 'febrero', 'febbraio', 'fevereiro', 'februari', 'февраль', 'февраля', 'luty', 'lutego', 'şubat', 'helmikuu', 'helmikuuta'],
  ['march', 'mars', 'märz', 'maerz', 'marzo', 'março', 'maart', 'март', 'марта', 'marzec', 'marca', 'mart', 'maaliskuu', 'maaliskuuta'],
  ['april', 'avril', 'abril', 'aprile', 'апрель', 'апреля', 'kwiecień', 'kwietnia', 'nisan', 'huhtikuu', 'huhtikuuta'],
  ['may', 'mai', 'mayo', 'maggio', 'maio', 'mei', 'май', 'мая', 'maj', 'maja', 'mayıs', 'toukokuu', 'toukokuuta'],
  ['june', 'juin', 'juni', 'junio', 'giugno', 'junho', 'июнь', 'июня', 'czerwiec', 'czerwca', 'haziran', 'kesäkuu', 'kesäkuuta'],
  ['july', 'juillet', 'juli', 'julio', 'luglio', 'julho', 'июль', 'июля', 'lipiec', 'lipca', 'temmuz', 'heinäkuu', 'heinäkuuta'],
  ['august', 'août', 'agosto', 'augustus', 'август', 'августа', 'sierpień', 'sierpnia', 'ağustos', 'elokuu', 'elokuuta'],
  ['september', 'septembre', 'septiembre', 'settembre', 'setembro', 'сентябрь', 'сентября', 'wrzesień', 'września', 'eylül', 'syyskuu', 'syyskuuta'],
  ['october', 'octobre', 'oktober', 'octubre', 'ottobre', 'outubro', 'октябрь', 'октября', 'październik', 'października', 'ekim', 'lokakuu', 'lokakuuta'],
  ['november', 'novembre', 'noviembre', 'novembro', 'ноябрь', 'ноября', 'listopad', 'listopada', 'kasım', 'marraskuu', 'marraskuuta'],
  ['december', 'décembre', 'dezember', 'diciembre', 'dicembre', 'dezembro', 'декабрь', 'декабря', 'grudzień', 'grudnia', 'aralık', 'joulukuu', 'joulukuuta'],
];

/** Month names folded for comparison: lower case, accents and a trailing full stop dropped. */
const foldMonth = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\.$/, '');
const MONTHS = new Map(MONTH_NAMES.flatMap((names, i) => names.map((name) => [foldMonth(name), i + 1])));

/**
 * A written date as YYYY-MM-DD, or null.
 *
 * "Août 28, 2026" and "September 15, 2026" as IBKR writes them; "15 de
 * septiembre de 2026" and "15. September 2026" with the day first;
 * "2026年9月15日" and "2026년 9월 15일" with no month name at all.
 */
function readWrittenDate(text) {
  const t = String(text ?? '');
  const pad = (n) => String(n).padStart(2, '0');
  const valid = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(Number(d))}` : null);

  let match = /(\d{4})\s*[年년./-]\s*(\d{1,2})\s*[月월./-]\s*(\d{1,2})/.exec(t);
  if (match) return valid(match[1], Number(match[2]), Number(match[3]));

  match = /([\p{L}]+)\.?\s+(\d{1,2}),?\s+(\d{4})/u.exec(t);
  if (match && MONTHS.has(foldMonth(match[1]))) return valid(match[3], MONTHS.get(foldMonth(match[1])), match[2]);

  match = /(\d{1,2})\.?\s+(?:de\s+)?([\p{L}]+)\.?,?\s+(?:de\s+)?(\d{4})/u.exec(t);
  if (match && MONTHS.has(foldMonth(match[2]))) return valid(match[3], MONTHS.get(foldMonth(match[2])), match[1]);
  return null;
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

/**
 * The dated amounts added up, for a section whose total line is labelled in a
 * language not read by name. Only a section given English columns by its shape
 * has them, so a named section reads exactly as before.
 */
function sumOfDated(group) {
  const iDate = columnIndex(group.header, 'Date', 'Settle Date');
  const iAmount = columnIndex(group.header, 'Amount');
  if (iDate < 0 || iAmount < 0) return 0;
  return group.rows
    .filter((r) => ISO_DATE.test(clean(r[iDate] ?? '').split(',')[0]))
    .reduce((sum, r) => sum + num(r[iAmount]), 0);
}

/** Totals from the simple income sections. */
function readTotal(group) {
  if (!group?.header) return 0;
  const row = group.rows.find((r) => isTotalRow(r));
  if (!row) return sumOfDated(group);
  // The amount is the last numeric field on the total line.
  for (let i = row.length - 1; i >= 0; i--) {
    const v = clean(row[i]);
    if (v && Number.isFinite(Number(v.replace(/,/g, '')))) return num(v);
  }
  return 0;
}

/**
 * Share splits, from the corporate actions.
 *
 * Only the ratio and the moment are kept. Every movement of that ticker dated
 * before the split is later expressed in the shares that exist after it,
 * because that is the unit the price history uses. IBKR books a split as two
 * rows — the old line leaving, the new one arriving — carrying the same
 * description, so the pair collapses to one entry.
 */
function readSplits(group) {
  if (!group?.header) return [];
  const iDate = columnIndex(group.header, 'Date/Time', 'Date/Heure');
  const iDesc = columnIndex(group.header, 'Description');
  if (iDate < 0 || iDesc < 0) return [];

  const seen = new Map();
  for (const r of group.rows) {
    if (isTotalRow(r)) continue;
    const match = /^\s*([A-Z0-9 .-]+?)\s*\([A-Z0-9]+\)\s+split\s+([\d.]+)\s+for\s+([\d.]+)/i.exec(clean(r[iDesc] ?? ''));
    const [day, time] = clean(r[iDate] ?? '').split(',').map((s) => s.trim());
    if (!match || !/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) continue;
    const ratio = num(match[2]) / num(match[3]);
    if (!Number.isFinite(ratio) || !(ratio > 0)) continue;
    const ticker = match[1].trim().replace(/\s+/g, '.');
    const at = `${day} ${time || '00:00:00'}`;
    seen.set(`${ticker}|${at}`, { ticker, date: day, at, ratio });
  }
  return [...seen.values()];
}

/**
 * True when a file is an Interactive Brokers statement, CSV or HTML, rather
 * than another broker's export. Decided by whether IBKR's own sections are in
 * it, which no other broker's table of transactions has.
 */
export function isIbkrStatement(text) {
  if (looksLikeHtmlStatement(text)) return true;
  const groups = groupSections(String(text ?? ''));
  return groups.has('trades') || groups.has('positions') || groups.has('nav') || groups.has('statement');
}

/**
 * Read a statement. Throws only when the file is not one.
 *
 * Takes IBKR's CSV export or its HTML statement page; the page is turned into
 * the same rows first, so everything below reads both.
 */
export function parseIbkrStatement(text) {
  const groups = groupSections(looksLikeHtmlStatement(text) ? htmlStatementToCsv(text) : text);
  if (!groups.size) {
    throw new Error('That does not look like an Interactive Brokers activity statement.');
  }

  const positions = readOpenPositions(groups.get('positions'));
  const { closed, commissions, firstBuy, netQty, ledger } = readTrades(groups.get('trades'));
  const navChange = readNavChange(groups.get('navChange'));
  const cash = readNavCash(groups.get('nav'));
  const accruals = readNavAccruals(groups.get('nav'));
  const accounts = readAccounts(groups.get('account'));
  const openingCash = readOpeningCash(groups.get('nav'));
  const { holdings: openingHoldings, marks: openingMarks } = readOpeningHoldings(groups.get('mtm'));
  const transfers = readTransfers(groups.get('transfers'));
  const splits = readSplits(groups.get('corporateActions'));
  const income = [
    ...readDatedCash(groups.get('dividends'), 'dividend'),
    ...readDatedCash(groups.get('interest'), 'interest'),
    ...readDatedCash(groups.get('tax'), 'tax'),
  ];
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
    netQty,
    ledger,
    openingCash,
    openingHoldings,
    openingMarks,
    transfers,
    splits,
    dated: income,
    periodStart,
    periodEnd: period.to,
    twr,
    cash: cash ?? null,
    /** Dividends declared and not yet paid; part of the broker's NAV. */
    accruals: accruals ?? 0,
    /** Every account this export covers; more than one means it is consolidated. */
    accounts,
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
/** A value from a Map, or from the plain object a stored statement keeps instead. */
const lookup = (source, key) => (source instanceof Map ? source.get(key) : source?.[key]);

/**
 * A statement's own lists, which an older or partly written record can be
 * missing.
 *
 * Read straight, a record without them threw while the journal was being
 * rebuilt — and every caller rebuilds: adding a file, removing a year, opening
 * the app. Removing a year was where it showed, because the × threw and so did
 * nothing at all. A statement with no closed trades is an ordinary thing; a
 * record that cannot say is treated the same way, as none.
 */
const listOf = (value) => (Array.isArray(value) ? value : []);

export function statementToJournal(parsed, existing = {}) {
  let id = Date.now() * 1000;
  const nextId = () => { id += 1; return id; };

  const open = listOf(parsed.positions).map((p) => ({
    id: nextId(),
    ticker: p.ticker,
    cls: 'Stocks',
    // A negative quantity is a short: held as that many shares short, valued at minus their price.
    dir: p.qty < 0 ? 'Short' : 'Long',
    status: 'Open',
    // A holding bought before the statement period has no purchase in it, so
    // its opening date is genuinely unknown and stays null. That is what marks
    // it as carried in from an earlier year rather than opened this one.
    open: lookup(parsed.firstBuy, p.ticker) ?? null,
    /**
     * Held before this statement began.
     *
     * Closing quantity less everything traded in the period is the opening
     * quantity, and anything above zero means the holding predates the
     * statement however much of it was traded since.
     */
    carriedIn: Math.abs(p.qty - (lookup(parsed.netQty, p.ticker) ?? 0)) > 1e-9,
    close: null,
    entry: p.entry,
    cur: p.cur,
    qty: Math.abs(p.qty),
    amount: p.entry * Math.abs(p.qty),
    reason: null,
  }));

  const closed = listOf(parsed.closed).map((c) => {
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
    // The broker's cash already holds any short's sale proceeds (store.js SHORT_CASH_MODEL), so nothing is corrected on load.
    cashModel: 2,
    positions: [...closed, ...open],
    // Accruals ride with cash so the account value equals the broker's NAV.
    cash: (parsed.cash ?? 0) + (parsed.accruals ?? 0),
    // The recorded account curve is left alone: it is a log of what this app
    // observed on the days it was open, and no statement can restate that.
    snapshots: existing.snapshots ?? [],
    cashFlows: parsed.flows,
    /**
     * The share movements, kept so a past day can be valued.
     *
     * `holdings` is the quantity per ticker at the statement's close and
     * `trades` every movement inside the period, so any earlier day is the one
     * with the other undone. The positions above cannot answer this: they carry
     * realised profit in money, and a holding carried in from last year and
     * bought into again during the period leaves no record of that purchase.
     */
    /**
     * The opening balance and every dated event after it.
     *
     * This is what lets the daily history be walked *forward* — the broker's own
     * arithmetic — rather than inferred by undoing today. A backward walk can
     * only undo the movements it knows about, so anything missing quietly
     * becomes a holding that was always there; a forward walk from a stated
     * opening balance misses loudly at the close instead, where it can be
     * checked against the statement.
     *
     * Everything that moves shares or cash is here with its date: trades,
     * internal transfers, deposits, dividends, interest and withholding tax.
     * `openingMarks` prices the holdings the price service cannot answer for.
     */
    ledger: {
      from: parsed.periodStart ?? null,
      to: parsed.periodEnd ?? null,
      openingCash: parsed.openingCash ?? null,
      openingHoldings: parsed.openingHoldings ?? {},
      openingMarks: parsed.openingMarks ?? {},
      events: [
        ...(parsed.ledger ?? []).map((t) => ({ ...t, kind: 'trade' })),
        ...(parsed.transfers ?? []),
        ...(parsed.flows ?? []).map((f) => ({ date: f.date, kind: 'flow', cash: f.amount })),
        ...(parsed.dated ?? []),
      ].sort((a, b) => a.date.localeCompare(b.date)),
      /** The closing quantities, kept so the walk can be checked against them. */
      holdings: Object.fromEntries(listOf(parsed.positions).map((p) => [p.ticker, p.qty])),
    },
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
    /**
     * Said out loud because it is the one thing in here whose absence is
     * invisible. Everything else above shows up as a wrong position or a wrong
     * balance; a missing time-weighted return just leaves the year quietly
     * measured a different way, and the only way to find out was to compare
     * against the broker and wonder which was broken.
     */
    parsed.twr != null
      ? `broker's own return ${parsed.twr.toFixed(2)}% through ${parsed.periodEnd ?? 'the period end'}`
      : 'no broker return in this file — the year will be measured here instead',
    /**
     * Named because a consolidated export is the one difference that makes two
     * correct figures disagree. Every number here is the sum of these accounts;
     * the broker's app usually opens on a single one, and the same day's move
     * over a different set of holdings is a different percentage.
     */
    parsed.accounts?.length > 1
      ? `covers ${parsed.accounts.length} accounts combined (${parsed.accounts.join(', ')}) — `
        + "figures here are their total, which will not match a single account in the broker's app"
      : null,
  ].filter(Boolean).join(' · ');
}
