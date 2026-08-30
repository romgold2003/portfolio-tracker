/**
 * View state that is intentionally NOT persisted: which card is expanded, which
 * sort is active, which timeframe the curve shows. Reloading the page should
 * return to a clean default view.
 */
export const ui = {
  /** Which month of closed trades is expanded on the Positions page. */
  openClosedMonth: null,
  /** Chart timeframe on the home page. */
  timeframe: '3M',
  /** Direction selected in the new-trade form. */
  formDirection: 'Long',
  /** Expanded position card id, or null. */
  expandedId: null,
  /** Expanded trade row in the monthly detail table, or null. */
  expandedMonthTradeId: null,
  /** Sort key for the home page list. */
  homeSort: 'pnl',
  /** Sort key for the positions page list. */
  posSort: 'pnl',
};
