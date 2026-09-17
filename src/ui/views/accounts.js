/**
 * The sub-account switcher, top left under the app name.
 *
 * One sign-in can keep several books apart — day trading in one, long-term
 * holdings in another — and see them together under All accounts. The button
 * names what is on screen; its menu switches, renames, adds and removes.
 */
import { subAccounts, ALL_ACCOUNTS } from '../../core/store.js';

const el = (id) => document.getElementById(id);

/** The name of what is on screen. */
export function activeAccountName() {
  const { accounts, activeId } = subAccounts();
  if (activeId === ALL_ACCOUNTS) return 'All accounts';
  return accounts.find((a) => a.id === activeId)?.name ?? 'Main account';
}

export function renderAccountSwitcher() {
  const name = el('acctName');
  const menu = el('acctMenu');
  if (!name || !menu) return;
  const { accounts, activeId } = subAccounts();
  name.textContent = activeAccountName();

  const rows = [];
  if (accounts.length > 1) {
    const row = document.createElement('div');
    row.className = `acct-row${activeId === ALL_ACCOUNTS ? ' is-active' : ''}`;
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'acct-pick';
    pick.setAttribute('role', 'menuitem');
    pick.setAttribute('onclick', `selectAccount('${ALL_ACCOUNTS}')`);
    pick.textContent = 'All accounts';
    const note = document.createElement('span');
    note.className = 'acct-note';
    note.textContent = 'combined';
    pick.append(note);
    row.append(pick);
    rows.push(row);
  }

  for (const account of accounts) {
    const row = document.createElement('div');
    row.className = `acct-row${account.id === activeId ? ' is-active' : ''}`;

    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'acct-pick';
    pick.setAttribute('role', 'menuitem');
    pick.setAttribute('onclick', `selectAccount('${account.id}')`);
    pick.textContent = account.name;

    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'acct-icon';
    rename.title = `Rename ${account.name}`;
    rename.setAttribute('aria-label', rename.title);
    rename.setAttribute('onclick', `renameAccount('${account.id}')`);
    rename.textContent = '✎';
    row.append(pick, rename);

    if (accounts.length > 1) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'acct-icon acct-remove';
      remove.title = `Remove ${account.name}`;
      remove.setAttribute('aria-label', remove.title);
      remove.setAttribute('onclick', `removeAccount('${account.id}')`);
      remove.textContent = '×';
      row.append(remove);
    }
    rows.push(row);
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'acct-add';
  add.setAttribute('onclick', 'addAccount()');
  add.textContent = '+ Add sub-account';
  rows.push(add);

  menu.replaceChildren(...rows);
}

export function setAccountMenuOpen(open) {
  const menu = el('acctMenu');
  const button = el('acctBtn');
  if (!menu || !button) return;
  menu.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
}

export function toggleAccountMenu() {
  const menu = el('acctMenu');
  if (!menu) return;
  if (menu.hidden) renderAccountSwitcher();
  setAccountMenuOpen(menu.hidden);
}

// A click anywhere else closes the menu.
document.addEventListener('click', (e) => {
  if (!e.target.closest?.('#acctSwitch')) setAccountMenuOpen(false);
});
