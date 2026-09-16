/**
 * Statements and histories in any language.
 *
 * Asked for directly: the app must read a file whatever language it is in. An
 * Interactive Brokers statement names its sections and columns in the account's
 * language, and only English and French were known — anything else read as
 * nothing. The statement below is in German, a language the reader has no names
 * for, and every figure is expected from it all the same.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { isIbkrStatement, parseIbkrStatement, statementToJournal } from '../src/features/ibkr.js';
import {
  parseCsvTable, readableMapping, missingFields, readTransactions, detectFormats,
} from '../src/features/genericCsv.js';
import { accountTotals } from '../src/core/portfolio.js';

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const german = [
  'Statement,Header,Feldname,Feldwert',
  'Statement,Data,BrokerName,Interactive Brokers LLC',
  'Statement,Data,Period,"Januar 1, 2026 - September 15, 2026"',
  'Kontoinformationen,Header,Feldname,Feldwert',
  'Kontoinformationen,Data,Name,Test Person',
  'Nettoinventarwert,Header,Anlageklasse,Vorheriger Gesamtwert,Aktuell Long,Aktuell Short,Aktuell gesamt,Veränderung',
  'Nettoinventarwert,Data,Barmittel,2000,5000,0,5000,3000',
  'Nettoinventarwert,Data,Aktien,10000,18000,-1294.88,16705.12,6705.12',
  'Nettoinventarwert,Data,Gesamt,12000,23000,-1294.88,21705.12,9705.12',
  'Nettoinventarwert,Header,Zeitgewichtete Rendite',
  'Nettoinventarwert,Data,12.5%',
  'Veränderung des NAV,Header,Feldname,Feldwert',
  'Veränderung des NAV,Data,Anfangswert,12000',
  'Veränderung des NAV,Data,Einzahlungen und Auszahlungen,1500',
  'Veränderung des NAV,Data,Endwert,21705.12',
  'MTM-Performance-Übersicht,Header,Anlagekategorie,Symbol,Vorherige Menge,Aktuelle Menge,Vorheriger Kurs,'
    + 'Aktueller Kurs,MTM G/V Position,MTM G/V Transaktion,MTM G/V Provisionen,MTM G/V Sonstiges,MTM G/V Gesamt,Code',
  'MTM-Performance-Übersicht,Data,Aktien,AAA,100,120,100,150,5000,0,0,0,5000,',
  'MTM-Performance-Übersicht,Data,Forex,USD,2000,5000,1.0000,1.0000,0,0,0,0,0,',
  'MTM-Performance-Übersicht,Data,Gesamt,,,,,,5000,0,0,0,5000,',
  'Offene Positionen,Header,DataDiscriminator,Anlagekategorie,Währung,Symbol,Menge,Mult,Einstandspreis,'
    + 'Einstandswert,Schlusskurs,Wert,Unrealisierter G/V,Code',
  'Offene Positionen,Data,Summary,Aktien,USD,AAA,120,1,105,12600,150,18000,5400,',
  'Offene Positionen,Data,Summary,Aktien,USD,USO,-8,1,158.58,-1268.64,161.86,-1294.88,-26.24,',
  'Transaktionen,Header,DataDiscriminator,Anlagekategorie,Währung,Konto,Symbol,Datum/Zeit,Menge,T.-Kurs,'
    + 'Schlusskurs,Erlös,Provision/Gebühr,Basis,Realisierter G/V,MTM G/V,Code',
  'Transaktionen,Data,Order,Aktien,USD,U1,AAA,"2026-03-02, 10:00:00",20,120,120,-2400,-1,2401,0,0,O',
  'Transaktionen,Data,Order,Aktien,USD,U1,BBB,"2026-05-04, 11:00:00",-10,60,60,600,-1,-500,99,0,C',
  'Einzahlungen & Auszahlungen,Header,Währung,Konto,Abrechnungsdatum,Beschreibung,Betrag',
  'Einzahlungen & Auszahlungen,Data,USD,U1,2026-02-10,Elektronische Überweisung,1500',
  'Einzahlungen & Auszahlungen,Data,Gesamt,,,,1500',
  'Dividenden,Header,Währung,Konto,Datum,Beschreibung,Betrag',
  'Dividenden,Data,USD,U1,2026-04-01,AAA(US0000000001) Bardividende USD 0.33 pro Aktie,40',
  'Quellensteuer,Header,Währung,Konto,Datum,Beschreibung,Betrag,Code',
  'Quellensteuer,Data,USD,U1,2026-04-01,AAA(US0000000001) Bardividende - US Steuer,-6,',
  'Zinsen,Header,Währung,Konto,Datum,Beschreibung,Betrag',
  'Zinsen,Data,USD,U1,2026-08-05,USD Sollzinsen für Jul-2026,-0.79',
].join('\n');

describe('an IBKR statement in a language the reader has no names for', () => {
  const parsed = () => parseIbkrStatement(german);

  test('is recognised as a statement', () => {
    assert.equal(isIbkrStatement(german), true);
  });

  test('its period, cash, opening cash and the broker\'s own return', () => {
    const p = parsed();
    assert.deepEqual([p.periodStart, p.periodEnd], ['2026-01-01', '2026-09-15']);
    assert.equal(p.cash, 5000);
    assert.equal(p.openingCash, 2000);
    assert.equal(p.twr, 12.5);
    assert.equal(p.navChange.startNav, 12000);
    assert.equal(p.navChange.endNav, 21705.12);
  });

  test('its open positions, the short included', () => {
    const positions = parsed().positions.map((q) => `${q.ticker}:${q.qty}@${q.entry}/${q.cur}`).sort();
    assert.deepEqual(positions, ['AAA:120@105/150', 'USO:-8@158.58/161.86']);
  });

  test('what it held when the period opened, without the cash line', () => {
    assert.deepEqual(parsed().openingHoldings, { AAA: 100 });
  });

  test('its trades, and the one that closed with its profit', () => {
    const p = parsed();
    assert.equal(p.ledger.length, 2);
    assert.equal(p.closed.length, 1);
    assert.equal(p.closed[0].ticker, 'BBB');
    assert.equal(p.closed[0].pnl, 99);
  });

  test('its deposit, dividend, withholding tax and interest, each in its place', () => {
    const p = parsed();
    assert.deepEqual(p.flows.map((f) => [f.date, f.amount]), [['2026-02-10', 1500]]);
    const dated = p.dated.map((d) => [d.kind, d.date, d.cash]).sort();
    assert.deepEqual(dated, [
      ['dividend', '2026-04-01', 40],
      ['interest', '2026-08-05', -0.79],
      ['tax', '2026-04-01', -6],
    ]);
  });

  test('and the account adds up to the statement\'s net asset value', () => {
    const journal = statementToJournal(parsed());
    assert.ok(near(accountTotals(journal.positions, journal.cash).account, 21705.12, 0.005));
  });
});

describe('the statement period in other languages', () => {
  const withPeriod = (period) => parseIbkrStatement([
    'Statement,Header,Field Name,Field Value',
    `Statement,Data,Period,"${period}"`,
    'Open positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code',
    'Open positions,Data,Summary,Stocks,USD,AAA,1,1,10,10,10,10,0,',
  ].join('\n'));
  const periodOf = (period) => { const p = withPeriod(period); return [p.periodStart, p.periodEnd]; };

  test('month first, as IBKR writes it, in several languages', () => {
    assert.deepEqual(periodOf('Enero 1, 2026 - Septiembre 15, 2026'), ['2026-01-01', '2026-09-15']);
    assert.deepEqual(periodOf('Январь 1, 2026 - Сентябрь 15, 2026'), ['2026-01-01', '2026-09-15']);
    assert.deepEqual(periodOf('Gennaio 1, 2026 - Settembre 15, 2026'), ['2026-01-01', '2026-09-15']);
  });

  test('day first', () => {
    assert.deepEqual(periodOf('1 de enero de 2026 - 15 de septiembre de 2026'), ['2026-01-01', '2026-09-15']);
    assert.deepEqual(periodOf('15. März 2026'), ['2026-03-15', '2026-03-15']);
  });

  test('with no month names at all', () => {
    assert.deepEqual(periodOf('2026年1月1日 - 2026年9月15日'), ['2026-01-01', '2026-09-15']);
    assert.deepEqual(periodOf('2026년 1월 1일 - 2026년 9월 15일'), ['2026-01-01', '2026-09-15']);
  });
});

describe("another broker's history in other languages", () => {
  const read = (lines) => {
    const table = parseCsvTable(lines.join('\n'));
    const mapping = readableMapping(table);
    return { missing: missingFields(mapping), ...readTransactions(table, mapping, detectFormats(table, mapping)) };
  };

  test('Japanese', () => {
    const r = read([
      '約定日,銘柄コード,取引,数量,単価,受渡金額',
      '2026/03/02,7203,入金,,,300000',
      '2026/03/03,7203,買付,100,2500,-250000',
      '2026/06/01,7203,売付,100,2800,280000',
    ]);
    assert.deepEqual(r.missing, []);
    assert.deepEqual(r.transactions.map((t) => t.kind), ['deposit', 'buy', 'sell']);
  });

  test('Russian', () => {
    const r = read([
      'Дата,Тикер,Операция,Количество,Цена,Сумма',
      '2026-03-02,SBER,Пополнение,,,1000',
      '2026-03-03,SBER,Покупка,10,50,-500',
      '2026-04-10,SBER,Дивиденды,,,12',
      '2026-06-01,SBER,Продажа,10,60,600',
    ]);
    assert.deepEqual(r.missing, []);
    assert.deepEqual(r.transactions.map((t) => t.kind), ['deposit', 'buy', 'dividend', 'sell']);
  });

  test('Polish', () => {
    const r = read([
      'Data,Walor,Typ transakcji,Ilość,Cena,Kwota',
      '2026-03-02,PKO,Wpłata,,,5000',
      '2026-03-03,PKO,Kupno,100,40,-4000',
      '2026-06-01,PKO,Sprzedaż,100,45,4500',
    ]);
    assert.deepEqual(r.missing, []);
    assert.deepEqual(r.transactions.map((t) => t.kind), ['deposit', 'buy', 'sell']);
  });
});
