/**
 * Display formatting. Views import these under short aliases so the template
 * literals below stay readable:
 *   import { money as $u, signedMoney as $s, pctText as fp, pnlColor as clr }
 */

/** $1,234.56 / -$1,234.56 — no leading + for positives. */
export function money(n) {
  return (n < 0 ? '-$' : '$')
    + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** +$1,234.56 / -$1,234.56 — always signed, for P&L figures. */
export function signedMoney(n) {
  return (n < 0 ? '-$' : '+$')
    + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** +12.34% / -12.34% */
export function pctText(n) {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

/** Green for gains, red for losses. */
export function pnlColor(n) {
  return n >= 0 ? 'var(--green)' : 'var(--red)';
}

/** Prices: whole dollars above $1,000, two decimals below. */
export function fmtPrice(n) {
  return n >= 1000
    ? n.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Small quantities need more decimals to stay meaningful. */
export function fmtQty(n) {
  return n.toFixed(n < 1 ? 6 : 4);
}

/** Escapes user-entered text before it goes into an HTML template literal. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
