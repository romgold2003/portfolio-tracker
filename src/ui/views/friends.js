/**
 * The Friends page (October 2026): add a friend by the email they signed up
 * with, see the list, open one to see how their money is spread — in percent,
 * never in dollars — share your own the same way if you choose, and talk in
 * group chats with friends.
 *
 * The rules are the server's (api/_lib/social.js); this draws and asks. A
 * chat that is open is asked for new messages every few seconds while it is on
 * screen, and not at all otherwise: each check wakes the database, which is
 * billed by the hour it is awake.
 */
import { cloudEnabled } from '../../services/cloud.js';
import { social, setSharing, knowSharing } from '../../services/social.js';
import { shareSummary } from '../../core/shareSummary.js';
import { wholeBook } from '../../core/store.js';
import { escapeHtml } from '../format.js';

const el = (id) => document.getElementById(id);
const CHAT_EVERY_MS = 6000;
const LIST_EVERY_MS = 60000;

const view = {
  data: null,
  friend: null,
  chats: [],
  chat: null,
  messages: [],
  composing: false,
  note: '',
};

/* ───────────────────────── small pieces, exported for the tests ───────────────────────── */

const initial = (email) => escapeHtml((email ?? '?').trim().charAt(0).toUpperCase() || '?');
const nameOf = (email) => (email ?? 'Former member').split('@')[0];

export function ago(iso, now = Date.now()) {
  if (!iso) return '';
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const pct = (w) => `${w < 0 ? '−' : ''}${Math.abs(w).toFixed(1)}%`;

/** A friend's holdings, largest first, as bars of their share of the account. */
export function holdingsHtml(share) {
  if (!share?.shared) return '<div class="fr-empty">Not shared yet. They can switch sharing on from their own Friends page.</div>';
  const rows = [...(share.holdings ?? [])];
  if (share.cash) rows.push({ t: 'Cash', w: share.cash, d: '', c: 'Cash' });
  if (!rows.length) return '<div class="fr-empty">Nothing held right now.</div>';
  const top = Math.max(...rows.map((r) => Math.abs(r.w)), 1);
  return `<div class="fr-hold-head"><span>Holding</span><span>Share of account</span></div>
    ${rows.map((r) => `<div class="fr-hold">
      <span class="fr-tk">${escapeHtml(r.t)}${r.d === 'Short' ? ' <span class="mini-dir d-short">Short</span>' : ''}</span>
      <span class="fr-bar"><span class="${r.w < 0 ? 'neg' : r.t === 'Cash' ? 'cash' : ''}" style="width:${Math.max(2, (Math.abs(r.w) / top) * 100)}%"></span></span>
      <span class="fr-w">${pct(r.w)}</span>
    </div>`).join('')}
    <div class="fr-foot">Updated ${escapeHtml(ago(share.at))} · percentages only, no amounts</div>`;
}

/** The chat's messages, oldest first, yours on the right. */
export function messagesHtml(messages) {
  if (!messages.length) return '<div class="fr-empty">No messages yet. Say hello.</div>';
  return messages.map((m) => `<div class="fr-msg${m.mine ? ' mine' : ''}">
      ${m.mine ? '' : `<div class="fr-msg-who">${escapeHtml(nameOf(m.email))}</div>`}
      <div class="fr-msg-body">${escapeHtml(m.body)}</div>
      <div class="fr-msg-at">${escapeHtml(ago(m.at))}</div>
    </div>`).join('');
}

/* ───────────────────────── drawing ───────────────────────── */

function friendsListHtml(d) {
  if (!d.friends.length) {
    return '<div class="fr-empty">No friends yet. Add one by the email they use for Riskbook.</div>';
  }
  return d.friends.map((f) => `<button class="fr-row${view.friend?.id === f.id ? ' active' : ''}" data-friend="${escapeHtml(f.id)}">
      <span class="fr-ava">${initial(f.email)}</span>
      <span class="fr-who"><span class="fr-name">${escapeHtml(nameOf(f.email))}</span><span class="fr-mail">${escapeHtml(f.email)}</span></span>
      <span class="fr-tag${f.sharedAt ? ' on' : ''}">${f.sharedAt ? 'Sharing' : 'Not sharing'}</span>
    </button>`).join('');
}

function requestsHtml(d) {
  if (!d.incoming.length && !d.outgoing.length) return '';
  return `<div class="card-lbl"><span>Requests</span></div>
    ${d.incoming.map((r) => `<div class="fr-req">
      <span class="fr-ava">${initial(r.email)}</span>
      <span class="fr-who"><span class="fr-name">${escapeHtml(r.email)}</span><span class="fr-mail">wants to be friends</span></span>
      <button class="fr-btn fr-ok" data-accept="${escapeHtml(r.id)}">Accept</button>
      <button class="fr-btn" data-decline="${escapeHtml(r.id)}">Decline</button>
    </div>`).join('')}
    ${d.outgoing.map((r) => `<div class="fr-req">
      <span class="fr-ava muted">${initial(r.email)}</span>
      <span class="fr-who"><span class="fr-name">${escapeHtml(r.email)}</span><span class="fr-mail">waiting for them to accept</span></span>
      <button class="fr-btn" data-cancel="${escapeHtml(r.id)}">Cancel</button>
    </div>`).join('')}`;
}

function shareHtml(d) {
  const on = Boolean(d.share?.shared);
  const preview = shareSummary(wholeBook());
  const top = preview.holdings.slice(0, 4).map((h) => `${escapeHtml(h.t)} ${pct(h.w)}`).join(' · ');
  return `<div class="card-lbl"><span>Share my holdings with friends</span>
      <label class="fr-switch"><input type="checkbox" id="frShareToggle"${on ? ' checked' : ''}><span></span></label></div>
    <div class="fr-share-note">${on
    ? `Friends see each holding as a percentage of your account${d.share.at ? `, updated ${escapeHtml(ago(d.share.at))}` : ''}. Never amounts.`
    : 'Off. When on, friends see each holding as a percentage of your account — never amounts, share counts or cash in dollars.'}</div>
    ${top ? `<div class="fr-share-prev">They would see: ${top}${preview.holdings.length > 4 ? ' …' : ''}</div>` : ''}`;
}

function detailHtml() {
  const f = view.friend;
  if (!f) return '<div class="fr-empty fr-pick">Choose a friend to see how their account is spread.</div>';
  return `<div class="card-lbl"><span>${escapeHtml(nameOf(f.email))}'s holdings</span>
      <button class="fr-btn" data-remove="${escapeHtml(f.id)}">Remove friend</button></div>
    <div class="fr-mail" style="margin:-4px 0 10px">${escapeHtml(f.email)} · friends since ${escapeHtml(new Date(f.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))}</div>
    <div id="frHoldings"><div class="fr-empty">Loading…</div></div>`;
}

function chatsHtml() {
  const d = view.data;
  if (view.chat) {
    const c = view.chat;
    return `<div class="card-lbl"><button class="fr-btn" data-back>‹ Groups</button>
        <span class="fr-chat-title">${escapeHtml(c.name)}</span>
        <button class="fr-btn" data-leave="${escapeHtml(c.id)}">Leave</button></div>
      <div class="fr-mail" style="margin:-4px 0 8px">${c.members.map((m) => escapeHtml(nameOf(m.email))).join(', ')}</div>
      <div class="fr-msgs" id="frMsgs">${messagesHtml(view.messages)}</div>
      <form class="fr-send" id="frSend"><textarea id="frText" rows="1" maxlength="2000" placeholder="Message ${escapeHtml(c.name)}"></textarea>
        <button class="fr-btn fr-ok" type="submit">Send</button></form>`;
  }
  const form = view.composing ? `<form class="fr-new" id="frNewChat">
      <input class="fr-input" id="frChatName" maxlength="40" placeholder="Group name" autocomplete="off">
      <div class="fr-pickers">${d.friends.length ? d.friends.map((f) => `<label class="fr-pickf"><input type="checkbox" value="${escapeHtml(f.id)}"> ${escapeHtml(nameOf(f.email))}</label>`).join('')
    : '<span class="fr-mail">Add a friend first.</span>'}</div>
      <div class="fr-actions"><button class="fr-btn fr-ok" type="submit">Create group</button><button class="fr-btn" type="button" data-compose="0">Cancel</button></div>
    </form>` : '';
  return `<div class="card-lbl"><span>Group chats</span>${view.composing ? '' : '<button class="fr-btn fr-ok" data-compose="1">+ New group</button>'}</div>
    ${form}
    ${view.chats.length ? view.chats.map((c) => `<button class="fr-row" data-chat="${escapeHtml(c.id)}">
      <span class="fr-ava group">${c.members.length}</span>
      <span class="fr-who"><span class="fr-name">${escapeHtml(c.name)}</span>
        <span class="fr-mail">${c.last ? `${escapeHtml(nameOf(c.last.email))}: ${escapeHtml(c.last.body)}` : `${c.members.map((m) => escapeHtml(nameOf(m.email))).join(', ')}`}</span></span>
      <span class="fr-mail">${escapeHtml(ago(c.lastAt))}</span>
    </button>`).join('') : view.composing ? '' : '<div class="fr-empty">No groups yet. Make one with friends.</div>'}`;
}

function draw() {
  const d = view.data;
  if (!d) return;
  el('frRequests').innerHTML = requestsHtml(d);
  el('frRequests').hidden = !d.incoming.length && !d.outgoing.length;
  el('frCount').textContent = d.friends.length ? String(d.friends.length) : '';
  el('frList').innerHTML = friendsListHtml(d);
  el('frShareCard').innerHTML = shareHtml(d);
  el('frNote').textContent = view.note;
  drawChats();
}

function drawChats() {
  el('frChats').innerHTML = chatsHtml();
  const box = el('frMsgs');
  if (box) box.scrollTop = box.scrollHeight;
}

async function openFriend(id) {
  view.friend = view.data.friends.find((f) => f.id === id) ?? null;
  el('frDetail').innerHTML = detailHtml();
  el('frList').innerHTML = friendsListHtml(view.data);
  if (!view.friend) return;
  try {
    const share = await social.portfolio(id);
    if (view.friend?.id === id) el('frHoldings').innerHTML = holdingsHtml(share);
  } catch (err) {
    el('frHoldings').innerHTML = `<div class="fr-empty">${escapeHtml(err.message)}</div>`;
  }
}

async function load() {
  view.data = await social.friends();
  knowSharing(view.data.share?.shared);
  if (view.friend && !view.data.friends.some((f) => f.id === view.friend.id)) view.friend = null;
  view.chats = (await social.chats()).chats;
  draw();
  el('frDetail').innerHTML = detailHtml();
  if (view.friend) openFriend(view.friend.id);
}

/* ───────────────────────── chats ───────────────────────── */

let chatTimer = null;
let listTimer = null;
const onScreen = () => el('friends')?.classList.contains('active') && document.visibilityState === 'visible';

async function openChat(id) {
  view.chat = view.chats.find((c) => c.id === id) ?? null;
  view.messages = [];
  drawChats();
  if (!view.chat) return;
  view.messages = (await social.messages(id)).messages;
  drawChats();
  el('frText')?.focus();
  clearInterval(chatTimer);
  chatTimer = setInterval(pollChat, CHAT_EVERY_MS);
}

async function pollChat() {
  if (!view.chat || !onScreen()) return;
  const id = view.chat.id;
  const after = view.messages.at(-1)?.at ?? null;
  try {
    const { messages } = await social.messages(id, after);
    if (view.chat?.id !== id || !messages.length) return;
    const seen = new Set(view.messages.map((m) => m.id));
    view.messages.push(...messages.filter((m) => !seen.has(m.id)));
    const box = el('frMsgs');
    const atBottom = box && box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
    if (box) box.innerHTML = messagesHtml(view.messages);
    if (box && atBottom) box.scrollTop = box.scrollHeight;
  } catch { /* the next check tries again */ }
}

function closeChat() {
  clearInterval(chatTimer);
  view.chat = null;
  view.messages = [];
  drawChats();
}

/* ───────────────────────── events ───────────────────────── */

/** Run an action; its own message, if it sets one, or the server's refusal shows under the add box. */
async function act(fn) {
  view.note = '';
  try {
    await fn();
  } catch (err) {
    view.note = err.message;
  }
  el('frNote').textContent = view.note;
}

function bind() {
  const page = el('friends');
  if (page.dataset.bound === '1') return;
  page.dataset.bound = '1';

  el('frAdd').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = el('frEmail');
    const email = input.value.trim();
    if (!email) return;
    act(async () => {
      const out = await social.request(email);
      input.value = '';
      await load();
      view.note = out.status === 'friends'
        ? `You and ${email} are friends.`
        : `Request sent to ${email}. If they don't use Riskbook yet, it waits for them when they join.`;
      el('frNote').textContent = view.note;
    });
  });

  page.addEventListener('click', (e) => {
    const t = (sel) => e.target.closest(sel);
    if (t('[data-friend]')) return openFriend(t('[data-friend]').dataset.friend);
    if (t('[data-accept]')) return act(async () => { await social.answer(t('[data-accept]').dataset.accept, true); await load(); });
    if (t('[data-decline]')) return act(async () => { await social.answer(t('[data-decline]').dataset.decline, false); await load(); });
    if (t('[data-cancel]')) return act(async () => { await social.cancel(t('[data-cancel]').dataset.cancel); await load(); });
    if (t('[data-remove]')) {
      const f = view.friend;
      if (f && confirm(`Remove ${f.email} from your friends?`)) {
        return act(async () => { await social.remove(f.id); view.friend = null; await load(); });
      }
      return undefined;
    }
    if (t('[data-compose]')) { view.composing = t('[data-compose]').dataset.compose === '1'; drawChats(); el('frChatName')?.focus(); return undefined; }
    if (t('[data-chat]')) return openChat(t('[data-chat]').dataset.chat);
    if (t('[data-back]')) return closeChat();
    if (t('[data-leave]')) {
      if (confirm(`Leave ${view.chat?.name}?`)) {
        return act(async () => { await social.leave(view.chat.id); closeChat(); view.chats = (await social.chats()).chats; drawChats(); });
      }
    }
    return undefined;
  });

  page.addEventListener('change', (e) => {
    if (e.target.id !== 'frShareToggle') return;
    const on = e.target.checked;
    act(async () => { await setSharing(on); await load(); });
  });

  page.addEventListener('submit', (e) => {
    if (e.target.id === 'frNewChat') {
      e.preventDefault();
      const name = el('frChatName').value.trim();
      const members = [...e.target.querySelectorAll('input[type=checkbox]:checked')].map((b) => b.value);
      act(async () => {
        const made = await social.createChat(name, members);
        view.composing = false;
        view.chats = (await social.chats()).chats;
        await openChat(made.id);
      });
    }
    if (e.target.id === 'frSend') {
      e.preventDefault();
      sendCurrent();
    }
  });

  page.addEventListener('keydown', (e) => {
    // Enter sends; Shift+Enter starts a new line.
    if (e.target.id === 'frText' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCurrent(); }
  });

  document.addEventListener('visibilitychange', () => { if (onScreen()) pollChat(); });
}

function sendCurrent() {
  const box = el('frText');
  const text = box?.value.trim();
  if (!text || !view.chat) return;
  box.value = '';
  act(async () => {
    const sent = await social.send(view.chat.id, text);
    view.messages.push(sent);
    const list = el('frMsgs');
    if (list) { list.innerHTML = messagesHtml(view.messages); list.scrollTop = list.scrollHeight; }
  });
}

/** Draw the page; called each time it comes on screen. */
export async function renderFriends() {
  if (!el('friends')) return;
  const online = cloudEnabled();
  el('frOffline').hidden = online;
  el('frBody').hidden = !online;
  if (!online) return;
  bind();
  try {
    await load();
  } catch (err) {
    view.note = err.message;
    el('frNote').textContent = view.note;
  }
  clearInterval(listTimer);
  // Requests and new groups, now and then, while the page is open.
  listTimer = setInterval(async () => {
    if (!onScreen() || view.chat || view.composing) return;
    try { await load(); } catch { /* next time */ }
  }, LIST_EVERY_MS);
}
