/**
 * View state that is intentionally NOT persisted: which card is expanded, which
 * sort is active, which timeframe the curve shows. Reloading the page should
 * return to a clean default view.
 */
export const ui = {
  /** Which month of closed trades is expanded on the Positions page. */
  openClosedMonth: null,
  /**
   * Chart timeframe on the home page.
   *
   * Year to date rather than three months: the curve is reconstructed from the
   * trades back to 1 January, so opening on a three-month window hid most of
   * what the app actually knows.
   */
  timeframe: 'YTD',
  /**
   * Which chart the home page draws: 'value' is the account in currency over
   * the selected timeframe, 'benchmark' is the year so far as percentages with
   * the indexes beside it.
   */
  curveMode: 'value',
  /** Direction selected in the new-trade form. */
  formDirection: 'Long',
  /** Whether the new-trade form is sized by cash spent or by share count. */
  formSizeMode: 'amount',
  /** Expanded position card id, or null. */
  expandedId: null,
  /** Expanded trade row in the monthly detail table, or null. */
  expandedMonthTradeId: null,
  /** Sort key for the home page list. */
  homeSort: 'pnl',
  /** Sort key for the positions page list. */
  posSort: 'pnl',
};
