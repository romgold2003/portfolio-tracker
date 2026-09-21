/**
 * Esc closes whatever window is open — the designer, the price settings, the
 * favourites, the years panel, the backup import, the allocation view, the
 * account menu.
 *
 * Only the window on TOP closes. Some open over others (favourites over the
 * designer, years over the settings), and one press taking both down would lose
 * the one underneath that you meant to keep. So a stack peels off one press at
 * a time, in the order it is drawn.
 */

const zOf = (node) => Number(getComputedStyle(node).zIndex) || 0;

/** Node.DOCUMENT_POSITION_FOLLOWING, spelled out so this also runs outside a browser. */
const FOLLOWING = 4;

/**
 * Of the open windows, the one drawn on top: the highest z-index, and on a tie
 * the one later in the page, which is the one the browser paints last.
 */
export function topmost(nodes, z = zOf) {
  let top = null;
  for (const node of nodes) {
    if (!top) { top = node; continue; }
    const a = z(top), b = z(node);
    const later = Boolean(top.compareDocumentPosition(node) & FOLLOWING);
    if (b > a || (b === a && later)) top = node;
  }
  return top;
}

const shown = (node) => node.classList.contains('show');

/**
 * windows: [{ id, close, isOpen? }] — isOpen defaults to the `.show` class every
 * modal here uses.
 */
export function initEscapeToClose(windows) {
  document.addEventListener('keydown', (e) => {
    // An input method mid-composition uses Esc to cancel the composition, and
    // something that already handled the key has said so.
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
    const open = windows
      .map((w) => ({ w, node: document.getElementById(w.id) }))
      .filter(({ w, node }) => node && (w.isOpen ?? shown)(node));
    if (!open.length) return;
    const top = topmost(open.map((o) => o.node));
    e.preventDefault();
    open.find((o) => o.node === top).w.close();
  });
}
