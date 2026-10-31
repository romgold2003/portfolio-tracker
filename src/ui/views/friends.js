/**
 * The Friends page (October 2026), laid out the way a professional network is:
 * your profile on top, your friends down the side — each with a button to
 * message them — and your conversations, one-to-one and in groups, beside.
 *
 * - Profile → Investment details: what friends may see of your investments —
 *   amounts (dollars and percentages), percentages only, or nothing at all.
 * - Add a friend by the email they signed up with; open one to see what they
 *   chose to show.
 * - Create group: name it, then Add friends in a second window, by checkbox.
 *   The person who made a group can add or remove people later.
 * - Messages are permanent: nothing expires.
 *
 * The rules are the server's (api/_lib/social.js); this draws and asks. An
 * open chat is asked for new messages every few seconds while it is on screen,
 * and not at all otherwise: each check wakes the database, billed by the hour.
 */
import { cloudEnabled } from '../../services/cloud.js';
import { social, setShowing, knowShowing } from '../../services/social.js';
import { shareSummary } from '../../core/shareSummary.js';
import { wholeBook } from '../../core/store.js';
import { currentProfile } from '../../core/profiles.js';
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
  note: '',
  /** The window open over the page: null, or {type, ...}. */
  modal: null,
};

/* ───────────────────────── small pieces, exported for the tests ───────────────────────── */

const initial = (email) => escapeHtml((email ?? '?').trim().charAt(0).toUpperCase() || '?');
export const nameOf = (email) => (email ?? 'Former member').split('@')[0];

export function ago(iso, now = Date.now()) {
  if (!iso) return '';
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const pct = (w) => `${w < 0 ? '−' : ''}${Math.abs(w).toFixed(1)}%`;
const usd = (n) => (n == null ? '—' : `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);

/** What each choice in Investment details means, in the words the page uses. */
export const SHOW_CHOICES = [
  { mode: 'amount', title: 'Amounts', tag: 'Amounts', text: 'Friends see how much is in each company in dollars — what it is worth and what you put in — and its share of your account.' },
  { mode: 'percent', title: 'Percentages', tag: 'Percentages', text: 'Friends see how much of your account is in each company, in percent. No dollar amounts.' },
  { mode: 'none', title: 'None', tag: 'Private', text: 'Nobody sees anything about your investments.' },
];
const choice = (mode) => SHOW_CHOICES.find((c) => c.mode === mode) ?? SHOW_CHOICES[2];

/** A friend's holdings as they chose to show them: bars of their share, dollars too if they allow. */
export function holdingsHtml(share, who = 'They') {
  if (!share?.shared) return `<div class="fr-empty">${escapeHtml(who)} keep${who === 'They' ? '' : 's'} their investments private.</div>`;
  const amounts = share.mode === 'amount';
  const rows = [...(share.holdings ?? [])];
  if (share.cash) rows.push({ t: 'Cash', w: share.cash, d: '', v: share.cashV ?? null });
  if (!rows.length) return '<div class="fr-empty">Nothing held right now.</div>';
  const top = Math.max(...rows.map((r) => Math.abs(r.w)), 1);
  return `<div class="fr-hold-head"><span>Holding</span><span>${amounts ? 'Value · share' : 'Share of account'}</span></div>
    ${rows.map((r) => `<div class="fr-hold${amounts ? ' amounts' : ''}">
      <span class="fr-tk">${escapeHtml(r.t)}${r.d === 'Short' ? ' <span class="mini-dir d-short">Short</span>' : ''}${
  amounts && r.inv != null ? `<span class="fr-inv">invested ${usd(r.inv)}</span>` : ''}</span>
      <span class="fr-bar"><span class="${r.w < 0 ? 'neg' : r.t === 'Cash' ? 'cash' : ''}" style="width:${Math.max(2, (Math.abs(r.w) / top) * 100)}%"></span></span>
      ${amounts ? `<span class="fr-v">${usd(r.v)}</span>` : ''}
      <span class="fr-w">${pct(r.w)}</span>
    </div>`).join('')}
    ${amounts && share.total != null ? `<div class="fr-total"><span>Account</span><b>${usd(share.total)}</b></div>` : ''}
    <div class="fr-foot">Updated ${escapeHtml(ago(share.at))} · ${amounts ? 'amounts and percentages' : 'percentages only, no amounts'}</div>`;
}

/** The chat's messages, oldest first, yours on the right. */
export function messagesHtml(messages, group = true) {
  if (!messages.length) return '<div class="fr-empty">No messages yet. Say hello.</div>';
  return messages.map((m) => `<div class="fr-msg${m.mine ? ' mine' : ''}">
      ${m.mine || !group ? '' : `<div class="fr-msg-who">${escapeHtml(nameOf(m.email))}</div>`}
      <div class="fr-msg-body">${escapeHtml(m.body)}</div>
      <div class="fr-msg-at">${escapeHtml(ago(m.at))}</div>
    </div>`).join('');
}

/** Checkboxes of friends, for a group: `checked` ticked, `locked` shown but fixed. */
export function friendPickerHtml(friends, checked = [], locked = []) {
  if (!friends.length) return '<div class="fr-empty">Add a friend first.</div>';
  return friends.map((f) => `<label class="fr-pickrow">
      <input type="checkbox" value="${escapeHtml(f.id)}"${checked.includes(f.id) ? ' checked' : ''}${locked.includes(f.id) ? ' disabled' : ''}>
      <span class="fr-ava">${initial(f.email)}</span>
      <span class="fr-who"><span class="fr-name">${escapeHtml(nameOf(f.email))}</span><span class="fr-mail">${escapeHtml(f.email)}</span></span>
    </label>`).join('');
}

/* ───────────────────────── the page ───────────────────────── */

/**
 * A box's title bar: the arrow that folds it shut and opens it again, the
 * title, and whatever goes on the right. Which boxes are folded is kept on
 * this device (October 2026: "close each window, open it back").
 */
const head = (title, right = '') => `<div class="card-lbl fr-head"><button class="fr-fold" data-fold aria-expanded="true" aria-label="Close or open ${escapeHtml(title)}"></button><span class="fr-title">${escapeHtml(title)}</span>${right}</div>`;
/** A title bar with ← in place of the fold arrow: for a view opened over another. */
const backHead = (title, back, right = '') => `<div class="card-lbl fr-head"><button class="fr-back" ${back} aria-label="Back">←</button><span class="fr-title">${title}</span>${right}</div>`;

const FOLD_KEY = 'fr-folded';
function folded() {
  try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]')); } catch { return new Set(); }
}
/** Put each box back as it was left, folded or open. */
function applyFolds() {
  const shut = folded();
  for (const id of ['frAddCard', 'frRequests', 'frFriendsCard', 'frChats']) {
    const card = el(id);
    if (!card) continue;
    const isShut = shut.has(id) && !(id === 'frChats' && view.chat);
    card.classList.toggle('folded', isShut);
    card.querySelector(':scope > .fr-head .fr-fold')?.setAttribute('aria-expanded', String(!isShut));
  }
}
function toggleFold(card) {
  const shut = folded();
  if (shut.has(card.id)) shut.delete(card.id); else shut.add(card.id);
  try { localStorage.setItem(FOLD_KEY, JSON.stringify([...shut])); } catch { /* this session only */ }
  applyFolds();
}

function profileHtml(d) {
  const email = currentProfile()?.email ?? '';
  const shows = choice(d.share?.mode);
  return `<span class="fr-ava big">${initial(email)}</span>
    <span class="fr-who"><span class="fr-name big">${escapeHtml(nameOf(email))}</span>
      <span class="fr-mail">${escapeHtml(email)} · ${d.friends.length} friend${d.friends.length === 1 ? '' : 's'}</span></span>
    <span class="fr-tag ${shows.mode}" title="What friends see of your investments">${escapeHtml(shows.tag)}</span>
    <button class="fr-btn fr-ok" data-modal="profile">Profile</button>`;
}

function friendsListHtml(d) {
  if (!d.friends.length) return '<div class="fr-empty">No friends yet. Add one by the email they use for Riskbook.</div>';
  return d.friends.map((f) => `<div class="fr-row${view.friend?.id === f.id ? ' active' : ''}" data-friend="${escapeHtml(f.id)}" role="button" tabindex="0">
      <span class="fr-ava">${initial(f.email)}</span>
      <span class="fr-who"><span class="fr-name">${escapeHtml(nameOf(f.email))}</span><span class="fr-mail">${escapeHtml(f.email)}</span></span>
      <span class="fr-tag ${f.shows}">${escapeHtml(choice(f.shows).tag)}</span>
      <button class="fr-icon" data-dm="${escapeHtml(f.id)}" title="Message ${escapeHtml(nameOf(f.email))}" aria-label="Message ${escapeHtml(nameOf(f.email))}">💬</button>
    </div>`).join('');
}

function requestsHtml(d) {
  if (!d.incoming.length && !d.outgoing.length) return '';
  return `${head('Requests', `<span class="fr-count">${d.incoming.length + d.outgoing.length}</span>`)}
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

function detailHtml() {
  const f = view.friend;
  if (!f) return '';
  return `${backHead(`${escapeHtml(nameOf(f.email))}'s investments`, 'data-close-friend',
    `<span class="fr-actions"><button class="fr-btn fr-ok" data-dm="${escapeHtml(f.id)}">💬 Message</button>
      <button class="fr-btn" data-remove="${escapeHtml(f.id)}">Remove</button></span>`)}
    <div class="fr-mail" style="margin:-4px 0 10px">${escapeHtml(f.email)} · friends since ${escapeHtml(new Date(f.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))}</div>
    <div id="frHoldings"><div class="fr-empty">Loading…</div></div>`;
}

function chatTitle(c) { return c.kind === 'direct' ? nameOf(c.name) : c.name; }

function chatsHtml() {
  if (view.chat) {
    const c = view.chat;
    const group = c.kind !== 'direct';
    const action = !group ? '' : c.owner
      ? `<button class="fr-btn" data-modal="members">Members</button>`
      : `<button class="fr-btn" data-leave="${escapeHtml(c.id)}">Leave</button>`;
    return `${backHead(escapeHtml(chatTitle(c)), 'data-back', action)}
      <div class="fr-mail" style="margin:-4px 0 8px">${group
    ? `${c.members.length} member${c.members.length === 1 ? '' : 's'}: ${c.members.map((m) => escapeHtml(nameOf(m.email))).join(', ')}${c.owner ? ' · you made this group' : ''}`
    : escapeHtml(c.with?.email ?? '')}</div>
      <div class="fr-msgs" id="frMsgs">${messagesHtml(view.messages, group)}</div>
      <form class="fr-send" id="frSend"><textarea id="frText" rows="1" maxlength="2000" placeholder="Message ${escapeHtml(chatTitle(c))}"></textarea>
        <button class="fr-btn fr-ok" type="submit">Send</button></form>`;
  }
  return `${head('Messages', '<button class="fr-btn fr-ok" data-modal="groupName">+ Create group</button>')}
    ${view.chats.length ? view.chats.map((c) => `<button class="fr-row" data-chat="${escapeHtml(c.id)}">
      ${c.kind === 'direct' ? `<span class="fr-ava">${initial(c.name)}</span>` : `<span class="fr-ava group">${c.members.length}</span>`}
      <span class="fr-who"><span class="fr-name">${escapeHtml(chatTitle(c))}${c.kind === 'direct' ? '' : ' <span class="fr-kind">group</span>'}</span>
        <span class="fr-mail">${c.last ? `${c.last.email === currentProfile()?.email ? 'You' : escapeHtml(nameOf(c.last.email))}: ${escapeHtml(c.last.body)}` : 'No messages yet'}</span></span>
      <span class="fr-mail">${escapeHtml(ago(c.lastAt))}</span>
    </button>`).join('') : '<div class="fr-empty">No conversations yet. Press 💬 beside a friend, or create a group.</div>'}`;
}

/* ───────────────────────── windows ───────────────────────── */

function modalHtml(m) {
  const d = view.data;
  if (m.type === 'profile') {
    const now = d.share?.mode ?? 'none';
    const picked = m.mode ?? now;
    const preview = picked === 'none' ? null : shareSummary(wholeBook(), picked);
    return `<div class="fr-dhead"><span>Your profile</span><button class="fr-x" data-close aria-label="Close">×</button></div>
      <div class="fr-profile-id"><span class="fr-ava big">${initial(currentProfile()?.email)}</span>
        <span class="fr-who"><span class="fr-name big">${escapeHtml(nameOf(currentProfile()?.email))}</span><span class="fr-mail">${escapeHtml(currentProfile()?.email ?? '')}</span></span></div>
      <div class="fr-section">Investment details</div>
      <div class="fr-sub">Who can see your investments: your friends only, and only what you choose here.</div>
      ${SHOW_CHOICES.map((c) => `<label class="fr-choice${picked === c.mode ? ' on' : ''}">
        <input type="radio" name="frShow" value="${c.mode}"${picked === c.mode ? ' checked' : ''}>
        <span><b>${escapeHtml(c.title)}</b><span class="fr-mail wrap">${escapeHtml(c.text)}</span></span>
      </label>`).join('')}
      <div class="fr-preview">${preview
    ? `<div class="fr-sub">Your friends would see:</div>${holdingsHtml({ shared: true, ...preview, at: new Date().toISOString() })}`
    : '<div class="fr-sub">Your friends see: “keeps their investments private”.</div>'}</div>
      <div class="fr-dfoot"><button class="fr-btn" data-close>Cancel</button><button class="fr-btn fr-ok" data-save-profile>Save</button></div>`;
  }
  if (m.type === 'groupName') {
    return `<div class="fr-dhead"><span>Create group</span><button class="fr-x" data-close aria-label="Close">×</button></div>
      <div class="fr-section">Name</div>
      <input class="fr-input" id="frGroupName" maxlength="40" placeholder="e.g. Tech longs" autocomplete="off" value="${escapeHtml(m.name ?? '')}">
      <div class="fr-dfoot"><button class="fr-btn" data-close>Cancel</button><button class="fr-btn fr-ok" data-group-next>Add friends ›</button></div>`;
  }
  if (m.type === 'groupFriends') {
    return `<div class="fr-dhead"><span>Add friends to “${escapeHtml(m.name)}”</span><button class="fr-x" data-close aria-label="Close">×</button></div>
      <div class="fr-sub">Tick the friends you want in the group.</div>
      <div class="fr-picklist" id="frPick">${friendPickerHtml(d.friends, m.members ?? [])}</div>
      <div class="fr-dfoot"><button class="fr-btn" data-group-back>‹ Back</button><button class="fr-btn fr-ok" data-group-create>Create group</button></div>`;
  }
  if (m.type === 'members') {
    const c = view.chat;
    const inGroup = c.members.map((x) => x.id);
    // Members who are not this person's friends stay in the list, ticked: they can be removed, not re-added.
    const others = c.members.filter((x) => x.id !== currentUserId() && !d.friends.some((f) => f.id === x.id))
      .map((x) => ({ id: x.id, email: x.email }));
    return `<div class="fr-dhead"><span>Members of “${escapeHtml(c.name)}”</span><button class="fr-x" data-close aria-label="Close">×</button></div>
      <div class="fr-sub">Tick to add, untick to remove. You stay in the group.</div>
      <div class="fr-picklist" id="frPick">${friendPickerHtml([...d.friends, ...others], inGroup)}</div>
      <div class="fr-dfoot"><button class="fr-btn" data-close>Cancel</button><button class="fr-btn fr-ok" data-save-members>Save</button></div>`;
  }
  return '';
}

/** The signed-in user's id, as the chats list reports members. */
function currentUserId() {
  const email = currentProfile()?.email;
  return view.chats.flatMap((c) => c.members).find((m) => m.email === email)?.id ?? null;
}

function openModal(m) {
  view.modal = m;
  const host = el('frModal');
  host.querySelector('.fr-dialog').innerHTML = modalHtml(m);
  host.hidden = false;
  host.querySelector('input:not([type=radio]):not([type=checkbox])')?.focus();
}

function closeModal() {
  view.modal = null;
  el('frModal').hidden = true;
}

/* ───────────────────────── drawing and loading ───────────────────────── */

function draw() {
  const d = view.data;
  if (!d) return;
  el('frProfile').innerHTML = profileHtml(d);
  el('frRequests').innerHTML = requestsHtml(d);
  el('frRequests').hidden = !d.incoming.length && !d.outgoing.length;
  el('frCount').textContent = d.friends.length ? String(d.friends.length) : '';
  el('frList').innerHTML = friendsListHtml(d);
  el('frNote').textContent = view.note;
  drawChats();
  drawDetail();
}

function drawDetail() {
  el('frDetail').hidden = !view.friend;
  el('frDetail').innerHTML = detailHtml();
}

function drawChats() {
  el('frChats').innerHTML = chatsHtml();
  applyFolds();
  const box = el('frMsgs');
  if (box) box.scrollTop = box.scrollHeight;
}

async function openFriend(id) {
  view.friend = view.data.friends.find((f) => f.id === id) ?? null;
  drawDetail();
  el('frList').innerHTML = friendsListHtml(view.data);
  if (!view.friend) return;
  // On a phone the box opens below the list: bring it into view.
  if (matchMedia?.('(max-width:900px)').matches) el('frDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const share = await social.portfolio(id);
    if (view.friend?.id === id) el('frHoldings').innerHTML = holdingsHtml(share, nameOf(view.friend.email));
  } catch (err) {
    el('frHoldings').innerHTML = `<div class="fr-empty">${escapeHtml(err.message)}</div>`;
  }
}

async function load() {
  view.data = await social.friends();
  knowShowing(view.data.share?.mode);
  if (view.friend && !view.data.friends.some((f) => f.id === view.friend.id)) view.friend = null;
  view.chats = (await social.chats()).chats;
  if (view.chat) view.chat = view.chats.find((c) => c.id === view.chat.id) ?? null;
  draw();
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

/** The chat with one friend: made the first time, the same one after. */
async function openDirect(friendId) {
  const { id } = await social.direct(friendId);
  view.chats = (await social.chats()).chats;
  await openChat(id);
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
    if (box) box.innerHTML = messagesHtml(view.messages, view.chat.kind !== 'direct');
    if (box && atBottom) box.scrollTop = box.scrollHeight;
  } catch { /* the next check tries again */ }
}

/** Back to the list, read again: what was just sent is its last message, and it moves to the top. */
async function closeChat() {
  clearInterval(chatTimer);
  view.chat = null;
  view.messages = [];
  drawChats();
  try {
    view.chats = (await social.chats()).chats;
    if (!view.chat) drawChats();
  } catch { /* the list as it was */ }
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
    if (list) { list.innerHTML = messagesHtml(view.messages, view.chat.kind !== 'direct'); list.scrollTop = list.scrollHeight; }
  });
}

/* ───────────────────────── events ───────────────────────── */

/** Run an action; its own message, if it sets one, or the server's refusal shows under the add box. */
async function act(fn) {
  view.note = '';
  try {
    await fn();
  } catch (err) {
    view.note = err.message;
    if (view.modal) {
      const foot = el('frModal').querySelector('.fr-dfoot');
      foot?.insertAdjacentHTML('beforebegin', `<div class="fr-note fr-err">${escapeHtml(err.message)}</div>`);
    }
  }
  el('frNote').textContent = view.note;
}

function picked() {
  return [...el('frModal').querySelectorAll('#frPick input[type=checkbox]:checked')].map((b) => b.value);
}

function onModalClick(e) {
  const t = (sel) => e.target.closest(sel);
  const m = view.modal;
  if (e.target === el('frModal') || t('[data-close]')) return closeModal();
  if (t('[data-save-profile]')) {
    const mode = el('frModal').querySelector('input[name=frShow]:checked')?.value ?? 'none';
    return act(async () => { await setShowing(mode); closeModal(); await load(); });
  }
  if (t('[data-group-next]')) {
    const name = el('frGroupName').value.trim();
    if (!name) { el('frGroupName').focus(); return undefined; }
    return openModal({ type: 'groupFriends', name, members: m.members ?? [] });
  }
  if (t('[data-group-back]')) return openModal({ type: 'groupName', name: m.name, members: picked() });
  if (t('[data-group-create]')) {
    const members = picked();
    return act(async () => {
      const made = await social.createChat(m.name, members);
      closeModal();
      view.chats = (await social.chats()).chats;
      await openChat(made.id);
    });
  }
  if (t('[data-save-members]')) {
    const want = new Set(picked());
    const now = view.chat.members.map((x) => x.id).filter((id) => id !== currentUserId());
    const add = [...want].filter((id) => !now.includes(id));
    const remove = now.filter((id) => !want.has(id));
    return act(async () => {
      await social.members(view.chat.id, add, remove);
      closeModal();
      view.chats = (await social.chats()).chats;
      view.chat = view.chats.find((c) => c.id === view.chat.id) ?? null;
      drawChats();
    });
  }
  return undefined;
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

  el('frModal').addEventListener('click', onModalClick);
  el('frModal').addEventListener('change', (e) => {
    // The preview follows the choice before it is saved.
    if (e.target.name === 'frShow') openModal({ type: 'profile', mode: e.target.value });
  });
  el('frModal').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'frGroupName') { e.preventDefault(); el('frModal').querySelector('[data-group-next]')?.click(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && view.modal) closeModal(); });

  page.addEventListener('click', (e) => {
    if (e.target.closest('#frModal')) return undefined;
    const t = (sel) => e.target.closest(sel);
    if (t('[data-fold]')) return toggleFold(t('[data-fold]').closest('.card'));
    if (t('[data-close-friend]')) {
      view.friend = null;
      drawDetail();
      el('frList').innerHTML = friendsListHtml(view.data);
      return undefined;
    }
    if (t('[data-modal]')) {
      const type = t('[data-modal]').dataset.modal;
      return openModal({ type });
    }
    if (t('[data-dm]')) return act(() => openDirect(t('[data-dm]').dataset.dm));
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
    if (t('[data-chat]')) return openChat(t('[data-chat]').dataset.chat);
    if (t('[data-back]')) return closeChat();
    if (t('[data-leave]') && confirm(`Leave ${view.chat?.name}? Its messages stay for the others.`)) {
      return act(async () => { await social.leave(view.chat.id); closeChat(); view.chats = (await social.chats()).chats; drawChats(); });
    }
    return undefined;
  });

  page.addEventListener('keydown', (e) => {
    if (e.target.id === 'frText' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCurrent(); }
    // A friend row opens with the keyboard as with the mouse.
    if (e.key === 'Enter' && e.target.matches?.('.fr-row[data-friend]')) openFriend(e.target.dataset.friend);
  });
  page.addEventListener('submit', (e) => {
    if (e.target.id === 'frSend') { e.preventDefault(); sendCurrent(); }
  });

  document.addEventListener('visibilitychange', () => { if (onScreen()) pollChat(); });
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
  // Requests and new conversations, now and then, while the page is open.
  listTimer = setInterval(async () => {
    if (!onScreen() || view.chat || view.modal) return;
    try { await load(); } catch { /* next time */ }
  }, LIST_EVERY_MS);
}
