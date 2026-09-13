/**
 * Reading an Interactive Brokers statement that was saved as HTML.
 *
 * IBKR's annual statements download as a web page rather than a CSV, but they
 * are the same statement: the same sections, the same columns, the same
 * figures, laid out as tables under a heading each. So rather than a second
 * parser that would have to be kept in step with the first, this turns the page
 * back into the rows the CSV parser already reads — `Section,Header,...` and
 * `Section,Data,...` — and hands it over. Every rule in ibkr.js then applies to
 * both formats, and so does every test of it.
 *
 * Plain string handling rather than the DOM, so it runs the same in the browser
 * and under the test runner. The markup is IBKR's own and regular: a heading
 * div carrying the section name, then that section's tables until the next
 * heading.
 *
 * Three places differ from the CSV and are bridged here:
 *
 *   group rows   "Stocks" and "USD" are rows of their own in a table, where the
 *                CSV repeats them as columns on every line. The asset class is
 *                what tells a share apart from the cash wearing a symbol, so it
 *                is put back as a column.
 *   headers      some tables stack two header rows — "Quantity" over "Prior |
 *                Current" — which the CSV writes as one name, "Prior Quantity".
 *   net value    the NAV block is two tables, one of balances with the broker's
 *                time-weighted return on a trailing row, one of changes, which
 *                the CSV writes as two sections.
 */

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x'
        ? parseInt(name.slice(2), 16)
        : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** The visible text of a fragment of markup, whitespace collapsed. */
function textOf(html) {
  return decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the content is an IBKR statement page rather than a CSV. */
export function looksLikeHtmlStatement(content) {
  return typeof content === 'string'
    && /<table[\s>]/i.test(content)
    && /activity statement/i.test(content);
}

/** One row's cells: text, how many columns it spans, and its class. */
function cellsOf(rowHtml) {
  return [...rowHtml.matchAll(/<(t[hd])\b([^>]*)>([\s\S]*?)<\/t[hd]>/gi)].map(([, , attrs, inner]) => ({
    text: textOf(inner),
    span: Math.max(1, Number(/colspan="(\d+)"/i.exec(attrs)?.[1]) || 1),
    cls: /class="([^"]*)"/i.exec(attrs)?.[1] ?? '',
  }));
}

/** A table split into its header rows and its body rows. */
function readTable(tableHtml) {
  const headEnd = tableHtml.search(/<\/thead>/i);
  const headHtml = headEnd >= 0 ? tableHtml.slice(0, headEnd) : '';
  const bodyHtml = headEnd >= 0 ? tableHtml.slice(headEnd) : tableHtml;
  const rows = (html) => [...html.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)].map(([, attrs, inner]) => ({
    cls: /class="([^"]*)"/i.exec(attrs)?.[1] ?? '',
    cells: cellsOf(inner),
  }));
  return { head: rows(headHtml), body: rows(bodyHtml) };
}

/** A row's cells laid out one per column, a spanning cell repeated across its span. */
function spread(cells) {
  const out = [];
  for (const cell of cells) {
    for (let i = 0; i < cell.span; i++) out.push(i === 0 ? cell.text : '');
  }
  return out;
}

/**
 * Column names for a table, stacked header rows folded into one.
 *
 * IBKR's CSV writes "Prior Quantity" where the page puts "Prior" under a
 * "Quantity" spanning two columns, and "Mark-to-Market P/L Position" where it
 * puts "Position" under that group. The parser looks columns up by those
 * names, so they are rebuilt exactly.
 */
function columnNames(head) {
  if (!head.length) return null;
  const last = head[head.length - 1].cells.map((c) => c.text);
  const groups = head.slice(0, -1).map((row) => {
    const labels = [];
    for (const cell of row.cells) {
      for (let i = 0; i < cell.span; i++) labels.push(cell.text);
    }
    return labels;
  });

  return last.map((sub, i) => {
    const group = groups.map((g) => g[i]).filter(Boolean).pop();
    if (!group) return sub;
    if (!sub) return group;
    return /^(prior|current)$/i.test(sub) ? `${sub} ${group}` : `${group} ${sub}`;
  });
}

/** A field as it would appear in IBKR's CSV. */
function csvField(value) {
  const s = String(value ?? '');
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Sections whose rows sit under an asset-class group row.
 *
 * Only these get the class put back as a column. The balance and income
 * tables have none, and several readers find their labels by position there.
 */
const GROUPED = new Set([
  'open positions', 'trades', 'mark-to-market performance summary',
  'corporate actions', 'transfers',
]);

/** The heading of every section, with where its content starts and ends. */
function sectionsOf(html) {
  const headings = [...html.matchAll(/<div\b[^>]*\bid="sec[^"]*Heading"[^>]*>([\s\S]*?)<\/div>/gi)];
  return headings.map((match, i) => ({
    // The heading carries help links beside its name — "Glossary" on some — and
    // those are not part of it. Left in, "Corporate Actions" read as
    // "Corporate Actions|Glossary", matched no section, and every split in the
    // file was silently lost.
    name: textOf(match[1]
      .replace(/<span\b[^>]*btn-group[^>]*>[\s\S]*?<\/span>/gi, '')
      .replace(/<a\b[\s\S]*?<\/a>/gi, ''))
      .replace(/\s*\|.*$/, ''),
    body: html.slice(match.index + match[0].length, headings[i + 1]?.index ?? html.length),
  }));
}

/** The statement's period as IBKR writes it, "January 1, 2025 - December 31, 2025". */
function periodOf(html) {
  const title = textOf(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
  const written = /(\p{L}+\s+\d{1,2},\s+\d{4}(?:\s+-\s+\p{L}+\s+\d{1,2},\s+\d{4})?)/u.exec(title);
  return written ? written[1] : '';
}

/**
 * The page as IBKR CSV text.
 *
 * Returns rows for the sections ibkr.js reads and passes the rest through too,
 * under their own names; the parser ignores sections it has no use for.
 */
export function htmlStatementToCsv(html) {
  const out = [];
  const emit = (section, kind, fields) => {
    out.push([section, kind, ...fields].map(csvField).join(','));
  };

  const period = periodOf(html);
  emit('Statement', 'Header', ['Field Name', 'Field Value']);
  emit('Statement', 'Data', ['Title', 'Activity Statement']);
  if (period) emit('Statement', 'Data', ['Period', period]);

  for (const { name, body } of sectionsOf(html)) {
    const tables = [...body.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map(([t]) => readTable(t));
    if (!tables.length) continue;
    const key = name.toLowerCase();

    if (key === 'account information') {
      emit(name, 'Header', ['Field Name', 'Field Value']);
      for (const table of tables) {
        for (const row of table.body) {
          const cells = row.cells.map((c) => c.text);
          if (cells.length >= 2 && cells[0]) emit(name, 'Data', [cells[0], cells[1]]);
        }
      }
      continue;
    }

    if (key === 'net asset value') {
      for (const table of tables) {
        const names = columnNames(table.head) ?? [];
        // The changes table names itself in its own header.
        if (/change in nav/i.test(names[0] ?? '')) {
          emit('Change in NAV', 'Header', ['Field Name', 'Field Value']);
          for (const row of table.body) {
            const cells = row.cells.map((c) => c.text).filter((t, i) => i < 2);
            if (cells[0]) emit('Change in NAV', 'Data', [cells[0], cells[1] ?? '']);
          }
          continue;
        }

        emit(name, 'Header', ['Asset Class', 'Prior Total', 'Current Long', 'Current Short', 'Current Total', 'Change']);
        for (const row of table.body) {
          const filled = row.cells.map((c) => c.text).filter(Boolean);
          if (!filled.length) continue;
          // The time-weighted return, alone on its row: the parser finds it by
          // exactly that shape, one field reading as a percentage.
          const rate = filled.find((t) => /^-?[\d.,]+\s*%$/.test(t));
          if (rate && filled.length <= 2) {
            emit(name, 'Data', [rate]);
            continue;
          }
          emit(name, 'Data', spread(row.cells));
        }
      }
      continue;
    }

    const grouped = GROUPED.has(key);
    let headerWritten = false;
    for (const table of tables) {
      const names = columnNames(table.head);
      if (!names) continue;
      if (!headerWritten) {
        emit(name, 'Header', grouped ? ['Asset Category', ...names] : names);
        headerWritten = true;
      }

      let asset = '';
      for (const row of table.body) {
        const first = row.cells[0];
        if (!first) continue;
        if (/header-asset/.test(first.cls)) { asset = first.text; continue; }
        if (/header-currency/.test(first.cls)) continue;
        const fields = spread(row.cells);
        if (!fields.some(Boolean)) continue;
        emit(name, 'Data', grouped ? [asset, ...fields] : fields);
      }
    }
  }

  return out.join('\n');
}
