/** The single floating toast used for voice feedback. */
let timer = null;

export function showToast(message, type = '', durationMs = 2500) {
  const el = document.getElementById('voiceToast');
  if (!el) return;
  el.textContent = message;
  el.className = `voice-toast show ${type}`.trim();
  clearTimeout(timer);
  timer = setTimeout(() => { el.className = 'voice-toast'; }, durationMs);
}
