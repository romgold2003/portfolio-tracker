/** The live-price settings modal (Finnhub API key). */
import { state } from '../../core/store.js';
import { benchmarkKey } from '../../services/benchmark.js';

const modal = () => document.getElementById('settingsModal');

export function openSettings() {
  const input = document.getElementById('apiKeyInput');
  if (input) input.value = state.apiKey;
  const bench = document.getElementById('benchKeyInput');
  if (bench) bench.value = benchmarkKey();
  modal()?.classList.add('show');
}

export function closeSettings() {
  modal()?.classList.remove('show');
}

export function readBenchKeyInput() {
  return document.getElementById('benchKeyInput')?.value.trim() ?? '';
}

export function readApiKeyInput() {
  return document.getElementById('apiKeyInput')?.value.trim() ?? '';
}
