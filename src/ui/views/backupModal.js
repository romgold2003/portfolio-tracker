/**
 * The import dialog: pick a backup file or paste JSON, see what it contains,
 * then confirm the overwrite.
 */
import { parseBackup, describeBackup } from '../../features/backup.js';

const el = (id) => document.getElementById(id);

/** The backup currently staged for import, once it has parsed cleanly. */
let staged = null;

export function openImport() {
  staged = null;
  const text = el('importText');
  const file = el('importFile');
  if (text) text.value = '';
  if (file) file.value = '';
  setStatus('', '');
  setReady(false);
  showLegacySnippet();
  el('importModal')?.classList.add('show');
}

export function closeImport() {
  el('importModal')?.classList.remove('show');
}

function setStatus(message, color) {
  const status = el('importStatus');
  if (!status) return;
  status.textContent = message;
  status.style.color = color || 'var(--text3)';
}

function setReady(ready) {
  const button = el('importConfirmBtn');
  if (!button) return;
  button.disabled = !ready;
  button.style.opacity = ready ? '1' : '0.4';
  button.style.cursor = ready ? 'pointer' : 'not-allowed';
}

/** Validate whatever is in the textarea and stage it. */
export function previewImport() {
  const text = el('importText')?.value.trim();
  if (!text) {
    staged = null;
    setStatus('', '');
    setReady(false);
    return;
  }
  try {
    staged = parseBackup(text);
    setStatus(`✓ Found ${describeBackup(staged)}`, 'var(--green)');
    setReady(true);
  } catch (err) {
    staged = null;
    setStatus(err.message, 'var(--red)');
    setReady(false);
  }
}

/** Load a chosen file into the textarea, which then runs the preview. */
export function readImportFile(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const area = el('importText');
    if (area) area.value = String(reader.result);
    previewImport();
  };
  reader.onerror = () => setStatus('Could not read that file.', 'var(--red)');
  reader.readAsText(file);
}

export function stagedBackup() {
  return staged;
}

/**
 * Reads the four keys the pre-accounts version wrote and saves them as a backup
 * file. It has to run in the console of the old page itself: storage belongs to
 * the origin that wrote it, and no other page — not even another local file —
 * can reach it.
 *
 * Read-only by design, so it is safe to run repeatedly and leaves the old
 * journal untouched.
 */
export const LEGACY_SNIPPET = "(function(){var g=function(k,d){try{var v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}};var b={app:'portfolio-tracker',format:1,exportedAt:new Date().toISOString(),data:{positions:g('pt_pos',[]),cash:parseFloat(localStorage.getItem('pt_cash'))||0,snapshots:g('pt_snaps',[]),priceLog:g('pt_plog',{})}};var t=JSON.stringify(b,null,2);try{var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([t],{type:'application/json'}));a.download='portfolio-backup.json';a.click()}catch(e){}console.log('Positions found:',b.data.positions.length,'| Cash:',b.data.cash);return t})()";

/** Fill in the snippet once, the first time the help section is opened. */
export function showLegacySnippet() {
  const box = el('legacySnippet');
  if (box && !box.textContent) box.textContent = LEGACY_SNIPPET;
}

export function copyLegacySnippet() {
  showLegacySnippet();
  const note = el('legacyCopied');
  const done = (message) => { if (note) { note.textContent = message; setTimeout(() => { note.textContent = ''; }, 2500); } };

  const fallback = () => {
    const area = document.createElement('textarea');
    area.value = LEGACY_SNIPPET;
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); done('Copied'); }
    catch { done('Could not copy — select the text below instead'); }
    document.body.removeChild(area);
  };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(LEGACY_SNIPPET).then(() => done('Copied'), fallback);
  } else {
    fallback();
  }
}
