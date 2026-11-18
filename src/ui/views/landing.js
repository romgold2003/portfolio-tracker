/**
 * The Clavis landing page (November 2026): what a first-time visitor sees
 * before the sign-in card, and what the logo in the app opens.
 *
 * Kept deliberately short (Romy: "very simple, not too much text, nothing
 * that scares the user"): a headline, the video frame, then each feature as a
 * small picture of the fox with one line under it. The C-keyhole logo is the
 * face of the company; the fox is only ever a guide, never beside money
 * movement, security or pricing (the brand brief).
 *
 * In front of the sign-in card it is shown once per device: after the first
 * real sign-in this browser goes straight to the card. From inside the app it
 * opens on request and closes back to the account.
 */
const SEEN_KEY = 'pt_landing_seen';

export function landingSeen() {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}

export function markLandingSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private window: shown again, which is harmless */ }
}

/* ── Drawings ──────────────────────────────────────────────────────────── */

let uid = 0;

/** The company mark: the C with the keyhole. Never the fox. */
function logo(size = 30) {
  const id = `lpl${uid++}`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="#F26A1E"/><stop offset="1" stop-color="#F59E0B"/></linearGradient></defs><path d="M78 22 A38 38 0 1 0 78 78" fill="none" stroke="#fff" stroke-width="15"/><path d="M58 50 L83 25 A36 36 0 0 1 83 75 Z" fill="url(#${id})"/><circle cx="58" cy="50" r="9.5" fill="url(#${id})"/><circle cx="58" cy="50" r="4.6" fill="#05070B"/><path d="M61 47.6 L76 44 L76 56 L61 52.4 Z" fill="#05070B"/></svg>`;
}

/** The fox's head on a 200 grid, placed at (x, y) and scaled: one white line, the keyhole in orange. */
function fox(x, y, s = 0.5, { line = '#F5F7FA', eyes = line } = {}) {
  const id = `lpf${uid++}`;
  const w = 8;
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F59E0B"/><stop offset="1" stop-color="#F26A1E"/></linearGradient></defs>
    <path d="M50 20 L82 54 L118 54 L150 20 L158 80 L168 110 L136 126 L110 154 L100 162 L90 154 L64 126 L32 110 L42 80 Z" fill="#05070B" stroke="${line}" stroke-width="${w}"/>
    <path d="M32 110 Q62 106 80 118 L100 138 L120 118 Q138 106 168 110" stroke="${line}" stroke-width="${w * 0.6}" opacity=".55"/>
    <path d="M64 88 L84 95" stroke="${eyes}" stroke-width="${w * 0.9}"/><path d="M136 88 L116 95" stroke="${eyes}" stroke-width="${w * 0.9}"/>
    <path d="M95 149 L105 149 L100 156 Z" fill="${line}" stroke="${line}" stroke-width="3"/>
    <path d="M98 72.6 A5 5 0 1 1 102 72.6 L104 82 L96 82 Z" stroke="url(#${id})" stroke-width="${w * 0.6}"/>
  </g>`;
}

const spark = (x, y, r = 7, c = '#F59E0B') => `<path d="M${x} ${y - r} L${x + r * 0.28} ${y - r * 0.28} L${x + r} ${y} L${x + r * 0.28} ${y + r * 0.28} L${x} ${y + r} L${x - r * 0.28} ${y + r * 0.28} L${x - r} ${y} L${x - r * 0.28} ${y - r * 0.28} Z" fill="${c}"/>`;

/** Each scene is 320 × 200. */
const SCENES = {
  add: () => `
    <rect x="186" y="44" width="78" height="100" rx="10" fill="#0E131C" stroke="#2A3242" stroke-width="2"/>
    <path d="M200 70 H250 M200 86 H250 M200 102 H236" stroke="#3A4456" stroke-width="5" stroke-linecap="round"/>
    <rect x="200" y="116" width="40" height="18" rx="6" fill="#F26A1E"/><text x="220" y="129" text-anchor="middle" font-size="11" font-weight="800" fill="#0B0F16" font-family="Inter,Segoe UI,sans-serif">CSV</text>
    <path d="M262 150 L292 120 L300 128 L270 158 L258 162 Z" fill="#F59E0B"/>
    ${fox(56, 26, 0.72)}${spark(282, 52, 8)}`,
  market: () => `
    <path d="M150 156 H300" stroke="#1E2633" stroke-width="2"/>
    <path d="M154 146 C 180 140 196 134 214 122 S 252 108 296 100" fill="none" stroke="#6B7584" stroke-width="5" stroke-linecap="round"/>
    <path d="M154 146 C 178 132 194 120 214 96 S 256 62 296 44" fill="none" stroke="#2BD576" stroke-width="6" stroke-linecap="round"/>
    <circle cx="296" cy="44" r="7" fill="#2BD576"/>
    <rect x="236" y="112" width="54" height="22" rx="11" fill="#1A1F2A"/><text x="263" y="127" text-anchor="middle" font-size="11" font-weight="700" fill="#A3ACB9" font-family="Inter,Segoe UI,sans-serif">S&amp;P</text>
    <rect x="228" y="16" width="56" height="22" rx="11" fill="rgba(43,213,118,.16)"/><text x="256" y="31" text-anchor="middle" font-size="11" font-weight="800" fill="#2BD576" font-family="Inter,Segoe UI,sans-serif">You</text>
    ${fox(20, 30, 0.7)}`,
  learn: () => `
    <rect x="176" y="36" width="128" height="88" rx="18" fill="#0E131C" stroke="#2A3242" stroke-width="2"/>
    <path d="M176 92 L158 110 L184 104 Z" fill="#0E131C" stroke="#2A3242" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="198" cy="62" r="8" fill="rgba(43,213,118,.18)"/><path d="M194 62 L197 65 L203 58" stroke="#2BD576" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M214 62 H284" stroke="#3A4456" stroke-width="5" stroke-linecap="round"/>
    <circle cx="198" cy="94" r="8" fill="rgba(245,165,36,.18)"/><path d="M198 89 V95 M198 99 V99.5" stroke="#F5A524" stroke-width="3" stroke-linecap="round"/>
    <path d="M214 94 H268" stroke="#3A4456" stroke-width="5" stroke-linecap="round"/>
    ${fox(22, 40, 0.7)}${spark(300, 150, 7)}`,
  crypto: () => `
    <g><circle cx="70" cy="58" r="30" fill="#F7931A"/><text x="70" y="70" text-anchor="middle" font-size="34" font-weight="800" fill="#fff" font-family="Inter,Segoe UI,sans-serif">₿</text></g>
    <g><circle cx="256" cy="54" r="28" fill="#262B45"/><path d="M256 34 L268 55 L256 62 L244 55 Z" fill="#B7C3FF"/><path d="M256 65 L268 58 L256 75 L244 58 Z" fill="#8C9EFF"/></g>
    <g><circle cx="262" cy="142" r="26" fill="#121521"/><defs><linearGradient id="lpsol" x1="0" x2="1"><stop offset="0" stop-color="#00FFA3"/><stop offset="1" stop-color="#DC1FFF"/></linearGradient></defs>
      <path d="M248 132 H274 L268 137 H242 Z M242 140 H268 L274 145 H248 Z M248 148 H274 L268 153 H242 Z" fill="url(#lpsol)"/></g>
    ${fox(102, 38, 0.72)}${spark(40, 140, 7)}${spark(300, 96, 6, '#F5F7FA')}`,
  news: () => `
    <g><rect x="34" y="70" width="58" height="80" rx="10" fill="#1E2633"/><rect x="34" y="88" width="58" height="7" fill="#F26A1E"/><rect x="34" y="126" width="58" height="7" fill="#F26A1E"/>
      <path d="M63 103 C 57 111 57 117 63 119 C 69 117 69 111 63 103 Z" fill="#05070B"/></g>
    <defs><linearGradient id="lpgold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE29A"/><stop offset="1" stop-color="#E0A526"/></linearGradient></defs>
    <path d="M232 148 L240 128 H288 L296 148 Z" fill="url(#lpgold)"/><path d="M252 128 L260 108 H300 L306 128 Z" fill="url(#lpgold)" opacity=".85"/><path d="M212 148 L220 128 H236 L228 148 Z" fill="url(#lpgold)" opacity=".7"/>
    <rect x="236" y="34" width="66" height="54" rx="8" fill="#E9ECF1"/><path d="M246 48 H292 M246 60 H292 M246 72 H276" stroke="#8A93A3" stroke-width="5" stroke-linecap="round"/>
    ${fox(104, 30, 0.7)}`,
  friends: () => `
    <rect x="128" y="20" width="74" height="34" rx="17" fill="#0E131C" stroke="#2A3242" stroke-width="2"/><text x="165" y="42" text-anchor="middle" font-size="13" font-weight="800" fill="#2BD576" font-family="Inter,Segoe UI,sans-serif">+12%</text>
    <rect x="200" y="62" width="58" height="30" rx="15" fill="#2A170A"/><text x="229" y="82" text-anchor="middle" font-size="13" font-weight="800" fill="#F59E0B" font-family="Inter,Segoe UI,sans-serif">👋</text>
    ${fox(36, 52, 0.62)}${fox(196, 84, 0.52, { line: '#F59E0B' })}`,
  card: () => `
    <rect x="178" y="30" width="104" height="140" rx="16" fill="#140D07" stroke="#5A3214" stroke-width="2"/>
    <circle cx="230" cy="82" r="24" fill="none" stroke="#F59E0B" stroke-width="5"/><path d="M220 106 L214 132 L230 124 L246 132 L240 106" fill="#F26A1E"/>
    <path d="M222 82 L228 88 L240 76" stroke="#F5F7FA" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M196 150 H264" stroke="#5A3214" stroke-width="5" stroke-linecap="round"/>
    ${fox(28, 36, 0.7)}${spark(300, 34, 8)}${spark(166, 160, 6, '#F5F7FA')}`,
};

const scene = (name) => `<svg class="lp-art" viewBox="0 0 320 200" aria-hidden="true">${SCENES[name]()}</svg>`;

/* ── The page ──────────────────────────────────────────────────────────── */

const STEPS = [
  ['add', 'Add your investments', 'Type a trade, or drop in the file from your broker.'],
  ['market', 'See if you beat the market', 'Every trade next to the same money in the S&amp;P 500.'],
  ['learn', 'Clavis explains it', 'What you do well, and what to improve. In plain words.'],
];

const MORE = [
  ['crypto', 'Crypto', 'Whale moves, ETF flows and your crypto journal.'],
  ['news', 'Markets &amp; news', 'Oil, gold, the Fed and earnings, in one place.'],
  ['friends', 'Friends', 'Share in % or $, or nothing at all. Chat and compare.'],
  ['card', 'Trader card', 'Collect achievements. Just for fun, no ranking.'],
];

const FAQ = [
  ['Is it free?', 'Your first month is free, with everything included and no credit card. After that it is $3.50 a month, or $35 a year.'],
  ['Can you see my money or trades?', 'No. Your journal is encrypted on your device with a key made from your password. We cannot read it.'],
  ['Do you need my broker password?', 'Never. You type your trades, or import a file you download from your broker yourself.'],
  ['Which brokers work?', 'Interactive Brokers, Robinhood, Schwab, Fidelity, eToro, Trading 212, DEGIRO, Revolut, Israeli banks and more, plus any CSV or Excel file.'],
  ['Is this investment advice?', 'No. Clavis shows information about your own trades. It never tells you what to buy or sell.'],
  ['Does it work on my phone?', 'Yes, in your phone’s browser on iPhone and Android.'],
];

const card = ([art, title, line]) => `<div class="lp-card">${scene(art)}<h3>${title}</h3><p>${line}</p></div>`;

function landingHtml(inApp) {
  const actions = inApp
    ? '<button type="button" class="lp-btn lp-pri" data-ld="back">Back to my account</button>'
    : '<button type="button" class="lp-btn lp-gho" data-ld="signin">Sign in</button><button type="button" class="lp-btn lp-pri" data-ld="create">Start free</button>';
  const heroCta = inApp
    ? '<button type="button" class="lp-btn lp-pri lp-big" data-ld="back">Back to my account</button>'
    : '<button type="button" class="lp-btn lp-pri lp-big" data-ld="create">Start your free month</button><button type="button" class="lp-btn lp-gho lp-big" data-ld="demo">Try the demo</button>';
  return `
  <nav class="lp-nav"><div class="lp-in">
    <div class="lp-brand">${logo(30)}<span>Clavis</span></div>
    <div class="lp-actions">${actions}</div>
  </div></nav>

  <header class="lp-hero" id="lpHero">
    <div class="lp-glow" aria-hidden="true"></div>
    <div class="lp-in lp-hero-in">
      <h1>Your investments,<br><span class="lp-grad">finally explained.</span></h1>
      <p class="lp-lead">Track everything. Compare with the market. Learn from your own trades.</p>
      <div class="lp-cta">${heroCta}</div>
      ${inApp ? '' : '<div class="lp-fine">1 month free · No credit card</div>'}
      <!-- The video goes here once it is made; the frame stays empty until then. -->
      <div class="lp-video" aria-label="Video coming soon"></div>
    </div>
  </header>

  <section class="lp-sec"><div class="lp-in">
    <h2>How it works</h2>
    <div class="lp-grid lp-three">${STEPS.map(card).join('')}</div>
  </div></section>

  <section class="lp-sec"><div class="lp-in">
    <h2>Everything in one place</h2>
    <div class="lp-grid lp-four">${MORE.map(card).join('')}</div>
  </div></section>

  <section class="lp-sec"><div class="lp-in">
    <div class="lp-safe">${logo(72)}<div><h2>Only you hold the key.</h2><p>Your data is encrypted on your device. We can't see it, and we never ask for your broker login.</p></div></div>
  </div></section>

  ${inApp ? '' : `<section class="lp-sec"><div class="lp-in lp-center">
    <h2>Simple pricing</h2>
    <div class="lp-price">
      <div class="lp-free">First month free · No credit card</div>
      <div class="lp-plans"><div><b>$3.50</b><span>per month</span></div><div class="lp-or">or</div><div><b>$35</b><span>per year · save $7</span></div></div>
      <button type="button" class="lp-btn lp-pri lp-big" data-ld="create">Start your free month</button>
    </div>
  </div></section>`}

  <section class="lp-sec"><div class="lp-in lp-narrow">
    <h2 class="lp-center">Questions</h2>
    <div class="lp-faq">${FAQ.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</div>
  </div></section>

  <footer class="lp-foot"><div class="lp-in">
    <span>© ${new Date().getFullYear()} Clavis</span>
    <a href="assets/terms.html" target="_blank" rel="noopener">Terms</a>
    <a href="assets/privacy.html" target="_blank" rel="noopener">Privacy</a>
    <span class="lp-note">Information only, not investment advice.</span>
  </div></footer>`;
}

/** The glow in the hero follows the pointer, gently. Nothing moves for people who asked for less motion. */
function followPointer(page) {
  const hero = page.querySelector('#lpHero');
  if (!hero || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    hero.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
    hero.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
  });
}

let onKey = null;

/**
 * Put the page up. `go` is called with what was pressed once the page has
 * stepped aside: 'signin', 'create' or 'demo' before signing in, 'back' from
 * inside the app.
 */
export function showLanding(go, { inApp = false } = {}) {
  let page = document.getElementById('landing');
  if (!page) {
    page = document.createElement('div');
    page.id = 'landing';
    page.className = 'landing';
    document.body.append(page);
  }
  page.innerHTML = landingHtml(inApp);
  page.hidden = false;
  page.scrollTop = 0;
  document.body.classList.add('landing-open');
  page.querySelectorAll('[data-ld]').forEach((button) => {
    button.addEventListener('click', () => {
      hideLanding();
      go(button.dataset.ld);
    });
  });
  followPointer(page);
  if (inApp) {
    onKey = (e) => { if (e.key === 'Escape') { hideLanding(); go('back'); } };
    document.addEventListener('keydown', onKey);
  }
}

export function hideLanding() {
  const page = document.getElementById('landing');
  if (page) { page.hidden = true; page.innerHTML = ''; }
  document.body.classList.remove('landing-open');
  if (onKey) { document.removeEventListener('keydown', onKey); onKey = null; }
}

/** The logo in the app's corner: the landing page, with the way back to the account. */
export function openLanding() {
  showLanding(() => {}, { inApp: true });
}
