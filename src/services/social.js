/**
 * The Friends page's calls to the server (api/social/[action].js), and keeping
 * a shared summary up to date while the app is open.
 */
import { cloudEnabled } from './cloud.js';
import { wholeBook } from '../core/store.js';
import { shareSummary } from '../core/shareSummary.js';

/** One call. Throws an Error carrying the server's own words on a refusal. */
async function api(action, { body, query = '' } = {}) {
  const res = await fetch(`/api/social/${action}${query}`, body === undefined
    ? { credentials: 'same-origin' }
    : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `The server answered ${res.status}.`);
  return json;
}

export const social = {
  friends: () => api('friends'),
  request: (email) => api('request', { body: { email } }),
  answer: (id, accept) => api('answer', { body: { id, accept } }),
  cancel: (id) => api('cancel', { body: { id } }),
  remove: (friendId) => api('remove', { body: { friendId } }),
  portfolio: (friendId) => api('portfolio', { query: `?friend=${encodeURIComponent(friendId)}` }),
  chats: () => api('chats'),
  createChat: (name, members) => api('chat', { body: { name, members } }),
  messages: (chat, after = null) => api('messages', { query: `?chat=${encodeURIComponent(chat)}${after ? `&after=${encodeURIComponent(after)}` : ''}` }),
  send: (chat, text) => api('send', { body: { chat, body: text } }),
  leave: (chat) => api('leave', { body: { chat } }),
};

/**
 * Sharing, kept current.
 *
 * Prices move the weights all day, so the summary is sent again when it has
 * changed by a tenth of a point or more — at most every ten minutes, so an
 * open app does not write to the database on every price tick.
 */
const EVERY_MS = 10 * 60 * 1000;
let sharing = null;
let lastSent = '';
let lastAt = 0;

const fingerprint = (s) => JSON.stringify([s.cash.toFixed(1), s.holdings.map((h) => [h.t, h.d, h.w.toFixed(1)])]);

/** Switch sharing on or off; on sends the summary at once. */
export async function setSharing(on) {
  if (!on) {
    await api('share', { body: { summary: null } });
    sharing = false;
    return { shared: false };
  }
  const summary = shareSummary(wholeBook());
  const out = await api('share', { body: { summary } });
  sharing = true;
  lastSent = fingerprint(summary);
  lastAt = Date.now();
  return out;
}

/** What the server said about sharing, so a later sync knows without asking. */
export function knowSharing(on) { sharing = Boolean(on); }

/** Send the summary again if sharing is on and it has moved. Never throws. */
export async function syncShare() {
  if (!cloudEnabled()) return;
  try {
    if (sharing === null) sharing = Boolean((await social.friends()).share?.shared);
    if (!sharing || Date.now() - lastAt < EVERY_MS) return;
    const summary = shareSummary(wholeBook());
    const print = fingerprint(summary);
    if (print === lastSent) { lastAt = Date.now(); return; }
    await api('share', { body: { summary } });
    lastSent = print;
    lastAt = Date.now();
  } catch { /* the next refresh tries again */ }
}
