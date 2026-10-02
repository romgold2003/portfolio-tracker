/**
 * The fear-and-greed dials, stocks and crypto, at the top of every page but
 * New trade.
 *
 * They began in the corner of the News page; Romy wanted them everywhere
 * (October 2026) except New trade, which is a form and has a picture of its
 * own. Every page's topbar carries an empty `[data-gauges]` slot, and this
 * fills all of them at once, so whichever page is open already has them.
 *
 * The readings come from marketSentiment(), which holds its answer for half an
 * hour — calling this on every page change costs no extra requests.
 */
import { marketSentiment } from '../../services/sentiment.js';
import { gaugeSvg } from './gauge.js';
import { escapeHtml } from '../format.js';

const DIALS = [
  ['stocks', 'Stocks'],
  ['crypto', 'Crypto'],
];

/** The dials' markup for a reading; empty when there is nothing to show. */
export function gaugesHtml(sentiment) {
  return DIALS
    .map(([key, title]) => {
      const r = sentiment?.[key];
      if (!r) return '';
      // The words go under the dial as text, so they stay readable at any size.
      return `<figure class="gauge-fig">${gaugeSvg({ value: r.value, label: r.label, title })}
        <figcaption class="gauge-text"><span class="gauge-mood">${escapeHtml(r.label)}</span>
          <span class="gauge-name">${escapeHtml(title)}</span></figcaption></figure>`;
    })
    .filter(Boolean)
    .join('');
}

/** Put a reading into every slot. A slot stays hidden until there is one. */
export function drawGauges(sentiment) {
  const html = gaugesHtml(sentiment);
  for (const host of document.querySelectorAll('[data-gauges]')) {
    host.innerHTML = html;
    host.style.display = html ? '' : 'none';
  }
}

/** Fetch (or reuse) the reading and draw it. Never throws: the dials are extra. */
export async function showGauges() {
  try {
    drawGauges(await marketSentiment());
  } catch {
    // A sentiment feed that is down leaves the slots hidden, and nothing else.
  }
}
