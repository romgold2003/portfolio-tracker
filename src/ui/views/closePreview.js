/**
 * The live preview inside the close panel: what this exit books, what it leaves
 * open, and whether the trade is finished (and therefore lands in Monthly).
 */
import { state } from '../../core/store.js';
import { closeMath, baseQtyOf, bookedPnl } from '../../core/portfolio.js';
import { money as $u, signedMoney as $s, pctText as fp, pnlColor as clr } from '../format.js';

export function renderClosePreview(p, price, qty) {
  const el = document.getElementById(`cl-preview-${p.id}`);
  if (!el) return;
  if (!qty || qty <= 0) {
    el.innerHTML = '<span style="color:var(--text3);font-size:12px">Set an amount above 0</span>';
    return;
  }

  const math = closeMath(p, price, qty);
  const base = baseQtyOf(p);
  const slicePct = base > 0 ? (qty / base) * 100 : 0;
  const alreadyPct = base > 0 ? ((base - p.qty) / base) * 100 : 0;
  const remaining = p.qty - qty;
  const isFinal = remaining <= 1e-9;

  const overallPnl = bookedPnl(p) + math.pnl;
  const overallCost = p.entry * base;
  const overallRet = overallCost ? (overallPnl / overallCost) * 100 : 0;

  el.innerHTML = `
    <div class="dca-res-grid">
      <div><div class="drr-k">Closing now</div><div class="drr-v">${slicePct.toFixed(1)}% <span style="font-size:11px;color:var(--text3)">of original</span></div></div>
      <div><div class="drr-k">This exit P&L</div><div class="drr-v" style="color:${clr(math.pnl)}">${$s(+math.pnl.toFixed(2))}</div></div>
      <div><div class="drr-k">This exit return</div><div class="drr-v" style="color:${clr(math.retPct)}">${fp(math.retPct)}</div></div>
    </div>
    <div style="margin-top:10px;padding-top:10px;border-top:0.5px solid var(--border);font-size:12px;color:var(--text3);display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <span>Exit value ${$u(qty * price)} · cash after ${$u(state.cash + math.proceeds)}</span>
      <span>${alreadyPct > 0.0001 ? `${alreadyPct.toFixed(1)}% closed before · ` : ''}${isFinal ? 'nothing left open' : `${((remaining / base) * 100).toFixed(1)}% would stay open`}</span>
    </div>
    <div style="margin-top:8px;padding:9px 11px;border-radius:6px;background:${isFinal ? 'var(--ok-bg)' : 'var(--neutral-bg)'};border:0.5px solid ${isFinal ? 'var(--ok-br)' : 'var(--neutral-br)'};font-size:12px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <span style="color:${isFinal ? 'var(--green)' : 'var(--amber)'}">${isFinal ? '✓ Books to Monthly now — whole position complete' : '⏳ Stays open · nothing goes to Monthly yet'}</span>
      ${isFinal ? `<span style="font-weight:600">Overall <span style="color:${clr(overallPnl)}">${$s(+overallPnl.toFixed(2))}</span> <span style="color:${clr(overallRet)}">(${fp(overallRet)})</span></span>` : ''}
    </div>`;
}
