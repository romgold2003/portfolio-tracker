/**
 * Excel files, uploaded as they come from the bank.
 *
 * Many banks and brokers export only .xlsx. The workbook is read without a
 * library, and what matters is what a person would see in Excel: text, numbers,
 * and dates as dates — Excel stores 6 March 2025 as 45722 and only the cell's
 * format says otherwise.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';

import { readWorkbook, isZip, isOldExcel, readZipEntries } from '../src/features/xlsx.js';
import {
  tableFromSheets, readableMapping, readTransactions, detectFormats, missingFields, isRiskbookExport,
} from '../src/features/genericCsv.js';

/** A zip archive of text files, compressed as Excel does. */
function zip(entries) {
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = Buffer.from(enc.encode(name));
    const raw = enc.encode(content);
    const data = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

const cellsXml = (rows) => rows.map((cells, r) => `<row r="${r + 1}">${cells.join('')}</row>`).join('');

/**
 * A bank's workbook, shaped like the Israeli report it was built for: a sheet of
 * balances first, then the movements under a title line, with Hebrew headers in
 * shared strings, dates stored as day numbers in a "d.m.yyyy" format, and one
 * cell written inline.
 */
function bankWorkbook() {
  const strings = ['פירוט תנועות', 'תאריך', 'סוג פעולה', 'שם הנייר', 'כמות', 'מחיר ממוצע', 'סכום הפעולה', 'יתרת מזומן', 'הפקדה', 'קנייה', 'IVV', 'שם הנייר', 'שווי', 'יתרות'];
  const s = (i, ref) => `<c r="${ref}" t="s"><v>${i}</v></c>`;
  const n = (v, ref, style) => `<c r="${ref}"${style != null ? ` s="${style}"` : ''}><v>${v}</v></c>`;
  const movements = cellsXml([
    [s(0, 'B1')],
    [s(1, 'B2'), s(2, 'C2'), s(3, 'D2'), s(4, 'E2'), s(5, 'F2'), s(6, 'G2'), s(7, 'H2')],
    [n(45722, 'B3', 1), s(8, 'C3'), n(500, 'G3'), n(500, 'H3')],
    [n(45722, 'B4', 1), s(9, 'C4'), s(10, 'D4'), n(0.4323, 'E4'), n(578.25, 'F4'), n(-249.98, 'G4'), n(250.02, 'H4')],
    [n(45723, 'B5', 1), `<c r="C5" t="inlineStr"><is><t>קנייה</t></is></c>`, `<c r="D5" t="inlineStr"><is><t>SPY</t></is></c>`, n(0.4343, 'E5'), n(575.51, 'F5'), n(-249.94, 'G5'), n(0.08, 'H5')],
  ]);
  const balances = cellsXml([
    [s(13, 'A1')],
    [s(11, 'A2'), s(12, 'B2')],
    [s(10, 'A3'), n(290, 'B3')],
  ]);
  return zip({
    '[Content_Types].xml': '<Types/>',
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="יתרות" sheetId="1" r:id="rId1"/><sheet name="תנועות" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<sst>${strings.map((t) => `<si><t>${t}</t></si>`).join('')}</sst>`,
    'xl/styles.xml': '<styleSheet><numFmts count="1"><numFmt formatCode="[$-409]d.m.yyyy" numFmtId="169"/></numFmts>'
      + '<cellXfs count="2"><xf fontId="0"/><xf applyNumberFormat="1" fontId="0" numFmtId="169"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${balances}</sheetData></worksheet>`,
    'xl/worksheets/sheet2.xml': `<worksheet><sheetData>${movements}</sheetData></worksheet>`,
  });
}

describe('an Excel workbook', () => {
  test('is told apart from a CSV and from an old .xls', () => {
    assert.equal(isZip(bankWorkbook()), true);
    assert.equal(isZip(new TextEncoder().encode('Date,Symbol\n')), false);
    assert.equal(isOldExcel(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0])), true);
  });

  test('reads every sheet, with dates as dates and text from shared and inline strings', async () => {
    const sheets = await readWorkbook(bankWorkbook());
    assert.deepEqual(sheets.map((x) => x.name), ['יתרות', 'תנועות']);
    const rows = sheets[1].rows;
    assert.deepEqual(rows[2], ['', '2025-03-06', 'הפקדה', '', '', '', '500', '500']);
    assert.deepEqual(rows[4].slice(1, 4), ['2025-03-07', 'קנייה', 'SPY']);
  });

  test('the movements are picked over the sheet of balances, and read as transactions', async () => {
    const table = tableFromSheets(await readWorkbook(bankWorkbook()));
    const mapping = readableMapping(table);
    assert.deepEqual(missingFields(mapping), []);
    const { transactions, skipped } = readTransactions(table, mapping, detectFormats(table, mapping));
    assert.equal(skipped.length, 0);
    assert.deepEqual(transactions.map((t) => [t.date, t.kind, t.ticker ?? null, t.cash]), [
      ['2025-03-06', 'deposit', null, 500],
      ['2025-03-06', 'buy', 'IVV', -249.98],
      ['2025-03-07', 'buy', 'SPY', -249.94],
    ]);
  });
});

describe('a zip that is not a workbook', () => {
  /**
   * Interactive Brokers sends annual statements as a zip of HTML pages, and a
   * real one was left unimported because the app only opened zips as Excel.
   */
  test('hands back the files inside it', async () => {
    const archive = zip({
      'U16279720.2025.html': '<html><body>statement</body></html>',
      'readme.pdf': '%PDF-1.4',
    });
    const entries = await readZipEntries(archive);
    assert.deepEqual([...entries.keys()].sort(), ['U16279720.2025.html', 'readme.pdf']);
    assert.equal(new TextDecoder().decode(entries.get('U16279720.2025.html')), '<html><body>statement</body></html>');
    assert.equal(entries.has('xl/workbook.xml'), false);
  });
});

describe("riskbook's own portfolio export", () => {
  test('is recognised, so it is not read as trades', () => {
    assert.equal(isRiskbookExport(['Ticker', 'Asset class', 'Direction', 'Status', 'Open date', 'Close date', 'Quantity',
      'Entry price', 'Current or exit price', 'Cost', 'Market value', 'Unrealised P&L', 'Realised P&L', 'Return %']), true);
  });

  test('while a broker history is not', () => {
    assert.equal(isRiskbookExport(['Date', 'Action', 'Symbol', 'Quantity', 'Price', 'Amount', 'Fees', 'Currency']), false);
  });
});
