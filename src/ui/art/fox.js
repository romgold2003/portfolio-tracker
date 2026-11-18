/**
 * Clavis the fox (November 2026): the guide inside the app.
 *
 * One drawing everywhere — a single-weight line fox head with the orange
 * keyhole outline on its forehead, the mark from the brand brief. The C with
 * the keyhole is the company's logo; the fox is never used as the logo.
 *
 * Where it may appear (the brief): onboarding and the tutorial, empty
 * screens, Insights' takeaways, milestones and the state-of-mind question.
 * Never beside losses or drawdowns, the core numbers, money movement or
 * security.
 */
let uid = 0;

/**
 * The fox as inline SVG. `size` in pixels; `line` the outline colour
 * (currentColor by default, so it follows the text around it); `eyes` may
 * carry a mood colour, as the brand sheet's "Ahead" signal does.
 */
export function foxSvg(size = 28, { line = 'currentColor', eyes = null, label = null } = {}) {
  const id = `fx${uid++}`;
  const w = size >= 64 ? 6 : size >= 32 ? 8 : 10;
  const e = eyes ?? line;
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg class="fox-mark" width="${size}" height="${size}" viewBox="14 10 172 162" fill="none" stroke-linecap="round" stroke-linejoin="round" ${a11y}>
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F59E0B"/><stop offset="1" stop-color="#F26A1E"/></linearGradient></defs>
    <path d="M50 20 L82 54 L118 54 L150 20 L158 80 L168 110 L136 126 L110 154 L100 162 L90 154 L64 126 L32 110 L42 80 Z" stroke="${line}" stroke-width="${w}"/>
    <path d="M32 110 Q62 106 80 118 L100 138 L120 118 Q138 106 168 110" stroke="${line}" stroke-width="${w * 0.6}" opacity=".5"/>
    <path d="M64 88 L84 95" stroke="${e}" stroke-width="${w * 0.9}"/><path d="M136 88 L116 95" stroke="${e}" stroke-width="${w * 0.9}"/>
    <path d="M95 149 L105 149 L100 156 Z" fill="${line}" stroke="${line}" stroke-width="3"/>
    <path d="M98 72.6 A5 5 0 1 1 102 72.6 L104 82 L96 82 Z" stroke="url(#${id})" stroke-width="${Math.max(4, w * 0.6)}"/>
  </svg>`;
}

/** An empty screen with the fox: a short title and one line of what to do. */
export function foxEmpty(title, line, action = '') {
  return `<div class="fox-empty">${foxSvg(56)}<div class="fox-empty-t">${title}</div><div class="fox-empty-s">${line}</div>${action}</div>`;
}

/** Fill every [data-fox=size] in the page with the fox, once. */
export function paintFoxes(root = document) {
  root.querySelectorAll?.('[data-fox]').forEach((node) => {
    if (node.dataset.painted) return;
    node.innerHTML = foxSvg(Number(node.dataset.fox) || 28);
    node.dataset.painted = '1';
  });
}
