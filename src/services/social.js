/**
 * The Friends page's calls to the server (api/social/[action].js), and keeping
 * what friends see up to date while the app is open.
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
  direct: (friendId) => api('direct', { body: { friendId } }),
  members: (chat, add, remove) => api('members', { body: { chat, add, remove } }),
  messages: (chat, after = null) => api('messages', { query: `?chat=${encodeURIComponent(chat)}${after ? `&after=${encodeURIComponent(after)}` : ''}` }),
  send: (chat, text) => api('send', { body: { chat, body: text } }),
  leave: (chat) => api('leave', { body: { chat } }),
};

/**
 * What friends see, kept current.
 *
 * Prices move the figures all day, so the summary is sent again when it has
 * changed — at most every ten minutes, so an open app does not write to the
 * database on every price tick.
 */
const EVERY_MS = 10 * 60 * 1000;
/** 'amount', 'percent' or 'none'; null until the server has said. */
let showing = null;
let lastSent = '';
let lastAt = 0;

const fingerprint = (s) => JSON.stringify([s.mode, s.cash.toFixed(1), Math.round((s.total ?? 0) / 100),
  s.holdings.map((h) => [h.t, h.d, h.w.toFixed(1)])]);

/**
 * Choose what friends see — 'amount', 'percent' or 'none' — and send it now.
 * 'none' takes everything away.
 */
export async function setShowing(mode) {
  if (mode !== 'amount' && mode !== 'percent') {
    await api('share', { body: { summary: null } });
    showing = 'none';
    return { shared: false, mode: 'none' };
  }
  const summary = shareSummary(wholeBook(), mode);
  const out = await api('share', { body: { summary } });
  showing = mode;
  lastSent = fingerprint(summary);
  lastAt = Date.now();
  return out;
}

/** What the server said this account shows, so a later sync knows without asking. */
export function knowShowing(mode) { showing = mode ?? 'none'; }

/** Send the summary again if anything is shown and it has moved. Never throws. */
export async function syncShare() {
  if (!cloudEnabled()) return;
  try {
    if (showing === null) showing = (await social.friends()).share?.mode ?? 'none';
    if (showing === 'none' || Date.now() - lastAt < EVERY_MS) return;
    const summary = shareSummary(wholeBook(), showing);
    const print = fingerprint(summary);
    if (print === lastSent) { lastAt = Date.now(); return; }
    await api('share', { body: { summary } });
    lastSent = print;
    lastAt = Date.now();
  } catch { /* the next refresh tries again */ }
}
