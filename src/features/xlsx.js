/**
 * Reading an Excel workbook (.xlsx) as plain rows of text.
 *
 * Many banks and brokers export only Excel. An .xlsx is a zip of XML files, and
 * browsers can inflate zip entries themselves (DecompressionStream), so the
 * workbook is read here with no library: each sheet becomes rows of cell text,
 * dates written as YYYY-MM-DD, ready for the same reader as a CSV.
 *
 * Needs only DecompressionStream, Blob and Response, which browsers and Node
 * 18+ both have.
 */

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;

/** Whether the bytes are a zip archive, which every .xlsx is. */
export function isZip(bytes) {
  return bytes?.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;
}

/** Whether the bytes are an old binary Excel file (.xls), which this cannot read. */
export function isOldExcel(bytes) {
  return bytes?.length > 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

async function inflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The files in a zip archive, by name, as bytes. */
async function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
    if (view.getUint32(i, true) === END) { end = i; break; }
  }
  if (end < 0) throw new Error('not a readable Excel file');

  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== CENTRAL) break;
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    if (view.getUint32(offset, true) !== LOCAL) continue;
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    const raw = bytes.subarray(start, start + size);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, await inflate(raw));
  }
  return files;
}

const ENTITIES = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
const unescapeXml = (s) => String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|lt|gt|quot|apos|amp);/gi, (_, e) => {
  if (e[0] !== '#') return ENTITIES[e.toLowerCase()];
  return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
});

/** The text of a string item, across its rich-text runs, leaving out phonetic hints. */
const textOf = (xml) => unescapeXml(
  [...String(xml).replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map((m) => m[1]).join(''),
);

/** Excel's own number formats that are dates. */
const BUILTIN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

/**
 * Which cell styles show a date.
 *
 * Excel stores a date as a number of days and only the cell's format says it is
 * one; read without it, 6 March 2025 is 45722.
 */
function dateStyles(stylesXml) {
  const custom = new Map([...stylesXml.matchAll(/<numFmt\s[^>]*>/g)].map((m) => [
    Number(/numFmtId="(\d+)"/.exec(m[0])?.[1]),
    unescapeXml(/formatCode="([^"]*)"/.exec(m[0])?.[1] ?? ''),
  ]));
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? '';
  return [...xfs.matchAll(/<xf\s[^>]*>/g)].map((m) => {
    const id = Number(/numFmtId="(\d+)"/.exec(m[0])?.[1] ?? 0);
    if (BUILTIN_DATES.has(id)) return true;
    const code = custom.get(id);
    // Days or years outside brackets and quotes; "m" alone may be minutes.
    return Boolean(code) && /[dy]/i.test(code.replace(/\[[^\]]*\]|"[^"]*"|\\./g, ''));
  });
}

/** An Excel day number as YYYY-MM-DD, with the time when it has one. */
function serialDate(serial) {
  const iso = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400) * 1000).toISOString();
  return serial % 1 ? `${iso.slice(0, 10)} ${iso.slice(11, 19)}` : iso.slice(0, 10);
}

const columnIndex = (letters) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

function sheetRows(xml, shared, isDate, dayOffset) {
  const rows = [];
  for (const row of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const number = Number(/\br="(\d+)"/.exec(row[1])?.[1]) || rows.length + 1;
    const cells = [];
    let next = 0;
    for (const c of (row[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const letters = /\br="([A-Z]+)\d*"/.exec(c[1])?.[1];
      const col = letters ? columnIndex(letters) : next;
      next = col + 1;
      const type = /\bt="(\w+)"/.exec(c[1])?.[1];
      const style = Number(/\bs="(\d+)"/.exec(c[1])?.[1] ?? 0);
      const body = c[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = textOf(body);
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (v != null) value = unescapeXml(v);
      if (value && (!type || type === 'n') && isDate[style] && Number.isFinite(Number(value))) {
        value = serialDate(Number(value) + dayOffset);
      }
      cells[col] = value;
    }
    while (rows.length < number - 1) rows.push([]);
    rows.push(Array.from(cells, (x) => x ?? ''));
  }
  return rows;
}

/** Every sheet in a workbook, as { name, rows } with each row an array of cell text. */
export async function readWorkbook(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const files = await unzip(bytes);
  const decoder = new TextDecoder();
  const text = (name) => (files.has(name) ? decoder.decode(files.get(name)) : '');

  const workbook = text('xl/workbook.xml');
  if (!workbook) throw new Error('not an Excel workbook');
  const targets = new Map([...text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\s[^>]*>/g)]
    .map((m) => [/\bId="([^"]+)"/.exec(m[0])?.[1], /\bTarget="([^"]+)"/.exec(m[0])?.[1] ?? '']));
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const isDate = dateStyles(text('xl/styles.xml'));
  // Workbooks from old Macs count days from 1904.
  const dayOffset = /date1904="(1|true)"/.test(workbook) ? 1462 : 0;

  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\s[^>]*>/g)) {
    const name = unescapeXml(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? '');
    const target = targets.get(/\s(?:\w+:)?id="([^"]+)"/.exec(m[0])?.[1]) ?? '';
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const xml = text(path);
    if (xml) sheets.push({ name, rows: sheetRows(xml, shared, isDate, dayOffset) });
  }
  return sheets;
}
