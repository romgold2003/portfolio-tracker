/**
 * The Clavis landing page (November 2026): what a first-time visitor sees
 * before the sign-in card. It sits in front of the lock screen, which is
 * already drawn underneath, so "Sign in" only has to step aside.
 *
 * Shown once per device: after the first real sign-in this browser goes
 * straight to the sign-in card, as a returning user expects. Guests and
 * visitors who leave without signing in see it again next time.
 *
 * No numbers here are anyone's: the phone in the hero shows the demo
 * portfolio's kind of figures, drawn as markup.
 */
const SEEN_KEY = 'pt_landing_seen';

export function landingSeen() {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}

export function markLandingSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private window: shown again, which is harmless */ }
}

const MARK = (id) => `<svg class="ld-mark" viewBox="0 0 100 100" aria-hidden="true">
  <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F26A1E"/><stop offset="1" stop-color="#F59E0B"/></linearGradient></defs>
  <path d="M78 22 A38 38 0 1 0 78 78" fill="none" stroke="currentColor" stroke-width="15" stroke-linecap="round"/>
  <path d="M58 50 L83 25 A36 36 0 0 1 83 75 Z" fill="url(#${id})"/>
  <circle cx="58" cy="50" r="9.5" fill="url(#${id})"/><circle cx="58" cy="50" r="4.6" fill="var(--bg)"/>
  <path d="M61 47.6 L76 44 L76 56 L61 52.4 Z" fill="var(--bg)"/></svg>`;

const HOLDINGS = [
  ['NVDA', 'NVIDIA', '+4.2%', true],
  ['AVGO', 'Broadcom', '+1.8%', true],
  ['BTC', 'Bitcoin', '−0.9%', false],
  ['SPY', 'S&P 500 ETF', '+0.6%', true],
];

function phoneHtml() {
  const rows = HOLDINGS.map(([t, n, c, up]) => `<div class="ld-row">
      <span class="ld-tk">${t.slice(0, 1)}</span><span class="ld-nm"><b>${t}</b><i>${n}</i></span>
      <span class="ld-ch ${up ? 'up' : 'dn'}">${c}</span></div>`).join('');
  return `<div class="ld-phone" aria-hidden="true"><div class="ld-screen">
    <div class="ld-p-lbl">Account value</div>
    <div class="ld-p-val">$64,939<span>.65</span></div>
    <div class="ld-p-chg up">▲ $13,710 · +26.6% this year</div>
    <svg class="ld-spark" viewBox="0 0 300 90" preserveAspectRatio="none">
      <defs><linearGradient id="ldFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F26A1E" stop-opacity=".35"/><stop offset="1" stop-color="#F26A1E" stop-opacity="0"/></linearGradient></defs>
      <path d="M0 70 C30 64 40 72 70 60 S120 66 140 50 S190 56 210 38 S260 30 300 10 L300 90 L0 90 Z" fill="url(#ldFill)"/>
      <path d="M0 70 C30 64 40 72 70 60 S120 66 140 50 S190 56 210 38 S260 30 300 10" fill="none" stroke="#F59E0B" stroke-width="3"/>
    </svg>
    <div class="ld-vs"><span>You <b class="up">+26.6%</b></span><span>S&amp;P 500 <b>+8.3%</b></span></div>
    ${rows}
  </div></div>`;
}

const FEATURES = [
  ['📈', 'Your S&amp;P twin', 'Every trade set beside the same money in the S&amp;P 500, on the same days. See which ones beat the market, and by how much.'],
  ['🧠', 'A personal analyst', 'Plain words on what you do well and what is costing you: when you sell, how long you hold, how you trade in a falling market.'],
  ['🃏', 'Collect your trader card', 'A title for your style and about thirty achievements to collect, from surviving a bear market to doubling a trade.'],
];

function landingHtml() {
  const cards = FEATURES.map(([i, h, p]) => `<div class="ld-card"><span class="ld-ic">${i}</span><h3>${h}</h3><p>${p}</p></div>`).join('');
  return `
  <nav class="ld-nav">
    <div class="ld-brand">${MARK('ldGradNav')}<span>Clavis</span></div>
    <div class="ld-links"><a href="#ldFeatures">Features</a><a href="#ldSecurity">Security</a></div>
    <div class="ld-actions">
      <button type="button" class="ld-btn ld-ghost" data-ld="signin">Sign in</button>
      <button type="button" class="ld-btn ld-primary" data-ld="create">Start free</button>
    </div>
  </nav>
  <section class="ld-hero">
    <div class="ld-copy">
      <span class="ld-pill">✦ Your personal trading analyst</span>
      <h1>The key to understanding <span class="ld-grad">how you invest.</span></h1>
      <p class="ld-lead">Import your broker in a minute. Clavis tracks every position, compares each trade with the S&amp;P 500, and tells you in plain words what you do well and what is costing you.</p>
      <div class="ld-cta">
        <button type="button" class="ld-btn ld-primary ld-big" data-ld="create">Start free</button>
        <button type="button" class="ld-btn ld-ghost ld-big" data-ld="demo">Try the demo</button>
      </div>
      <div class="ld-trust"><span>🔒 End-to-end encrypted journal</span><span>IBKR, Fidelity, Robinhood &amp; more</span><span>No ads, no tracking</span></div>
    </div>
    ${phoneHtml()}
  </section>
  <section class="ld-sec" id="ldFeatures">
    <div class="ld-kicker">What you get</div>
    <h2>Everything a broker app never tells you.</h2>
    <div class="ld-cards">${cards}</div>
  </section>
  <section class="ld-sec ld-safe" id="ldSecurity">
    <div class="ld-safe-mark">${MARK('ldGradSafe')}</div>
    <div>
      <div class="ld-kicker">Security</div>
      <h2>Only you hold the key.</h2>
      <p>Your journal is encrypted on your device before it is saved, with a key made from your password. We cannot read it, and we never sell your information.</p>
    </div>
  </section>
  <section class="ld-sec ld-final">
    <h2>Start in a minute. Free.</h2>
    <button type="button" class="ld-btn ld-primary ld-big" data-ld="create">Create your free account</button>
    <button type="button" class="ld-link" data-ld="demo">or explore the demo first →</button>
  </section>
  <footer class="ld-foot"><span>© ${new Date().getFullYear()} Clavis</span>
    <a href="assets/terms.html" target="_blank" rel="noopener">Terms</a>
    <a href="assets/privacy.html" target="_blank" rel="noopener">Privacy</a>
    <span class="ld-note">Tracking and information only, not investment advice.</span></footer>`;
}

/**
 * Put the page in front of the sign-in card. `go` is called with
 * 'signin', 'create' or 'demo' once the page has stepped aside.
 */
export function showLanding(go) {
  let page = document.getElementById('landing');
  if (!page) {
    page = document.createElement('div');
    page.id = 'landing';
    page.className = 'landing';
    document.body.append(page);
  }
  page.innerHTML = landingHtml();
  page.hidden = false;
  page.scrollTop = 0;
  document.body.classList.add('landing-open');
  page.querySelectorAll('[data-ld]').forEach((button) => {
    button.addEventListener('click', () => {
      hideLanding();
      go(button.dataset.ld);
    });
  });
  page.querySelectorAll('.ld-links a').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      page.querySelector(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth' });
    });
  });
}

export function hideLanding() {
  const page = document.getElementById('landing');
  if (page) { page.hidden = true; page.innerHTML = ''; }
  document.body.classList.remove('landing-open');
}
