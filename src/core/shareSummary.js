/**
 * What friends see of a book (October 2026), as its owner chose in their
 * profile: each holding as a share of the account ('percent'), or that and the
 * dollars too ('amount') — what each holding is worth now and what was put
 * into it, the cash and the account's total. 'none' sends nothing at all.
 *
 * Worked out on the owner's device, because the journal is encrypted and the
 * server cannot read it; this summary is the one thing about a book that
 * leaves it. The weights are the allocation pie's, by holding: longs less
 * shorts, plus cash, adding up to the account value — a short shows as a
 * negative weight.
 */
import { posValue, costOf } from './portfolio.js';

export function shareSummary({ positions = [], cash = 0 } = {}, mode = 'percent') {
  const amounts = mode === 'amount';
  const by = new Map();
  for (const p of positions) {
    if (p?.status !== 'Open' || !(Number(p.qty) > 0) || !(Number(p.cur) > 0)) continue;
    // One line per holding and direction, however many sub-accounts hold it.
    const key = `${p.ticker}|${p.dir}`;
    const row = by.get(key) ?? { t: p.ticker, d: p.dir === 'Short' ? 'Short' : 'Long', c: p.cls ?? '', value: 0, invested: 0 };
    row.value += posValue(p);
    row.invested += costOf(p);
    by.set(key, row);
  }
  const rows = [...by.values()];
  const money = Number(cash) || 0;
  const total = rows.reduce((s, r) => s + r.value, 0) + money;
  if (!(total > 0)) return amounts ? { mode, holdings: [], cash: 0, cashV: money, total: 0 } : { mode: 'percent', holdings: [], cash: 0 };
  const pct = (v) => Math.round((v / total) * 10000) / 100;
  const cents = (v) => Math.round(v * 100) / 100;
  const holdings = rows.map((r) => ({
    t: r.t,
    w: pct(r.value),
    d: r.d,
    c: r.c,
    ...(amounts ? { v: cents(r.value), inv: cents(r.invested) } : {}),
  })).sort((a, b) => Math.abs(b.w) - Math.abs(a.w) || a.t.localeCompare(b.t));
  return amounts
    ? { mode: 'amount', holdings, cash: pct(money), cashV: cents(money), total: cents(total) }
    : { mode: 'percent', holdings, cash: pct(money) };
}
