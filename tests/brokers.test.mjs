/**
 * Import from your broker (November 2026): pick the broker, see how to get its
 * file, then the years — and the "Excel" files banks really send.
 *
 * The bank tables below are built here to test the reading of web pages,
 * Excel 2003 sheets and the Hebrew code page. They are not any bank's real
 * export: those still need checking against a real file.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { BROKERS, OTHER_BROKER, REGIONS, brokerById, matchBrokers } from '../src/config/brokers.js';
import { decodeText, sheetsFromMarkup } from '../src/features/sheetText.js';
import {
  tableFromSheets, readableMapping, missingFields, readTransactions, detectFormats,
} from '../src/features/genericCsv.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { brokerListHtml, brokerGuideHtml } = await import('../src/ui/views/brokerPicker.js');

describe('the brokers', () => {
  test('the big ones, around the world and in Israel, each with steps', () => {
    const names = BROKERS.map((b) => b.name);
    for (const n of ['Interactive Brokers', 'Robinhood', 'Charles Schwab', 'Fidelity', 'eToro', 'Trading 212',
      'Bank Leumi', 'Bank Hapoalim', 'Discount Bank', 'Mizrahi-Tefahot', 'IBI Trade', 'Meitav Trade']) {
      assert.ok(names.includes(n), n);
    }
    assert.equal(new Set(BROKERS.map((b) => b.id)).size, BROKERS.length);
    for (const b of [...BROKERS, OTHER_BROKER]) {
      assert.ok(b.steps.length >= 3 && b.mark && /^#[0-9a-f]{6}$/i.test(b.color), b.id);
      if (b !== OTHER_BROKER) assert.ok(REGIONS.some((r) => r.id === b.region), b.id);
    }
    // Israeli banks show their Hebrew name too.
    for (const b of BROKERS.filter((x) => x.region === 'israel')) assert.match(b.native, /[֐-׿]/, b.id);
  });

  test('search finds a broker by English, Hebrew or a piece of the name', () => {
    assert.deepEqual(matchBrokers('robin').map((b) => b.id), ['robinhood']);
    assert.ok(matchBrokers('לאומי').some((b) => b.id === 'leumi'));
    assert.ok(matchBrokers('E-Trade').some((b) => b.id === 'etrade'));
    assert.deepEqual(matchBrokers('interactive').map((b) => b.id), ['ibkr', 'interactive-israel']);
    assert.equal(matchBrokers('').length, BROKERS.length);
    assert.equal(brokerById('nope'), null);
    assert.equal(brokerById('other'), OTHER_BROKER);
  });

  test('Another broker is always offered, and an unknown name says so', () => {
    assert.match(brokerListHtml(''), /chooseBroker\('other'\)/);
    const none = brokerListHtml('zzz');
    assert.match(none, /No broker called “zzz”/);
    assert.match(none, /chooseBroker\('other'\)/);
    assert.match(brokerListHtml('<qq>'), /&lt;qq&gt;/);
  });

  test('a broker’s guide: its steps, then adding the file — one per year, or one for everything', () => {
    const ibkr = brokerGuideHtml(brokerById('ibkr'));
    assert.match(ibkr, /Get your file from Interactive Brokers/);
    assert.match(ibkr, /Performance &amp; Reports → Statements → Activity/);
    assert.match(ibkr, /Click the year your file covers/);
    assert.match(ibkr, /changeBroker\(\)/);
    assert.match(brokerGuideHtml(brokerById('leumi')), /One file with my whole history/);
  });
});

describe('the window', () => {
  const html = read('index.html');
  test('Settings: import first, deleting folded away, one Save and close', () => {
    const settings = html.slice(html.indexOf('id="settingsModal"'), html.indexOf('id="yearsModal"'));
    assert.ok(settings.indexOf('Import from your broker') < settings.indexOf('Live prices'));
    assert.match(settings, /<details class="set-card danger-zone">/);
    assert.match(settings, /onclick="saveAndQuit\(\)">Save and close/);
    assert.doesNotMatch(settings, /saveApiKey/);
  });

  test('Import: the broker list first, then its steps and the years, and the whole-history file stays', () => {
    const years = html.slice(html.indexOf('id="yearsModal"'), html.indexOf('id="importModal"'));
    assert.ok(years.indexOf('id="importPick"') < years.indexOf('id="importGuide"'));
    assert.match(years, /id="brokerSearch"/);
    assert.match(years, /chooseWholeHistory\(\)/);
    assert.match(years, /id="yearsGrid"/);
    assert.match(years, /toggleEarlierYears\(\)/);
  });

  test('the broker is kept with the sign-in', () => {
    const store = read('src/core/store.js');
    assert.match(store, /broker: null/);
    assert.match(store, /state\.broker = typeof source\.broker === 'string'/);
    assert.match(store, /broker: state\.broker/);
  });
});

/** Text as the old Hebrew code page would store it. */
function windows1255(text) {
  return Uint8Array.from([...text].map((ch) => {
    const c = ch.codePointAt(0);
    if (c >= 0x05d0 && c <= 0x05ea) return 0xe0 + (c - 0x05d0);
    if (c < 0x80) return c;
    throw new Error(`not in the test's code page: ${ch}`);
  }));
}

describe('the files banks really send', () => {
  test('UTF-8 stays UTF-8, and Hebrew in the old code page is read as Hebrew', () => {
    assert.equal(decodeText(new TextEncoder().encode('תאריך,כמות')), 'תאריך,כמות');
    assert.equal(decodeText(windows1255('תאריך,שם נייר,כמות')), 'תאריך,שם נייר,כמות');
    // Accented Latin letters standing alone are Western European, not Hebrew.
    assert.equal(decodeText(Uint8Array.from([0x44, 0x61, 0x74, 0x65, 0x3b, 0x50, 0x72, 0x69, 0x78, 0x20, 0x70, 0x61, 0x79, 0xe9])), 'Date;Prix payé');
  });

  test('"Export to Excel" that is really a web page: the table inside is read', () => {
    const page = `<html><head><meta charset="windows-1255"></head><body>
      <table><tr><td><table>
        <tr><th>תאריך</th><th>שם נייר</th><th>סוג פעולה</th><th>כמות</th><th>שער</th><th>תמורה</th></tr>
        <tr><td>05/03/2026</td><td>AAPL</td><td>קנייה</td><td>10</td><td>210.50</td><td>-2,105.00</td></tr>
        <tr><td>12/04/2026</td><td>AAPL</td><td>מכירה</td><td>4</td><td>225.00</td><td>900.00</td></tr>
      </table></td></tr></table></body></html>`;
    const table = tableFromSheets(sheetsFromMarkup(page));
    assert.deepEqual(table.headers, ['תאריך', 'שם נייר', 'סוג פעולה', 'כמות', 'שער', 'תמורה']);
    assert.equal(table.rows.length, 2);
    assert.deepEqual(missingFields(readableMapping(table)), []);
    // Israel writes the day first: 05/03 is the fifth of March, never the third of May.
    const { transactions } = readTransactions(table, readableMapping(table));
    assert.deepEqual(transactions.map((t) => t.date), ['2026-03-05', '2026-04-12']);
  });

  test('an English file with nothing to tell the order by keeps reading slashes month first', () => {
    assert.equal(detectFormats({ headers: ['Date', 'Symbol', 'Quantity'], rows: [['05/03/2026', 'AAPL', '1']] }, { date: 'Date' }).dateOrder, 'mdy');
  });

  test('an Excel 2003 XML sheet named .xls is read, skipped cells included', () => {
    const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
      <Worksheet ss:Name="Transactions"><Table>
        <Row><Cell><Data ss:Type="String">Date</Data></Cell><Cell><Data ss:Type="String">Symbol</Data></Cell><Cell><Data ss:Type="String">Action</Data></Cell><Cell><Data ss:Type="String">Quantity</Data></Cell><Cell><Data ss:Type="String">Price</Data></Cell></Row>
        <Row><Cell><Data ss:Type="String">2026-03-05</Data></Cell><Cell><Data ss:Type="String">MSFT</Data></Cell><Cell><Data ss:Type="String">Buy</Data></Cell><Cell ss:Index="5"><Data ss:Type="Number">410</Data></Cell></Row>
      </Table></Worksheet></Workbook>`;
    const [sheet] = sheetsFromMarkup(xml);
    assert.equal(sheet.name, 'Transactions');
    assert.deepEqual(sheet.rows[1], ['2026-03-05', 'MSFT', 'Buy', '', '410']);
  });

  test('a plain CSV is not mistaken for a page', () => {
    assert.equal(sheetsFromMarkup('Date,Symbol,Quantity\n2026-01-02,AAPL,3'), null);
  });
});
