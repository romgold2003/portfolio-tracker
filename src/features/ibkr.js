/**
 * Read-only Interactive Brokers sync via the Client Portal Gateway.
 *
 * The gateway runs on the user's own machine; this module only ever issues GETs
 * for accounts and positions plus the keep-alive tickle. It never places orders
 * and never deletes a manually entered trade — IBKR-sourced positions are
 * tagged with `ibkrId` and only those are updated on sync.
 */
import { API, STORAGE_KEYS, TIMERS } from '../config/constants.js';
import { state, savePositions } from '../core/store.js';
import { newId } from '../core/positions.js';

let connected = false;
let syncTimer = null;
let gateway = API.ibkrDefaultGateway;

const el = (id) => document.getElementById(id);

function setStatus(message, color = 'var(--text3)') {
  const status = el('ibkrStatus');
  if (!status) return;
  status.textContent = message;
  status.style.color = color;
}

function setConnectedUi(isConnected) {
  el('ibkrBtn')?.classList.toggle('ibkr-on', isConnected);
  const label = el('ibkrBtnTxt');
  if (label) label.textContent = isConnected ? 'IBKR Live' : 'IBKR Connect';
  const disconnect = el('ibkrDisconnectBtn');
  const sync = el('ibkrSyncBtn');
  if (disconnect) disconnect.style.display = isConnected ? '' : 'none';
  if (sync) sync.style.display = isConnected ? '' : 'none';
}

export function openIbkr() {
  el('ibkrModal')?.classList.add('show');
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEYS.ibkrUrl); } catch { /* ignore */ }
  if (saved) el('ibkrUrl').value = saved;
}

export function closeIbkr() {
  el('ibkrModal')?.classList.remove('show');
}

export async function connectIbkr(onChange = () => {}) {
  gateway = (el('ibkrUrl')?.value || API.ibkrDefaultGateway).replace(/\/$/, '');
  setStatus('Connecting…', 'var(--amber)');
  try {
    // The tickle endpoint tells us both that the gateway is up and that the
    // user has completed the browser login it requires.
    const res = await fetch(`${gateway}/v1/api/tickle`, { method: 'POST', credentials: 'include' });
    if (!res.ok) throw new Error(`Gateway returned ${res.status}`);
    const json = await res.json();
    if (!json.iserver?.authStatus?.authenticated) {
      setStatus('Not authenticated — open https://localhost:5000 in Chrome and log in first', 'var(--red)');
      return;
    }

    connected = true;
    setConnectedUi(true);
    setStatus('✓ Connected — syncing positions…', 'var(--green)');
    try { localStorage.setItem(STORAGE_KEYS.ibkrUrl, gateway); } catch { /* ignore */ }

    await syncIbkr(onChange);
    clearInterval(syncTimer);
    syncTimer = setInterval(() => syncIbkr(onChange), TIMERS.ibkrSyncMs);
  } catch (err) {
    setStatus(`Cannot reach gateway — is it running? Error: ${err.message}`, 'var(--red)');
  }
}

/** IBKR asset classes mapped onto the three the app tracks. */
function classOf(assetClass) {
  if (assetClass === 'STK') return 'Stocks';
  if (assetClass === 'CRYPTO') return 'Crypto';
  return 'Commodities';
}

export async function syncIbkr(onChange = () => {}) {
  if (!connected) return;
  try {
    await fetch(`${gateway}/v1/api/tickle`, { method: 'POST', credentials: 'include' });

    const accountsRes = await fetch(`${gateway}/v1/api/portfolio/accounts`, { credentials: 'include' });
    if (!accountsRes.ok) throw new Error(`accounts ${accountsRes.status}`);
    const accounts = await accountsRes.json();
    if (!accounts?.length) return;

    const accountId = accounts[0].accountId;
    const positionsRes = await fetch(`${gateway}/v1/api/portfolio/${accountId}/positions/0`, { credentials: 'include' });
    if (!positionsRes.ok) throw new Error(`positions ${positionsRes.status}`);
    const remote = await positionsRes.json();

    let changed = false;
    for (const item of remote) {
      if (!item.ticker || item.position === 0) continue;
      const ticker = item.ticker.toUpperCase();
      const entry = item.avgCost || item.mktPrice || 0;
      const price = item.mktPrice || entry;
      const qty = Math.abs(item.position);

      const existing = state.positions.find((p) => p.ticker === ticker && p.status === 'Open' && p.ibkrId);
      if (existing) {
        existing.cur = price;
        existing.qty = qty;
      } else {
        state.positions.unshift({
          id: newId(),
          ticker,
          cls: classOf(item.assetClass),
          dir: item.position > 0 ? 'Long' : 'Short',
          open: new Date().toISOString().split('T')[0],
          close: null,
          entry,
          cur: price,
          qty,
          amount: entry * qty,
          status: 'Open',
          ibkrId: item.conid || ticker, // marks the row as IBKR-sourced
        });
      }
      changed = true;
    }

    if (changed) {
      savePositions();
      onChange();
    }
    setStatus(`✓ Synced ${new Date().toLocaleTimeString()}`, 'var(--green)');
  } catch (err) {
    setStatus(`Sync error: ${err.message} — re-authenticate at localhost:5000`, 'var(--amber)');
  }
}

export function disconnectIbkr() {
  connected = false;
  clearInterval(syncTimer);
  syncTimer = null;
  setConnectedUi(false);
  setStatus('Disconnected');
}
