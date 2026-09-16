/**
 * Reading a trade history exported by any broker.
 *
 * Interactive Brokers has a statement format of its own, read by ibkr.js. Every
 * other broker exports some flavour of a table of transactions, and no two
 * agree on the flavour: comma or semicolon, "1,234.56" or "1.234,56",
 * 03/04/2025 meaning March or April, "Buy" or "BUY" or "Achat" or a negative
 * quantity with no action column at all. So nothing here assumes a broker.
 * The table is read, each column is recognised from its header or, failing
 * that, from its values, and the rows are turned into one plain list of
 * transactions everything downstream understands — with no questions asked of
 * the person importing.
 *
 * Pure: no DOM, no storage.
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
  return { delimiter, ...tableFromRows(splitRows(clean, delimiter)) };
}

/**
 * The sheet of a workbook that reads as transactions: the one where every
 * field is found, and of those the longest. Banks put a summary of balances
 * beside the movements, and that sheet is not the history.
 */
export function tableFromSheets(sheets) {
  let best = null;
  for (const sheet of sheets ?? []) {
    const table = tableFromRows(sheet.rows);
    if (table.headers.length < 2 || !table.rows.length) continue;
    const readable = !missingFields(readableMapping(table)).length;
    const score = (readable ? 1e9 : 0) + table.rows.length;
    if (!best || score > best.score) best = { table, score };
  }
  return best?.table ?? null;
}

/** Rows of cells, from a CSV or a spreadsheet, as a header and the rows under it. */
export function tableFromRows(input) {
  const rows = (input ?? [])
    .map((r) => (r ?? []).map((c) => String(c ?? '').trim()))
    .filter((r) => r.some(Boolean));
  if (!rows.length) return { headers: [], rows: [] };

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
  return { headers, rows: body };
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
    hints: ['trade date', 'activity date', 'transaction date', 'execution date', 'date/time', 'datetime', 'date', 'time', 'run date', 'process date', 'settlement date', 'datum', 'fecha', 'data', 'תאריך', 'תאריך ערך', 'handelstag', 'buchungstag', 'data operazione', 'data da operação', 'tarih', 'дата', '日付', '約定日', '取引日', '日期', '交易日期', '成交日期', 'dato', 'päivämäärä'],
  },
  {
    key: 'ticker', label: 'Ticker / symbol', required: true,
    hints: ['symbol', 'ticker', 'instrument', 'security', 'stock', 'asset', 'code', 'product', 'titre', 'valeur', 'wertpapier', 'name', 'שם הנייר', 'נייר', 'סימול', 'símbolo', 'simbolo', 'titolo', 'ativo', 'sembol', 'тикер', 'инструмент', '銘柄', '銘柄コード', '代码', '证券代码', '股票代码', 'walor', 'kod papieru'],
  },
  {
    key: 'action', label: 'Buy / sell / type',
    hints: ['action', 'side', 'buy/sell', 'transaction type', 'trans code', 'type', 'activity', 'direction', 'operation', 'order type', 'sens', 'typ', 'סוג פעולה', 'פעולה', 'סוג', 'tipo', 'operazione', 'transaktionstyp', 'buchungsart', 'typ transakcji', 'rodzaj', 'işlem türü', 'işlem', 'операция', 'тип операции', '取引', '売買区分', '取引区分', '操作', '买卖方向', '交易类型', 'transaksjonstype', 'tapahtuma'],
  },
  {
    key: 'quantity', label: 'Quantity',
    hints: ['quantity', 'qty', 'no. of shares', 'number of shares', 'shares', 'units', 'quantité', 'quantite', 'anzahl', 'stück', 'aantal', 'cantidad', 'volume', 'כמות', 'quantità', 'quantidade', 'menge', 'ilość', 'liczba', 'adet', 'miktar', 'количество', '数量', '株数', '股数', 'antall', 'antal', 'määrä', 'počet'],
  },
  {
    key: 'price', label: 'Price per share',
    hints: ['price per share', 'execution price', 'trade price', 'unit price', 'price', 'cours', 'kurs', 'koers', 'precio', 'prix', 'מחיר ממוצע', 'מחיר', 'שער', 'prezzo', 'preço', 'preco', 'cena', 'fiyat', 'цена', '価格', '単価', '约定价格', '成交价', '成交价格', '价格', 'pris', 'hinta'],
  },
  {
    key: 'amount', label: 'Total amount',
    hints: ['net amount', 'total amount', 'amount', 'total', 'net', 'value', 'proceeds', 'montant', 'betrag', 'waarde', 'totaal', 'importe', 'סכום הפעולה', 'סכום', 'תמורה', 'importo', 'controvalore', 'valor', 'montante', 'kwota', 'wartość', 'tutar', 'сумма', '金額', '受渡金額', '約定金額', '金额', '成交金额', 'beløp', 'belopp', 'beløb', 'summa', 'částka'],
  },
  {
    key: 'fees', label: 'Fees / commission',
    hints: ['commission', 'commissions', 'fees', 'fee', 'charges', 'costs', 'transactiekosten', 'kosten', 'frais', 'gebühren', 'gebuhren', 'comisión', 'עמלה', 'עמלות', 'commissione', 'commissioni', 'comissão', 'prowizja', 'komisyon', 'комиссия', '手数料', '手续费', 'kurtage', 'avgift', 'gebyr', 'palkkio', 'poplatek'],
  },
  {
    key: 'currency', label: 'Currency',
    hints: ['currency', 'ccy', 'devise', 'währung', 'waehrung', 'moneda', 'מטבע', 'valuta', 'moeda', 'divisa', 'waluta', 'para birimi', 'валюта', '通貨', '币种', '货币', 'měna'],
  },
  {
    /**
     * The account's cash after each row. Not needed to read a file, but where
     * a broker's amount column leaves the commission out, the balance is the
     * only record of the cash that really moved.
     */
    key: 'balance', label: 'Cash balance',
    hints: ['cash balance', 'running balance', 'balance', 'יתרת מזומן', 'יתרה', 'saldo', 'solde', 'kontostand', 'bakiye', 'остаток', '残高', '余额'],
  },
  {
    /**
     * Free text about the row. Read to tell what a row is when there is no type
     * column, and which way money went: many exports write every amount as
     * positive and say "Transfer to bank" or "Incoming wire" in words.
     */
    key: 'description', label: 'Description',
    hints: ['description', 'details', 'narrative', 'memo', 'comment', 'libellé', 'libelle', 'omschrijving', 'beschreibung', 'descripción', 'תיאור', 'פרטים', 'descrizione', 'descrição', 'opis', 'açıklama', 'описание', '摘要', '备注', '说明', 'beskrivelse', 'beskrivning', 'kuvaus'],
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
  const order = ['date', 'ticker', 'quantity', 'price', 'fees', 'amount', 'action', 'currency', 'balance', 'description'];
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

/**
 * Whether a table is riskbook's own portfolio export rather than a broker's file.
 *
 * It has a ticker, dates and amounts, so the automatic reader would take its
 * rows for trades — one position per row, invented purchases and sales across
 * every year it covers. It is a summary of a journal, not a history of one.
 */
export function isRiskbookExport(headers) {
  const set = new Set((headers ?? []).map((h) => String(h).trim().toLowerCase()));
  return ['ticker', 'status', 'open date', 'entry price', 'current or exit price'].every((h) => set.has(h));
}

/** Fields still needed before the file can be read. */
export function missingFields(mapping) {
  const need = FIELDS.filter((f) => f.required && !mapping?.[f.key]).map((f) => f.label);
  if (!mapping?.quantity && !mapping?.amount) need.push('Quantity or Total amount');
  return need;
}

/**
 * Every column a file can be read by, from its headers and, where a header is
 * worded in a way the hints do not know, from what is written in the column.
 *
 * Files are read with no questions asked, so a field must not go unmatched
 * when its values make plain what it is: a column of dates is the date, a
 * column of "Buy" and "Sell" the action, a column of short capitalised codes
 * the ticker, and a column of signed numbers the amount.
 */
export function readableMapping(table) {
  const headers = table?.headers ?? [];
  const rows = table?.rows ?? [];
  const mapping = guessMapping(headers);
  const used = new Set(Object.values(mapping));
  const valuesOf = (i) => rows.map((r) => String(r[i] ?? '').trim()).filter(Boolean);

  const claim = (key, testFor, threshold) => {
    if (mapping[key]) return;
    let best = -1;
    let bestShare = threshold;
    headers.forEach((header, i) => {
      if (used.has(header)) return;
      const list = valuesOf(i);
      if (!list.length) return;
      const test = testFor(list);
      const share = list.filter(test).length / list.length;
      if (share > bestShare || (share === bestShare && best < 0)) { bestShare = share; best = i; }
    });
    if (best >= 0) {
      mapping[key] = headers[best];
      used.add(headers[best]);
    }
  };
  const never = () => false;

  claim('date', (list) => {
    const order = detectDateOrder(list);
    return (v) => Boolean(parseDate(v, order));
  }, 0.8);
  claim('action', () => (v) => Boolean(classifyAction(v)), 0.5);
  // A column of one repeated code is a currency or an account, not the ticker.
  claim('ticker', (list) => (new Set(list).size > 1 || list.length < 3
    ? (v) => /^[A-Z][A-Z0-9]{0,5}([.-][A-Z0-9]{1,4})?$/.test(v)
    : never), 0.6);
  // A trade is costed from its price or its total; with neither named, the signed column is the total.
  if (!mapping.amount && !mapping.price) {
    claim('amount', (list) => (list.some((v) => /^\s*[-(]/.test(v)) ? looksNumeric : never), 0.8);
  }
  return mapping;
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
  // Hebrew has no \b in JavaScript's sense, so its words are matched whole by spaces.
  if (/split|פיצול|frazionamento|desdobramento/.test(t)) return 'split';
  // A dividend spent on shares: a purchase when it carries a quantity, which is
  // decided where the quantity is known.
  if (/reinvest|\bdrip\b/.test(t)) return 'reinvest';
  if (/dividend|dividende|dividendo|דיבידנד|\bcdiv\b|\bdiv\b|distribution|ausschüttung|dywidend|temettü|дивиденд|配当|股息|红利|紅利|utbytte|utdelning|udbytte|osinko/.test(t)) return 'dividend';
  if (/interest|intérêt|interet|\bzins|\bint\b|ריבית|interessi|juros|intereses|odsetki|faiz|процент|利息|ränta|korko/.test(t)) return 'interest';
  if (/withdraw|retrait|auszahlung|\bwdl\b|retiro|משיכה|prelievo|levantamento|saque|wypłat|para çekme|вывод|снятие|出金|提取|取出|uttak|uttag|udbetaling|nosto|výběr/.test(t)) return 'withdrawal';
  if (/deposit|dépôt|depot|depósito|deposito|einzahlung|funding|top.?up|\bdep\b|הפקדה|versamento|aporte|wpłat|para yatırma|пополнение|зачисление|入金|存入|innskudd|insättning|indbetaling|talletus|vklad/.test(t)) return 'deposit';
  if (/\bfee|commission|frais|gebühr|gebuhr|withholding|\btax|stamp duty|charge|עמלה|עמלות|\sמס\s|דמי |commission|comissão|comisión|steuer|impost|prowizj|opłat|podat|komisyon|vergi|комисси|налог|手数料|手续费|手續費|税|avgift|gebyr|kurtage|skatt|palkkio|poplatek/.test(t)) return 'fee';
  if (/\bsell|\bsold\b|\bsld\b|verkauf|vente|venta|venda|vendita|מכירה|\bstc\b|^\s*s\s*$|sprzeda|satış|продаж|売|卖|賣|salg|sälj|myynti|prodej/.test(t)) return 'sell';
  if (/\bbuy|\bbought\b|\bbot\b|kauf|achat|compra|acquisto|קנייה|קניה|purchase|\bbto\b|^\s*b\s*$|kupn|zakup|alış|покупк|купля|買|买|kjøp|köp|køb|osto|nákup/.test(t)) return 'buy';
  if (/transfer|journal|\bach\b|wire|virement|überweisung|העברה|bonifico|transferência|przelew|перевод|振替|转账|overføring|överföring|siirto|převod/.test(t)) return 'transfer';
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
  const balances = [];
  const skipped = [];
  const currencies = new Set();
  let repriced = 0;

  table.rows.forEach((row, index) => {
    const line = index + 1;
    const add = (t) => {
      const balance = number(row, 'balance');
      // Kept on the row: the file's own cash after it, which tells a real dip or a real repeat from a mistake.
      if (Number.isFinite(balance)) t.balance = balance;
      transactions.push(t);
      balances.push(balance);
    };
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
      add({ ...base, ticker, qty, price: unit, cash });
      return;
    }

    const value = amount ?? (rawQty != null && price != null ? rawQty * price : null);
    if (value == null || value === 0) {
      skipped.push({ line, reason: `a ${kind} with no amount` });
      return;
    }
    /**
     * A refund of tax or fees is money back, not another charge. Israeli
     * brokers settle capital-gains tax monthly and credit it back after a
     * losing month; forcing every "tax" row negative charged those twice.
     */
    const refund = kind === 'fee' && /refund|rebate|reversal|credit|reclaim|זיכוי|rimborso|reembolso|erstattung|remboursement|zwrot|iade|возврат|返金|退款|退税|refusjon|återbetalning|palautus/i.test(words);
    const cash = refund ? Math.abs(value)
      : kind === 'fee' || kind === 'withdrawal' ? -Math.abs(value)
      : kind === 'deposit' ? Math.abs(value)
        : value;
    add({ ...base, ticker: ticker || null, cash });
  });

  const rebalanced = settleFromBalance(transactions, balances);
  return { transactions, skipped, currencies: [...currencies], repriced, rebalanced };
}

/**
 * The cash each row really moved, from the file's running balance.
 *
 * Some brokers' amount column leaves the commission out — an Israeli report
 * writes a $500 purchase as -500 while its cash balance falls by 501.50 — and
 * read as written, the account comes out richer by every commission ever paid.
 * When the balance moves by exactly the amount on most rows, it is the file's
 * own record of the cash, and a row a few dollars off is taken at what the
 * balance says. A file listed newest first is read the other way round. A
 * balance that does not follow the amounts — several currencies in one column,
 * or the value of the whole account — is left alone.
 *
 * Returns how many rows were corrected.
 */
function settleFromBalance(transactions, balances) {
  const known = balances.map((b, i) => (Number.isFinite(b) ? i : -1)).filter((i) => i >= 0);
  if (known.length < 3) return 0;

  const movesWhen = (oldestFirst) => {
    const moves = new Map();
    for (let k = 1; k < known.length; k++) {
      const [before, row] = oldestFirst ? [known[k - 1], known[k]] : [known[k], known[k - 1]];
      moves.set(row, balances[row] - balances[before]);
    }
    return moves;
  };
  const agree = (moves) => [...moves].filter(([i, move]) => Math.abs(move - transactions[i].cash) <= 0.011).length;
  const forward = movesWhen(true);
  const backward = movesWhen(false);
  const oldestFirst = agree(forward) >= agree(backward);
  const moves = oldestFirst ? forward : backward;
  if (agree(moves) < moves.size * 0.5) return 0;

  let changed = 0;
  for (const [i, move] of moves) {
    const t = transactions[i];
    const gap = Math.abs(move - t.cash);
    /**
     * A row the balance moved by is one the file itself counted: two deposits
     * of $200 on one day that each raise the balance by $200 are two deposits,
     * not one listed twice.
     */
    if (gap <= 0.011) {
      t.balanceChecked = true;
      continue;
    }
    if (Math.sign(move) !== Math.sign(t.cash)) continue;
    if (gap > Math.min(25, 5 + 0.02 * Math.abs(t.cash))) continue;
    t.cash = Math.round(move * 100) / 100;
    t.balanceChecked = true;
    changed += 1;
  }

  /**
   * The balance also settles the order of rows on the same day. Without times
   * they were ordered by kind, buys ahead of the sales that paid for them, and
   * the cash went briefly negative on days it never did.
   */
  if (transactions.every((t) => t.at.endsWith(' 00:00:00'))) {
    const inTime = oldestFirst ? transactions : [...transactions].reverse();
    let day = '';
    let n = 0;
    for (const t of inTime) {
      n = t.date === day ? n + 1 : 0;
      day = t.date;
      t.at = `${t.date} 00:${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
    }
  }
  return changed;
}

/** A key for remembering how a broker's files are laid out. */
export function layoutKey(headers) {
  return headers.map(normalise).join('|');
}
