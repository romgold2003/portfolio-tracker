/**
 * Reading a trade history exported by any broker.
 *
 * Interactive Brokers has a statement format of its own, read by ibkr.js. Every
 * other broker exports some flavour of a table of transactions, and no two
 * agree on the flavour: comma or semicolon, "1,234.56" or "1.234,56",
 * 03/04/2025 meaning March or April, "Buy" or "BUY" or "Achat" or a negative
 * quantity with no action column at all. So nothing here assumes a broker.
 * The table is read, each column is guessed at from its header, the person
 * importing confirms or corrects the guesses, and the rows are turned into one
 * plain list of transactions everything downstream understands.
 *
 * Pure: no DOM, no storage. The mapping a person chooses is remembered by the
 * caller, keyed by the file's headers, so next year's export from the same
 * broker needs no questions.
 */

/* ───────────────────────── the table ───────────────────────── */

/** Split CSV text into rows of cells, honouring quotes and newlines inside them. */
function splitRows(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === delimiter) {
      row.push(cell); cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else {
      cell += c;
    }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * The delimiter: whichever of comma, semicolon or tab splits the opening lines
 * into the same number of cells most consistently.
 *
 * Counting characters alone gets European exports wrong — they separate with
 * semicolons precisely because their numbers are full of commas.
 */
function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 15).join('\n');
  let best = ',';
  let bestScore = -1;
  for (const delimiter of [',', ';', '\t']) {
    const counts = splitRows(sample, delimiter).map((r) => r.length).filter((n) => n > 1);
    if (!counts.length) continue;
    const common = counts.sort((a, b) => counts.filter((x) => x === b).length - counts.filter((x) => x === a).length)[0];
    const score = counts.filter((n) => n === common).length * common;
    if (score > bestScore) { best = delimiter; bestScore = score; }
  }
  return best;
}

const looksNumeric = (s) => /^[\s(+-]*[$€£¥]?\s*[\d.,\s']+\)?\s*%?$/.test(s) && /\d/.test(s);

/**
 * The table in a CSV: its header row and the rows under it.
 *
 * Exports often open with a title, an account number or a blank line before
 * the real header, so the header is the first row that reads like one — mostly
 * words rather than numbers, and as wide as the rows after it.
 */
export function parseCsvTable(text) {
  const clean = String(text ?? '').replace(/^﻿/, '');
  const delimiter = detectDelimiter(clean);
  const rows = splitRows(clean, delimiter)
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some(Boolean));
  if (!rows.length) return { delimiter, headers: [], rows: [] };

  let headerAt = 0;
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const filled = rows[i].filter(Boolean);
    if (filled.length < 2) continue;
    const wordy = filled.filter((c) => /\p{L}/u.test(c) && !looksNumeric(c)).length;
    const next = rows[i + 1];
    if (wordy / filled.length >= 0.6 && (!next || next.length >= filled.length - 1)) {
      headerAt = i;
      break;
    }
  }

  const seen = new Map();
  const headers = rows[headerAt].map((h, i) => {
    const name = h || `Column ${i + 1}`;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n > 1 ? `${name} ${n}` : name;
  });
  const body = rows.slice(headerAt + 1).map((r) => headers.map((_, i) => r[i] ?? ''));
  return { delimiter, headers, rows: body };
}

/* ───────────────────────── what each column is ───────────────────────── */

/**
 * The fields a transaction can have, and the header words that suggest each.
 *
 * Hints earlier in a list are preferred: a file with both a trade date and a
 * settlement date should be read by the day the trade happened.
 */
export const FIELDS = [
  {
    key: 'date', label: 'Date', required: true,
    hints: ['trade date', 'activity date', 'transaction date', 'execution date', 'date/time', 'datetime', 'date', 'time', 'run date', 'process date', 'settlement date', 'datum', 'fecha', 'data'],
  },
  {
    key: 'ticker', label: 'Ticker / symbol', required: true,
    hints: ['symbol', 'ticker', 'instrument', 'security', 'stock', 'asset', 'code', 'product', 'titre', 'valeur', 'wertpapier', 'name'],
  },
  {
    key: 'action', label: 'Buy / sell / type',
    hints: ['action', 'side', 'buy/sell', 'transaction type', 'trans code', 'type', 'activity', 'direction', 'operation', 'order type', 'sens', 'typ'],
  },
  {
    key: 'quantity', label: 'Quantity',
    hints: ['quantity', 'qty', 'no. of shares', 'number of shares', 'shares', 'units', 'quantité', 'quantite', 'anzahl', 'stück', 'aantal', 'cantidad', 'volume'],
  },
  {
    key: 'price', label: 'Price per share',
    hints: ['price per share', 'execution price', 'trade price', 'unit price', 'price', 'cours', 'kurs', 'koers', 'precio', 'prix'],
  },
  {
    key: 'amount', label: 'Total amount',
    hints: ['net amount', 'total amount', 'amount', 'total', 'net', 'value', 'proceeds', 'montant', 'betrag', 'waarde', 'totaal', 'importe'],
  },
  {
    key: 'fees', label: 'Fees / commission',
    hints: ['commission', 'commissions', 'fees', 'fee', 'charges', 'costs', 'transactiekosten', 'kosten', 'frais', 'gebühren', 'gebuhren', 'comisión'],
  },
  {
    key: 'currency', label: 'Currency',
    hints: ['currency', 'ccy', 'devise', 'währung', 'waehrung', 'moneda'],
  },
  {
    /**
     * Free text about the row. Read to tell what a row is when there is no type
     * column, and which way money went: many exports write every amount as
     * positive and say "Transfer to bank" or "Incoming wire" in words.
     */
    key: 'description', label: 'Description',
    hints: ['description', 'details', 'narrative', 'memo', 'comment', 'libellé', 'libelle', 'omschrijving', 'beschreibung', 'descripción'],
  },
];

const normalise = (h) => String(h ?? '').toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();

/** How strongly a header suggests a hint list; 0 when it does not. */
function scoreHeader(header, hints) {
  const h = normalise(header);
  let best = 0;
  hints.forEach((hint, rank) => {
    if (h === hint) best = Math.max(best, 1000 - rank);
    else if (new RegExp(`(^|[^\\p{L}])${hint.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}($|[^\\p{L}])`, 'u').test(h)) {
      best = Math.max(best, 500 - rank * 10 + hint.length);
    }
  });
  return best;
}

/**
 * A first guess at which column is which, one column per field.
 *
 * Fields are placed in order of how much they matter, each taking the
 * best-suited column nobody has claimed yet — so "Amount" cannot be taken for
 * the price because "Price" was already there.
 */
export function guessMapping(headers) {
  const mapping = {};
  const used = new Set();
  const order = ['date', 'ticker', 'quantity', 'price', 'fees', 'amount', 'action', 'currency', 'description'];
  for (const key of order) {
    const field = FIELDS.find((f) => f.key === key);
    let bestIndex = -1;
    let bestScore = 0;
    headers.forEach((header, i) => {
      if (used.has(i)) return;
      const score = scoreHeader(header, field.hints);
      if (score > bestScore) { bestScore = score; bestIndex = i; }
    });
    if (bestIndex >= 0) {
      mapping[key] = headers[bestIndex];
      used.add(bestIndex);
    }
  }
  return mapping;
}

/** Fields still needed before the file can be read. */
export function missingFields(mapping) {
  const need = FIELDS.filter((f) => f.required && !mapping?.[f.key]).map((f) => f.label);
  if (!mapping?.quantity && !mapping?.amount) need.push('Quantity or Total amount');
  return need;
}

/* ───────────────────────── numbers ───────────────────────── */

/**
 * Whether the file writes decimals with a comma.
 *
 * Decided once for the whole file from the numbers in it, because a single
 * value like "1,234" is genuinely ambiguous — a thousand and some, or one and a
 * bit — and only its neighbours say which.
 */
export function detectNumberStyle(values) {
  let comma = 0;
  let dot = 0;
  for (const raw of values) {
    const s = String(raw ?? '').replace(/[^\d.,]/g, '');
    if (/\.\d{3},\d+$/.test(s) || /^\d+,\d{1,2}$/.test(s) || /^\d{1,3},\d{4,}$/.test(s)) comma++;
    else if (/,\d{3}\.\d+$/.test(s) || /^\d+\.\d{1,2}$/.test(s) || /^\d+\.\d{4,}$/.test(s)) dot++;
  }
  return comma > dot ? 'comma' : 'dot';
}

/** A number as written in the file, or null. Parentheses and a trailing minus are negatives. */
export function parseNumber(value, style = 'dot') {
  let s = String(value ?? '').trim();
  if (!s || !/\d/.test(s)) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/[\s '’]/g, '');
  if (/-$/.test(s)) { negative = !negative; s = s.slice(0, -1); }
  if (/^-/.test(s)) { negative = !negative; s = s.slice(1); }
  s = s.replace(/^\+/, '').replace(/[^\d.,]/g, '');
  s = style === 'comma' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/* ───────────────────────── dates ───────────────────────── */

const MONTHS = {
  jan: 1, janv: 1, january: 1, janvier: 1, januar: 1, ene: 1, enero: 1,
  feb: 2, fév: 2, fev: 2, févr: 2, fevr: 2, february: 2, février: 2, februar: 2, febrero: 2,
  mar: 3, mär: 3, march: 3, mars: 3, märz: 3, marzo: 3,
  apr: 4, avr: 4, abr: 4, april: 4, avril: 4, abril: 4,
  may: 5, mai: 5, mayo: 5,
  jun: 6, juin: 6, june: 6, juni: 6, junio: 6,
  jul: 7, juil: 7, july: 7, juillet: 7, juli: 7, julio: 7,
  aug: 8, aoû: 8, aou: 8, août: 8, aout: 8, august: 8, ago: 8, agosto: 8,
  sep: 9, sept: 9, september: 9, septembre: 9, septiembre: 9,
  oct: 10, okt: 10, october: 10, octobre: 10, oktober: 10, octubre: 10,
  nov: 11, november: 11, novembre: 11, noviembre: 11,
  dec: 12, déc: 12, dez: 12, dic: 12, december: 12, décembre: 12, dezember: 12, diciembre: 12,
};

/**
 * Whether numeric dates are day-first or month-first.
 *
 * A day above 12 settles it; failing any, the separator is the best evidence
 * there is — dots and dashes are European, slashes mostly American.
 */
export function detectDateOrder(values) {
  let dmy = 0;
  let mdy = 0;
  let slash = 0;
  let other = 0;
  for (const raw of values) {
    const m = /^\s*(\d{1,2})([/.-])(\d{1,2})\2(\d{2,4})/.exec(String(raw ?? ''));
    if (!m) continue;
    if (m[2] === '/') slash++; else other++;
    if (Number(m[1]) > 12) dmy++;
    else if (Number(m[3]) > 12) mdy++;
  }
  if (dmy || mdy) return dmy >= mdy ? 'dmy' : 'mdy';
  return slash > other ? 'mdy' : 'dmy';
}

const pad = (n) => String(n).padStart(2, '0');

function validDate(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2200)) return null;
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function timeOf(rest) {
  const t = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i.exec(rest ?? '');
  if (!t) return null;
  let hour = Number(t[1]);
  if (t[4]) {
    const pm = t[4].toLowerCase() === 'pm';
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  }
  return `${pad(hour)}:${t[2]}:${t[3] ?? '00'}`;
}

/** A date as the file writes it, as { date: YYYY-MM-DD, time }, or null. */
export function parseDate(value, order = 'dmy') {
  const s = String(value ?? '').trim();
  if (!s) return null;

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(.*)$/.exec(s);
  if (m) {
    const date = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
    return date ? { date, time: timeOf(m[4]) } : null;
  }

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(.*)$/.exec(s);
  if (m) {
    let year = Number(m[3]);
    if (m[3].length === 2) year += 2000;
    const [day, month] = order === 'mdy' ? [Number(m[2]), Number(m[1])] : [Number(m[1]), Number(m[2])];
    const date = validDate(year, month, day);
    return date ? { date, time: timeOf(m[4]) } : null;
  }

  // Written months: "Jan 5, 2025", "5 January 2025", "05-Jan-2025".
  m = /^(?:\p{L}+,?\s+)?(\p{L}+)\.?[\s-]+(\d{1,2}),?[\s-]+(\d{4})(.*)$/u.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) {
    const date = validDate(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]));
    return date ? { date, time: timeOf(m[4]) } : null;
  }
  m = /^(\d{1,2})[\s.-]+(\p{L}+)\.?[\s,.-]+(\d{4})(.*)$/u.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const date = validDate(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
    return date ? { date, time: timeOf(m[4]) } : null;
  }
  return null;
}

/* ───────────────────────── what a row is ───────────────────────── */

/**
 * The kind of transaction a row describes, from its action or type text.
 *
 * Order matters and is deliberate: a withdrawal is checked before a deposit,
 * a sale before a purchase, and dividends and fees before either, because
 * brokers write "Dividend reinvestment buy" and "Fee on sale".
 */
export function classifyAction(text) {
  const t = ` ${String(text ?? '').toLowerCase()} `;
  if (!t.trim()) return null;
  if (/split/.test(t)) return 'split';
  // A dividend spent on shares: a purchase when it carries a quantity, which is
  // decided where the quantity is known.
  if (/reinvest|\bdrip\b/.test(t)) return 'reinvest';
  if (/dividend|dividende|\bcdiv\b|\bdiv\b|distribution|ausschüttung/.test(t)) return 'dividend';
  if (/interest|intérêt|interet|\bzins|\bint\b/.test(t)) return 'interest';
  if (/withdraw|retrait|auszahlung|\bwdl\b|retiro/.test(t)) return 'withdrawal';
  if (/deposit|dépôt|depot|einzahlung|funding|top.?up|\bdep\b/.test(t)) return 'deposit';
  if (/\bfee|commission|frais|gebühr|gebuhr|withholding|\btax|stamp duty|charge/.test(t)) return 'fee';
  if (/\bsell|\bsold\b|\bsld\b|verkauf|vente|venta|\bstc\b|^\s*s\s*$/.test(t)) return 'sell';
  if (/\bbuy|\bbought\b|\bbot\b|kauf|achat|compra|purchase|\bbto\b|^\s*b\s*$/.test(t)) return 'buy';
  if (/transfer|journal|\bach\b|wire|virement|überweisung/.test(t)) return 'transfer';
  return null;
}

/**
 * Which way a transfer of money went, when the words say so.
 *
 * Returns 'in', 'out', or null when the text is silent and the sign of the
 * amount has to decide.
 */
export function transferDirection(text) {
  const t = ` ${String(text ?? '').toLowerCase()} `;
  if (/withdraw|retrait|auszahlung|outgoing|payout|\bsent\b|(transfer|wire|ach|payment)\s+(out\b|to\b)|\bto (bank|checking|savings|current account|account ending)/.test(t)) return 'out';
  if (/deposit|dépôt|depot|einzahlung|incoming|received|(transfer|wire|ach)\s+(in\b|from\b)|\bfrom (bank|checking|savings|current account)/.test(t)) return 'in';
  return null;
}

/** Every column's values under the chosen field, for detecting formats. */
function columnValues(table, header) {
  const i = table.headers.indexOf(header);
  return i < 0 ? [] : table.rows.map((r) => r[i]);
}

/** Formats read from the file itself, before anyone chooses. */
export function detectFormats(table, mapping) {
  return {
    dateOrder: detectDateOrder(columnValues(table, mapping.date)),
    numberStyle: detectNumberStyle(['quantity', 'price', 'amount', 'fees']
      .flatMap((k) => (mapping[k] ? columnValues(table, mapping[k]) : []))),
  };
}

/**
 * The rows as transactions.
 *
 * Returns what could be read and, separately, what could not and why — a row
 * the file has that is silently dropped is how a journal ends up a trade short
 * with nothing to say so.
 */
export function readTransactions(table, mapping, formats = detectFormats(table, mapping)) {
  const col = (key) => table.headers.indexOf(mapping?.[key]);
  const at = Object.fromEntries(FIELDS.map((f) => [f.key, col(f.key)]));
  const cell = (row, key) => (at[key] >= 0 ? row[at[key]] : '');
  const number = (row, key) => (at[key] >= 0 ? parseNumber(row[at[key]], formats.numberStyle) : null);

  const transactions = [];
  const skipped = [];
  const currencies = new Set();
  let repriced = 0;

  table.rows.forEach((row, index) => {
    const line = index + 1;
    const when = parseDate(cell(row, 'date'), formats.dateOrder);
    if (!when) {
      skipped.push({ line, reason: `no date that could be read ("${cell(row, 'date')}")` });
      return;
    }

    const ticker = String(cell(row, 'ticker') ?? '').trim().toUpperCase().replace(/\s+/g, '.');
    const rawQty = number(row, 'quantity');
    const price = number(row, 'price');
    const amount = number(row, 'amount');
    const fees = Math.abs(number(row, 'fees') ?? 0);
    const currency = String(cell(row, 'currency') ?? '').trim().toUpperCase();
    if (currency) currencies.add(currency);

    const words = `${cell(row, 'action') ?? ''} ${cell(row, 'description') ?? ''}`;
    let kind = classifyAction(cell(row, 'action')) ?? classifyAction(cell(row, 'description'));
    if (kind === 'reinvest') kind = ticker && rawQty ? 'buy' : 'dividend';
    if (!kind && ticker && rawQty) kind = rawQty < 0 ? 'sell' : 'buy';
    if (!kind && !ticker && amount) kind = 'transfer';
    if (kind === 'transfer') {
      if (ticker && rawQty) { skipped.push({ line, reason: 'shares moved in or out without a price' }); return; }
      if (!amount) { skipped.push({ line, reason: 'a transfer with no amount' }); return; }
      /**
       * Which way the money went: in words when the file says it, and only
       * failing that off the sign. Plenty of exports write every amount as
       * positive and put the direction in the description, and reading the
       * sign alone counted "Transfer to bank" as money coming in — twice the
       * transfer added to an account that had just lost it.
       */
      const direction = transferDirection(words);
      kind = direction === 'out' ? 'withdrawal'
        : direction === 'in' ? 'deposit'
          : (amount > 0 ? 'deposit' : 'withdrawal');
    }
    if (!kind) {
      skipped.push({ line, reason: `not a kind of transaction this can read ("${cell(row, 'action')}")` });
      return;
    }
    if (kind === 'split') {
      skipped.push({ line, reason: `a split of ${ticker || 'a holding'}, which the file does not describe in shares` });
      return;
    }

    const base = {
      date: when.date,
      at: `${when.date} ${when.time ?? '00:00:00'}`,
      order: index,
      kind,
      currency: currency || null,
    };

    if (kind === 'buy' || kind === 'sell') {
      const qty = Math.abs(rawQty ?? 0);
      if (!ticker) { skipped.push({ line, reason: 'a trade with no ticker' }); return; }
      if (!qty) { skipped.push({ line, reason: `a ${kind} of ${ticker} with no quantity` }); return; }
      let unit = price != null && price !== 0 ? Math.abs(price) : (amount ? Math.abs(amount) / qty : null);
      if (!unit) { skipped.push({ line, reason: `a ${kind} of ${ticker} with no price or amount` }); return; }
      /**
       * A price that does not match its own total is in a different unit.
       *
       * UK exports quote in pence while the total is in pounds, and a share
       * bought abroad is quoted in its listing's currency while the total is
       * in the account's. Taken at face value a 100p share read as £100 and
       * the position came out a hundred times its size. When quantity times
       * price is further from the total than the fee and a margin explain, the
       * total is the account's own money, and the price is taken from it.
       */
      if (price && amount) {
        const stated = qty * Math.abs(price);
        const total = Math.abs(amount);
        if (Math.abs(stated - total) > fees + 0.03 * Math.max(stated, total)) {
          unit = total / qty;
          repriced += 1;
        }
      }
      /**
       * The cash that moved.
       *
       * A total column is the broker's own arithmetic, but brokers disagree on
       * what it totals. Some write the cash that actually moved, fee included;
       * others — Degiro among them — write the value of the shares and put the
       * fee in a column of its own. The two are told apart by the numbers: a
       * total that is exactly quantity times price has no fee in it yet, so
       * the fee still comes off; one that differs from it already has.
       * Without a total, the cash is rebuilt from price, quantity and fee.
       */
      const gross = qty * unit;
      let cash;
      if (amount != null && amount !== 0) {
        const total = Math.abs(amount);
        const feeStillToCome = fees > 0 && Math.abs(total - gross) <= Math.max(0.01, gross * 1e-6);
        const net = feeStillToCome ? (kind === 'buy' ? total + fees : total - fees) : total;
        cash = kind === 'buy' ? -net : net;
      } else {
        cash = kind === 'buy' ? -(gross + fees) : gross - fees;
      }
      transactions.push({ ...base, ticker, qty, price: unit, cash });
      return;
    }

    const value = amount ?? (rawQty != null && price != null ? rawQty * price : null);
    if (value == null || value === 0) {
      skipped.push({ line, reason: `a ${kind} with no amount` });
      return;
    }
    const cash = kind === 'fee' || kind === 'withdrawal' ? -Math.abs(value)
      : kind === 'deposit' ? Math.abs(value)
        : value;
    transactions.push({ ...base, ticker: ticker || null, cash });
  });

  return { transactions, skipped, currencies: [...currencies], repriced };
}

/** A key for remembering how a broker's files are laid out. */
export function layoutKey(headers) {
  return headers.map(normalise).join('|');
}
