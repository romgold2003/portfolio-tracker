/**
 * Page switching for the four .page sections. Not a URL router — the app is a
 * single screen with tabs, and deep links are deliberately out of scope.
 */
const PAGES = ['home', 'positions', 'add', 'monthly'];

/** Set at boot so the router can trigger a page's lazy re-render. */
let onEnter = () => {};
export function setPageEnterHandler(fn) { onEnter = fn; }

export function show(name) {
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  const page = document.getElementById(name);
  if (page) page.classList.add('active');
  document.querySelectorAll('.nl').forEach((btn, i) => btn.classList.toggle('active', PAGES[i] === name));
  onEnter(name);
}
