/**
 * The "Excel" files that are not really Excel, and the text that is not UTF-8.
 *
 * Many banks — the Israeli ones above all — offer "Export to Excel" and send a
 * web page with a table in it, or an Excel 2003 XML sheet, named .xls. Excel
 * opens both without a word, so nobody downloading one knows. And their CSVs
 * and pages are often written in Windows-1255, the old Hebrew code page, which
 * read as UTF-8 turns every Hebrew column name into question marks — and a
 * column nobody can name is a column nobody can read.
 *
 * Pure: no DOM, no storage. Runs the same in the browser and the tests.
 */

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

const textOf = (html) => decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ''))
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Bytes to text: UTF-8 when they are UTF-8, otherwise the old Windows code page
 * they were written in — Hebrew when the page says so or its letters run
 * together in words, Western European when they stand alone among Latin ones.
 */
export function decodeText(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le').decode(data.subarray(2));
  if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder('utf-16be').decode(data.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch { /* an old code page */ }
  const head = new TextDecoder('latin1').decode(data.subarray(0, 4096));
  const declared = /charset=["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase();
  let label = declared && declared !== 'utf-8' ? declared : null;
  if (!label) {
    let runs = 0;
    let lone = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] < 0x80) continue;
      if ((data[i - 1] ?? 0) >= 0x80 || (data[i + 1] ?? 0) >= 0x80) runs++;
      else lone++;
    }
    label = runs > lone ? 'windows-1255' : 'windows-1252';
  }
  try {
    return new TextDecoder(label).decode(data);
  } catch {
    return new TextDecoder('windows-1252').decode(data);
  }
}

/** One HTML table as rows of cell text, a spanning cell followed by blanks. */
function htmlTableRows(tableHtml) {
  return [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(([, inner]) => {
    const row = [];
    for (const [, attrs, cell] of inner.matchAll(/<t[hd]\b([^>]*)>([\s\S]*?)<\/t[hd]>/gi)) {
      row.push(textOf(cell));
      const span = Math.max(1, Number(/colspan=["']?(\d+)/i.exec(attrs)?.[1]) || 1);
      for (let k = 1; k < span; k++) row.push('');
    }
    return row;
  });
}

/** An Excel 2003 XML worksheet as rows, honouring ss:Index for skipped cells. */
function spreadsheetMlRows(sheetXml) {
  return [...sheetXml.matchAll(/<(?:ss:)?Row\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:ss:)?Row>)/gi)].map(([, inner = '']) => {
    const row = [];
    for (const [, attrs, body = ''] of inner.matchAll(/<(?:ss:)?Cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ss:)?Cell>)/gi)) {
      const index = Number(/(?:ss:)?Index=["'](\d+)/i.exec(attrs)?.[1]);
      while (index && row.length < index - 1) row.push('');
      const data = /<(?:ss:)?Data\b[^>]*>([\s\S]*?)<\/(?:ss:)?Data>/i.exec(body)?.[1] ?? '';
      row.push(textOf(data));
    }
    return row;
  });
}

/**
 * The sheets in a web page or an Excel 2003 XML file, as { name, rows } — or
 * null when the text is neither, and is read as CSV instead.
 */
export function sheetsFromMarkup(text) {
  const s = String(text ?? '');
  if (/<Workbook\b/i.test(s) && /urn:schemas-microsoft-com:office:spreadsheet/i.test(s)) {
    const sheets = [...s.matchAll(/<(?:ss:)?Worksheet\b([^>]*)>([\s\S]*?)<\/(?:ss:)?Worksheet>/gi)]
      .map(([, attrs, body]) => ({ name: /Name=["']([^"']*)/i.exec(attrs)?.[1] ?? '', rows: spreadsheetMlRows(body) }));
    return sheets.length ? sheets : null;
  }
  if (/<table[\s>]/i.test(s)) {
    // Innermost tables only: a page laid out with tables wraps the real one in others.
    const tables = [...s.matchAll(/<table\b[^>]*>((?:(?!<table\b)[\s\S])*?)<\/table>/gi)]
      .map(([, inner], i) => ({ name: `Table ${i + 1}`, rows: htmlTableRows(inner) }))
      .filter((t) => t.rows.length);
    return tables.length ? tables : null;
  }
  return null;
}
