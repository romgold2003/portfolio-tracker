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
