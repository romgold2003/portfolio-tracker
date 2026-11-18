/**
 * The Clavis logo (November 2026): the white C with the orange keyhole — the
 * company's mark on everything official (sign-in, legal, emails). The fox is
 * never used in its place.
 */
let uid = 0;

export function logoSvg(size = 24) {
  const id = `lg${uid++}`;
  return `<svg class="logo-mark" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="#F26A1E"/><stop offset="1" stop-color="#F59E0B"/></linearGradient></defs><path d="M78 22 A38 38 0 1 0 78 78" fill="none" stroke="currentColor" stroke-width="15"/><path d="M58 50 L83 25 A36 36 0 0 1 83 75 Z" fill="url(#${id})"/><circle cx="58" cy="50" r="9.5" fill="url(#${id})"/><circle cx="58" cy="50" r="4.6" fill="var(--panel)"/><path d="M61 47.6 L76 44 L76 56 L61 52.4 Z" fill="var(--panel)"/></svg>`;
}

/** The logo with the name, as a small header. */
export function brandChip(size = 22) {
  return `<span class="brand-chip">${logoSvg(size)}<b>Clavis</b></span>`;
}
