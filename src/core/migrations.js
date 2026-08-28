/**
 * One-way upgrades of stored data. Each migration must be safe to run on every
 * boot: it detects its own old shape and does nothing when there is none.
 */
import { state, savePositions } from './store.js';

/**
 * Older versions wrote each partial close as its own standalone Closed record,
 * so half-sold positions showed up in the Monthly report before the trade was
 * finished. Fold those records back into their parent position as exits.
 */
function migrateLegacyPartials() {
  const legacy = state.positions.filter((p) => p.status === 'Closed' && p.partial === true);
  if (!legacy.length) {
    state.positions.forEach((p) => { delete p.partial; delete p.closedPct; });
    return 0;
  }

  const pnlOf = (r) => (r.dir === 'Long' ? r.cur - r.entry : r.entry - r.cur) * r.qty;
  let merged = 0;

  for (const record of legacy) {
    const parent = state.positions.find((x) => x !== record && !x.partial
      && x.ticker === record.ticker && x.dir === record.dir && x.open === record.open);
    if (!parent) continue; // orphan — leave it as a real trade

    if (!parent.exits) parent.exits = [];
    // If the parent is already Closed, its own final exit is not in exits yet.
    if (parent.status === 'Closed' && !parent.exits.length) {
      parent.exits.push({ d: parent.close, qty: parent.qty, price: parent.cur, pnl: pnlOf(parent) });
    }
    parent.exits.push({ d: record.close, qty: record.qty, price: record.cur, pnl: pnlOf(record) });
    parent.exits.sort((a, b) => String(a.d).localeCompare(String(b.d)));

    const totalQty = parent.exits.reduce((sum, e) => sum + e.qty, 0);
    if (parent.status === 'Open') {
      parent.origQty = parent.qty + totalQty; // restore the true original size
    } else {
      const avgExit = parent.exits.reduce((sum, e) => sum + e.price * e.qty, 0) / totalQty;
      parent.origQty = totalQty;
      parent.qty = totalQty;
      parent.cur = avgExit;
      parent.amount = parent.entry * totalQty;
      parent.firstExit = parent.exits[0].d;
      parent.close = parent.exits[parent.exits.length - 1].d;
    }
    parent.exits.forEach((e) => {
      e.pct = +((e.qty / (parent.origQty || totalQty)) * 100).toFixed(4);
    });

    state.positions = state.positions.filter((x) => x !== record);
    merged++;
  }

  state.positions.forEach((p) => { delete p.partial; delete p.closedPct; });
  if (merged) {
    savePositions();
    console.info(`Merged ${merged} legacy partial record(s) back into their positions.`);
  }
  return merged;
}

/** Runs every migration in order. Called once, at boot, before the first render. */
export function runMigrations() {
  migrateLegacyPartials();
}
