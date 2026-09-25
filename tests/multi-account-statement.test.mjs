/**
 * A statement covering two accounts, written one account at a time.
 *
 * Interactive Brokers exports a multi-account statement two ways. Consolidated,
 * it writes one net asset value block holding the sum. Per account, it repeats
 * the whole block once for each — and that second shape was read as though it
 * were the first.
 *
 * Positions were taken from every block and cash from only the first, so a book
 * of two accounts came out with one account's cash set against both accounts'
 * holdings: $42,802 where the broker said $47,702, with nothing in the file to
 * say which half had gone missing. Reported as "it shows me 43k and I am around
 * 47k".
 *
 * The figures here are the real ones from that file — accounts U16279720 and
 * U25235172 on 24 September 2026 — and they are checked against the totals the
 * broker itself printed at the bottom of each block.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseIbkrStatement } from '../src/features/ibkr.js';
import { statementRecord, journalFromStatements } from '../src/features/statementLibrary.js';
import { accountTotals } from '../src/core/portfolio.js';

/** One account's worth of net asset value, change in NAV, and holdings. */
const account = ({ id, cashPrior, cash, stockPrior, stockLong, stockShort, priorTotal, total, twr, deposits, holdings }) => [
  'Informations du compte,Header,Nom du champ,Valeur du champ',
  'Informations du compte,Data,Nom,Rom goldberg',
  `Informations du compte,Data,Compte,${id}`,
  'Informations du compte,Data,Devise de base,USD',
  "Actif net,Header,Classe d'actif,Total précédent,Actuel long,Actuel short,Total actuel,Variation",
  `Actif net,Data,Trésorerie,${cashPrior},${cash},0,${cash},0`,
  `Actif net,Data,Action,${stockPrior},${stockLong},${stockShort},${stockLong + stockShort},0`,
  `Actif net,Data,Total,${priorTotal},${cash + stockLong},${stockShort},${total},0`,
  'Actif net,Header,Taux de rendement pondéré en fonction du temps',
  `Actif net,Data,${twr}%`,
  "Changements de l'actif net,Header,Nom du champ,Valeur du champ",
  `Changements de l'actif net,Data,Valeur de départ,${priorTotal}`,
  `Changements de l'actif net,Data,Dépôts et retraits,${deposits}`,
  `Changements de l'actif net,Data,Valeur en fin de période,${total}`,
  'Positions ouvertes,Header,DataDiscriminator,Catégorie d\'actif,Devise,Symbole,Quantité,Mult,Prix de revient,Base de coût,Cours de clôture,Valeur,P/L non réalisé,Code',
  ...holdings,
].join('\n');

const HEAD = [
  'Statement,Header,Nom du champ,Valeur du champ',
  'Statement,Data,BrokerName,Interactive Brokers LLC',
  'Statement,Data,Title,Relevé d\'activité',
  'Statement,Data,Period,"1 janvier 2026 - 24 septembre 2026"',
].join('\n');

/** The two accounts as the broker wrote them, to the cent. */
const A = account({
  id: 'U16279720',
  cashPrior: 2678.16901, cash: 5502.146060595,
  stockPrior: 23687.78, stockLong: 6146.10, stockShort: 0,
  priorTotal: 26365.94901, total: 11648.246060595,
  twr: 38.486003962, deposits: 3500,
  holdings: ['Positions ouvertes,Data,Summary,Actions,USD,AMD,10,1,600,6000,614.61,6146.10,146.10,'],
});
const B = account({
  id: 'U25235172',
  cashPrior: 0, cash: 4900.962201403,
  stockPrior: 0, stockLong: 14152.00, stockShort: -1190.64,
  priorTotal: 0, total: 17862.322201403,
  twr: 31.207974837, deposits: 4997,
  holdings: [
    'Positions ouvertes,Data,Summary,Actions,USD,VOO,20,1,700,14000,707.6,14152.00,152.00,',
    'Positions ouvertes,Data,Summary,Actions,USD,USO,-8,1,158.58,-1268.64,148.83,-1190.64,78.00,',
  ],
});

const perAccount = `${HEAD}\n${A}\n${B}`;
const parsed = () => parseIbkrStatement(perAccount);

describe('the net asset value of every account, not the first', () => {
  test('cash is added up across the blocks', () => {
    // 5,502.146060595 + 4,900.962201403
    assert.ok(Math.abs(parsed().cash - 10_403.108261998) < 0.005, `${parsed().cash}`);
  });

  test('and so is the cash each account opened with', () => {
    assert.ok(Math.abs(parsed().openingCash - 2678.16901) < 0.005, 'the second account opened at nothing');
  });

  test('the change in net asset value is summed, not overwritten by the last block', () => {
    const { navChange } = parsed();
    assert.ok(Math.abs(navChange.startNav - 26_365.94901) < 0.005, `${navChange.startNav}`);
    assert.ok(Math.abs(navChange.endNav - 29_510.568261998) < 0.005, `${navChange.endNav}`);
    assert.equal(navChange.deposits, 8497, 'one account had 3,500 and the other 4,997');
  });

  test('and the account adds up to what the broker printed', () => {
    const journal = journalFromStatements([statementRecord(parsed())], {});
    const { account: total } = accountTotals(journal.positions, journal.cash);
    // $10,403.11 of cash across the two blocks, plus 6,146.10 + 14,152.00 − 1,190.64
    // of holdings. Counting only the first block leaves out the second
    // account's $4,900.96, which is the shape of the reported $42,802 vs $47,702.
    assert.ok(Math.abs(total - 29_510.568261998) < 0.02,
      `${total} — the second account's cash went missing`);
  });
});

describe("the broker's own return, when there are two of them", () => {
  test('is not reported at all, because neither describes the pair', () => {
    // 38.49% and 31.21%. Taking the first called the whole book 38.49%.
    assert.equal(parsed().twr, null);
  });

  test('so the year is measured from the daily walk instead', () => {
    const journal = journalFromStatements([statementRecord(parsed())], {});
    assert.equal(journal.statements[0].twr, null);
    assert.ok(journal.ledger.from, 'the walk still has somewhere to start');
  });

  test('a single-account statement still keeps its figure', () => {
    const one = `${HEAD}\n${A}`;
    assert.ok(Math.abs(parseIbkrStatement(one).twr - 38.486003962) < 1e-9);
    assert.ok(Math.abs(parseIbkrStatement(one).cash - 5502.146060595) < 0.005);
  });
});

describe('both accounts contribute their holdings', () => {
  test('every position is read, from whichever block it sat in', () => {
    const tickers = parsed().positions.map((p) => p.ticker).sort();
    assert.deepEqual(tickers, ['AMD', 'USO', 'VOO']);
  });

  test("the second account's short comes through as a short", () => {
    const uso = parsed().positions.find((p) => p.ticker === 'USO');
    assert.equal(uso.qty, -8, 'IBKR writes a short as a negative quantity');
  });
});
