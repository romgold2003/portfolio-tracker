/**
 * Page switching for the .page sections. Not a URL router — the app is a
 * single screen with tabs, and deep links are deliberately out of scope.
 *
 * The order matters: it is matched positionally against the nav buttons, so a
 * page added here has to be added there in the same place.
 */
const PAGES = ['home', 'positions', 'add', 'monthly', 'news', 'crypto'];

/** Set at boot so the router can trigger a page's lazy re-render. */
let onEnter = () => {};
export function setPageEnterHandler(fn) { onEnter = fn; }

export function show(name) {
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  const page = document.getElementById(name);
  if (page) page.classList.add('active');
  document.querySelectorAll('.nl').forEach((btn, i) => btn.classList.toggle('active', PAGES[i] === name));
  /**
   * A new page starts at its top. On a phone the document is what scrolls, so
   * switching pages used to land part-way down the next one, wherever the last
   * had been left; on a desktop it is the main pane.
   */
  toggleTools(false);
  window.scrollTo?.(0, 0);
  const main = document.querySelector('.main');
  if (main) main.scrollTop = 0;
  onEnter(name);
}

/**
 * The tools row — voice, live-price settings, designer, sign-out — sits behind
 * a ⚙ button on a phone, where it otherwise took a third of the screen before
 * any of the page. On a wider screen the button is not shown and this does
 * nothing visible. Pass a boolean to set it rather than flip it.
 */
export function toggleTools(force) {
  const side = document.querySelector('.sidebar');
  if (!side) return;
  const open = typeof force === 'boolean' ? force : !side.classList.contains('tools-open');
  side.classList.toggle('tools-open', open);
  document.getElementById('toolsBtn')?.setAttribute('aria-expanded', String(open));
}
