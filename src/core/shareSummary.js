/**
 * What friends see of a book: each holding as a share of the account, and the
 * cash, in percent — no dollar amounts, no share counts (October 2026).
 *
 * Worked out on the owner's device, because the journal is encrypted and the
 * server cannot read it; this summary is the one thing about a book that
 * leaves it, and only when its owner switches sharing on (views/friends.js).
 * The weights are the allocation pie's, by holding: longs less shorts, plus
 * cash, adding up to the account value — a short shows as a negative weight.
 */
import { posValue } from './portfolio.js';

export function shareSummary({ positions = [], cash = 0 } = {}) {
  const by = new Map();
  for (const p of positions) {
    if (p?.status !== 'Open' || !(Number(p.qty) > 0) || !(Number(p.cur) > 0)) continue;
    // One line per holding and direction, however many sub-accounts hold it.
    const key = `${p.ticker}|${p.dir}`;
    const row = by.get(key) ?? { t: p.ticker, d: p.dir === 'Short' ? 'Short' : 'Long', c: p.cls ?? '', value: 0 };
    row.value += posValue(p);
    by.set(key, row);
  }
  const rows = [...by.values()];
  const total = rows.reduce((s, r) => s + r.value, 0) + (Number(cash) || 0);
  if (!(total > 0)) return { holdings: [], cash: 0 };
  const pct = (v) => Math.round((v / total) * 10000) / 100;
  return {
    holdings: rows.map((r) => ({ t: r.t, w: pct(r.value), d: r.d, c: r.c }))
      .sort((a, b) => Math.abs(b.w) - Math.abs(a.w) || a.t.localeCompare(b.t)),
    cash: pct(Number(cash) || 0),
  };
}
