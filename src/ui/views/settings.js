/** The live-price settings modal (Finnhub API key). */
import { state } from '../../core/store.js';

const modal = () => document.getElementById('settingsModal');

export function openSettings() {
  const input = document.getElementById('apiKeyInput');
  if (input) input.value = state.apiKey;
  modal()?.classList.add('show');
}

export function closeSettings() {
  modal()?.classList.remove('show');
}

export function readApiKeyInput() {
  return document.getElementById('apiKeyInput')?.value.trim() ?? '';
}
