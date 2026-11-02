/** The single floating message: a withdrawal made, an account created, a change refused. */
let timer = null;

export function showToast(message, type = '', durationMs = 2500) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = `toast show ${type}`.trim();
  clearTimeout(timer);
  timer = setTimeout(() => { el.className = 'toast'; }, durationMs);
}
