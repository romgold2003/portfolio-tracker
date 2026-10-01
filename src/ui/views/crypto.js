/**
 * The Crypto page: whale trades, unusual volume and the spot ETF flows.
 *
 * Its own page, under News in the menu, since October 2026. The three views
 * began under Gamble, then briefly as a tab inside News; Romy wanted crypto as
 * a section of its own, like Monthly or New trade. The panels themselves did not
 * change — each still draws itself from cryptoWhales.js, unusualVolume.js and
 * the ETF half of exposure.js — this only decides when they are drawn.
 */
import { etfFlows } from '../../services/options.js';
import { renderEtfFlows } from './exposure.js';
import { installCryptoTabs, showCryptoView, startCryptoWhales } from './cryptoWhales.js';

/** Draw the page on arrival. Each panel keeps its own refresh clock after that. */
export async function renderCrypto() {
  installCryptoTabs();
  showCryptoView();
  startCryptoWhales();
  // ETF flows are a separate source; one being down must not hold the others.
  renderEtfFlows(await etfFlows().catch(() => null));
}
