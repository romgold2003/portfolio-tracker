/**
 * Counting how Riskbook is used (November 2026), for the Admin page: that the
 * app was opened today, which pages were opened how often, and which broker a
 * file was imported from. Counts only — nothing about what is in anyone's
 * journal, which stays encrypted.
 *
 * Kept in memory and sent in batches — shortly after the app opens, then at
 * most every ten minutes while there is something new, and when the tab is
 * hidden — so the database is woken a few times a session rather than on every
 * click (Neon bills the time it is awake).
 */
import { cloudEnabled } from './cloud.js';
import { isUnlocked } from '../core/profiles.js';
import { onJournalLoaded } from '../core/store.js';

const FIRST_MS = 15_000;
const EVERY_MS = 10 * 60_000;

let pending = { open: false, pages: {}, imports: {} };
let timer = null;
let sending = false;

const empty = () => !pending.open && !Object.keys(pending.pages).length && !Object.keys(pending.imports).length;
const counting = () => cloudEnabled() && isUnlocked();

function schedule(ms) {
  if (timer) return;
  timer = setTimeout(() => { timer = null; flush(); }, ms);
}

/** Send what has been counted; on failure it is kept for next time. */
export async function flush({ leaving = false } = {}) {
  if (sending || empty() || !counting()) return;
  const batch = pending;
  pending = { open: false, pages: {}, imports: {} };
  sending = true;
  try {
    const res = await fetch('/api/social/ping', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
      // A tab being closed still gets to send it.
      keepalive: leaving,
    });
    if (!res.ok && res.status !== 401) throw new Error(String(res.status));
  } catch {
    // Put it back: counted again with whatever comes next.
    pending.open ||= batch.open;
    for (const kind of ['pages', 'imports']) {
      for (const [k, v] of Object.entries(batch[kind])) pending[kind][k] = (pending[kind][k] ?? 0) + v;
    }
  } finally {
    sending = false;
  }
}

/** A page (or window) of the app opened. */
export function notePage(page) {
  if (!counting() || !page) return;
  pending.pages[page] = (pending.pages[page] ?? 0) + 1;
  schedule(EVERY_MS);
}

/** A file imported, against the broker chosen in the import window. */
export function noteImport(broker) {
  if (!counting()) return;
  const id = broker || 'other';
  pending.imports[id] = (pending.imports[id] ?? 0) + 1;
  schedule(FIRST_MS);
}

/** Signed in: today counts as a day the app was used — once per time the app is opened. */
let opened = false;
onJournalLoaded(() => {
  if (!counting() || opened) return;
  opened = true;
  pending.open = true;
  schedule(FIRST_MS);
});

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush({ leaving: true });
  });
}
