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
import { FEATURES, PRICES, money } from '../../config/plans.js';

const SEEN_KEY = 'pt_landing_seen';

export function landingSeen() {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}

const REF_KEY = 'pt_ref';

/** A code from an invite link (?ref=CODE), kept until the sign-up uses it; the link is tidied. True when one arrived now. */
export function rememberReferral() {
  try {
    const url = new URL(window.location.href);
    const code = (url.searchParams.get('ref') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
    if (!code) return false;
    localStorage.setItem(REF_KEY, code);
    url.searchParams.delete('ref');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    return true;
  } catch { return false; }
}

export function storedReferral() {
  try { return localStorage.getItem(REF_KEY) ?? ''; } catch { return ''; }
}

export function forgetReferral() {
  try { localStorage.removeItem(REF_KEY); } catch { /* nothing kept */ }
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

/** The C-keyhole's shapes on a 100 grid, for drawing it inside a picture. */
function logoPaths() {
  const id = `lpm${uid++}`;
  return `<defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="#F26A1E"/><stop offset="1" stop-color="#F59E0B"/></linearGradient></defs><path d="M78 22 A38 38 0 1 0 78 78" fill="none" stroke="#fff" stroke-width="15"/><path d="M58 50 L83 25 A36 36 0 0 1 83 75 Z" fill="url(#${id})"/><circle cx="58" cy="50" r="9.5" fill="url(#${id})"/><circle cx="58" cy="50" r="4.6" fill="#0B0F16"/><path d="M61 47.6 L76 44 L76 56 L61 52.4 Z" fill="#0B0F16"/>`;
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

const FONT = 'font-family="Inter,Segoe UI,sans-serif"';
const pill = (x, y, w, text, fg, bg, size = 12) => `<rect x="${x}" y="${y}" width="${w}" height="26" rx="13" fill="${bg}"/><text x="${x + w / 2}" y="${y + 17.5}" text-anchor="middle" font-size="${size}" font-weight="800" fill="${fg}" ${FONT}>${text}</text>`;

/** Each scene is 320 × 200. */
const SCENES = {
  /* Broker → file → Clavis: the way in. */
  flow: () => `
    <defs><linearGradient id="lpfl" x1="0" x2="1"><stop offset="0" stop-color="#3A4456"/><stop offset="1" stop-color="#F26A1E"/></linearGradient></defs>
    <g transform="translate(22 52)">
      <rect width="84" height="96" rx="16" fill="#0E131C" stroke="#2A3242" stroke-width="2"/>
      <path d="M18 40 L42 24 L66 40 Z" fill="#3A4456"/><rect x="20" y="44" width="44" height="5" rx="2" fill="#3A4456"/>
      <path d="M26 52 V70 M37 52 V70 M48 52 V70 M59 52 V70" stroke="#3A4456" stroke-width="5" stroke-linecap="round"/>
      <rect x="18" y="74" width="48" height="6" rx="2" fill="#3A4456"/>
    </g>
    <text x="64" y="170" text-anchor="middle" font-size="12" font-weight="700" fill="#6B7584" ${FONT}>Your broker</text>
    <path d="M114 100 C 140 84 178 84 204 100" fill="none" stroke="url(#lpfl)" stroke-width="3" stroke-dasharray="2 9" stroke-linecap="round"/>
    <path d="M198 92 L208 101 L196 106" fill="none" stroke="#F26A1E" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <g transform="translate(142 58) rotate(-8)">
      <rect width="36" height="44" rx="6" fill="#E9ECF1"/><path d="M8 12 H28 M8 20 H28 M8 28 H22" stroke="#8A93A3" stroke-width="3" stroke-linecap="round"/>
      <rect x="4" y="32" width="28" height="10" rx="3" fill="#F26A1E"/><text x="18" y="40" text-anchor="middle" font-size="7.5" font-weight="800" fill="#0B0F16" ${FONT}>CSV</text>
    </g>
    <g transform="translate(214 52)">
      <rect width="96" height="96" rx="24" fill="#0B0F16" stroke="#5A3214" stroke-width="2"/>
      <g transform="translate(14 14) scale(.68)">${logoPaths()}</g>
    </g>
    <text x="262" y="170" text-anchor="middle" font-size="12" font-weight="700" fill="#F59E0B" ${FONT}>Clavis</text>`,
  /* You against the S&P 500: two lines, yours above. */
  compare: () => `
    <defs>
      <linearGradient id="lpyou" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2BD576" stop-opacity=".32"/><stop offset="1" stop-color="#2BD576" stop-opacity="0"/></linearGradient>
    </defs>
    <path d="M24 60 H296 M24 100 H296 M24 140 H296" stroke="#141A24" stroke-width="1"/>
    <path d="M24 162 C 64 156 90 150 120 140 S 180 118 220 100 S 270 70 296 52 L296 176 L24 176 Z" fill="url(#lpyou)"/>
    <path d="M24 164 C 70 160 100 156 130 150 S 200 138 240 130 S 280 124 296 120" fill="none" stroke="#7D8696" stroke-width="3" stroke-dasharray="1 7" stroke-linecap="round"/>
    <path d="M24 162 C 64 156 90 150 120 140 S 180 118 220 100 S 270 70 296 52" fill="none" stroke="#2BD576" stroke-width="3.5" stroke-linecap="round"/>
    <circle cx="296" cy="52" r="6" fill="#2BD576"/><circle cx="296" cy="52" r="12" fill="#2BD576" opacity=".18"/>
    <circle cx="296" cy="120" r="5" fill="#7D8696"/>
    ${pill(206, 18, 78, 'You +27.1%', '#2BD576', 'rgba(43,213,118,.15)')}
    ${pill(206, 132, 78, 'S&amp;P +8.3%', '#A3ACB9', '#1A1F2A')}`,
  /* The analyst: the fox among the things it reads. */
  learn: () => `
    ${pill(150, 22, 104, 'Hold time · 18d', '#A3ACB9', '#1A1F2A', 11)}
    ${pill(176, 58, 116, 'Exits well timed ✓', '#2BD576', 'rgba(43,213,118,.15)', 11)}
    ${pill(160, 94, 110, 'State of mind · 8', '#F59E0B', 'rgba(245,158,11,.14)', 11)}
    ${pill(184, 130, 98, 'Best day · Tue', '#A3ACB9', '#1A1F2A', 11)}
    ${pill(150, 166, 128, 'After you sold −3.5%', '#A3ACB9', '#1A1F2A', 11)}
    ${fox(14, 40, 0.68)}`,
  crypto: () => `
    <defs><linearGradient id="lpsol" x1="0" x2="1"><stop offset="0" stop-color="#00FFA3"/><stop offset="1" stop-color="#DC1FFF"/></linearGradient></defs>
    <g><circle cx="96" cy="62" r="34" fill="#F7931A"/><text x="96" y="75" text-anchor="middle" font-size="38" font-weight="800" fill="#fff" ${FONT}>₿</text></g>
    <g><circle cx="224" cy="62" r="34" fill="#262B45"/><path d="M224 38 L238 63 L224 71 L210 63 Z" fill="#B7C3FF"/><path d="M224 75 L238 67 L224 88 L210 67 Z" fill="#8C9EFF"/></g>
    <g><circle cx="96" cy="146" r="34" fill="#121521"/><path d="M78 133 H110 L103 139 H71 Z M71 143 H103 L110 149 H78 Z M78 153 H110 L103 159 H71 Z" fill="url(#lpsol)"/></g>
    <g><circle cx="224" cy="146" r="34" fill="#23292F"/><path d="M206 128 L216 128 L224 137 L232 128 L242 128 L229 141 Q224 146 219 141 Z M206 164 L216 164 L224 155 L232 164 L242 164 L229 151 Q224 146 219 151 Z" fill="#E9ECF1"/></g>
    ${spark(160, 104, 9)}${spark(296, 30, 6, '#F5F7FA')}`,
  news: () => `
    <g transform="translate(16 18)">
      <rect width="150" height="78" rx="16" fill="#0E131C" stroke="#1F3A8A" stroke-width="2"/>
      <rect x="12" y="12" width="22" height="22" rx="6" fill="#2E5CFF"/><path d="M18 18 H28 V28 L18 23 Z" fill="#fff"/>
      <text x="42" y="28" font-size="12" font-weight="800" fill="#F5F7FA" ${FONT}>Polymarket</text>
      <circle cx="136" cy="23" r="4" fill="#2BD576"/>
      <text x="12" y="56" font-size="10.5" fill="#A3ACB9" ${FONT}>Fed cuts in December?</text>
      <rect x="12" y="62" width="126" height="6" rx="3" fill="#1A1F2A"/><rect x="12" y="62" width="78" height="6" rx="3" fill="#2E5CFF"/>
    </g>
    <g transform="translate(16 110)">
      <rect width="120" height="72" rx="16" fill="#0E131C" stroke="#2A3242" stroke-width="2"/>
      <text x="14" y="26" font-size="11" font-weight="700" fill="#A3ACB9" ${FONT}>Interest rate</text>
      <text x="14" y="56" font-size="26" font-weight="800" fill="#F5F7FA" ${FONT}>%</text>
      <path d="M48 52 L66 40 L82 46 L104 28" fill="none" stroke="#F59E0B" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <g transform="translate(182 18)">
      <rect width="122" height="164" rx="16" fill="#0E131C" stroke="#2A3242" stroke-width="2"/>
      <text x="14" y="26" font-size="11" font-weight="700" fill="#A3ACB9" ${FONT}>Earnings</text>
      <rect x="20" y="66" width="20" height="72" rx="5" fill="#2A3242"/><rect x="44" y="52" width="20" height="86" rx="5" fill="#2BD576"/>
      <rect x="74" y="88" width="20" height="50" rx="5" fill="#2A3242"/><rect x="98" y="78" width="12" height="60" rx="4" fill="#2BD576"/>
      <text x="42" y="154" text-anchor="middle" font-size="10" font-weight="700" fill="#6B7584" ${FONT}>Revenue</text>
      <text x="92" y="154" text-anchor="middle" font-size="10" font-weight="700" fill="#6B7584" ${FONT}>EPS</text>
    </g>`,
  friends: () => `
    <rect x="128" y="20" width="74" height="34" rx="17" fill="#0E131C" stroke="#2A3242" stroke-width="2"/><text x="165" y="42" text-anchor="middle" font-size="13" font-weight="800" fill="#2BD576" ${FONT}>+12%</text>
    <rect x="200" y="62" width="58" height="30" rx="15" fill="#2A170A"/><text x="229" y="82" text-anchor="middle" font-size="13" font-weight="800" fill="#F59E0B" ${FONT}>👋</text>
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
  ['flow', 'Bring your investments in, the easy way', [
    'Add your positions by hand in a few seconds, or import the file your broker gives you: a CSV or Excel export from Interactive Brokers, Robinhood, eToro, Schwab and 20+ others.',
    'When something changes, import the new file again or edit the position by hand. We never ask for your broker password.',
  ]],
  ['compare', 'See if you are beating the market', [
    'Clavis puts your account next to the S&amp;P 500, the benchmark most investors are measured against, with the same money on the same days.',
    'You see in % and in $ whether your choices are paying off, or whether an index fund would have done better.',
  ]],
  ['learn', 'Get feedback on how you invest', [
    'Clavis analyses your trades from every angle: how long you hold, when you sell and what the stock did afterwards, how you felt when you bought, which days work best.',
    'Then it tells you in plain words what you do well and what is worth a second look.',
  ]],
];

const MORE = [
  ['crypto', 'Crypto', 'Bitcoin, Ethereum, Solana, XRP and more, priced live. Follow the big whale moves and the ETF flows, and keep your crypto next to your stocks.'],
  ['news', 'Markets &amp; news', 'Live prediction odds from Polymarket, the Fed’s next interest-rate decision, company earnings with revenue and EPS against forecasts, and the economic calendar.'],
  ['friends', 'Friends', 'Add friends, chat and make groups. See how they invest in % or in $, and choose exactly what you share, or share nothing.'],
  ['card', 'Trader card', 'Earn a title for your style and collect about thirty achievements as you go. Just for fun: no ranking, no competition.'],
];

const NUMBERS = ['Return in %', 'Gain in $', 'Every month', 'Every position', 'Every day', 'vs the S&amp;P 500'];

const FAQ = [
  ['Is it free?', 'Yes. Clavis Free keeps your Home, positions, new trades, imports and friends, for free, for good. Clavis Pro adds Insights, Monthly, daily returns, News and Crypto for $3.50 a month or $35 a year. Every new account gets its first month of Pro free, with no credit card.'],
  ['Can I cancel Pro?', 'Anytime, in your profile under Plan and subscription. You keep Pro until the end of the period you paid for, then move to Free. Nothing you added is deleted.'],
  ['Can you see my money or trades?', 'No. Your journal is encrypted on your device with a key made from your password. We cannot read it.'],
  ['Do you need my broker password?', 'Never. You type your trades, or import a file you download from your broker yourself.'],
  ['Which brokers work?', 'Interactive Brokers, Robinhood, Schwab, Fidelity, eToro, Trading 212, DEGIRO, Revolut, Israeli banks and more, plus any CSV or Excel file.'],
  ['How do I keep it up to date?', 'Import your broker’s newest file whenever you like, or add and edit trades by hand. Prices update on their own.'],
  ['Is this investment advice?', 'No. Clavis shows information about your own trades. It never tells you what to buy or sell.'],
  ['Can I invite friends?', 'Yes: give a month, get a month. Every member has a referral code for life, in their profile. A friend who joins with it gets 2 months free instead of 1, and you get a free month when they pay their first month, up to six free months a year.'],
  ['Does it work on my phone?', 'Yes, in your phone’s browser on iPhone and Android.'],
];

/** The Free and Pro table, with the price on top of each column. */
function plansTableHtml() {
  const tick = (on) => (on ? '<span class="cmp-yes" aria-label="Included">✓</span>' : '<span class="cmp-no" aria-label="Not included">—</span>');
  return `<div class="lp-plans-wrap"><table class="cmp lp-cmp">
      <thead><tr><th></th>
        <th><div class="cmp-name">Free</div><div class="cmp-price">$0</div><div class="cmp-per">forever</div></th>
        <th class="cmp-pro"><div class="cmp-name">Pro</div><div class="cmp-price">${money(PRICES.monthly)}</div><div class="cmp-per">a month, or ${money(PRICES.yearly)} a year</div></th></tr></thead>
      <tbody>${FEATURES.map(([t, free, pro]) => `<tr><td>${t.replace('&', '&amp;')}</td><td>${tick(free)}</td><td class="cmp-pro">${tick(pro)}</td></tr>`).join('')}</tbody>
    </table></div>`;
}

const step = ([art, title, lines], i) => `<div class="lp-row${i % 2 ? ' lp-flip' : ''}">
    ${scene(art)}
    <div class="lp-row-txt"><span class="lp-num">${i + 1}</span><h3>${title}</h3>${lines.map((l) => `<p>${l}</p>`).join('')}</div>
  </div>`;
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
      <h1>All your investments in one place.<br><span class="lp-grad">Every number you need.</span></h1>
      <p class="lp-lead">Your return in % and in $, month by month and position by position, and at a glance whether you are beating the S&amp;P 500. No spreadsheets, no guessing.</p>
      <div class="lp-cta">${heroCta}</div>
      ${inApp ? '' : '<div class="lp-fine">1 month free · No credit card · Cancel anytime</div>'}
      <!-- The video goes here once it is made; the frame stays empty until then. -->
      <div class="lp-video" aria-label="Video coming soon"></div>
      <div class="lp-numbers">${NUMBERS.map((n) => `<span>${n}</span>`).join('')}</div>
    </div>
  </header>

  <section class="lp-sec"><div class="lp-in">
    <h2>How it works</h2>
    <p class="lp-sub">Three steps, a few minutes, and your whole portfolio finally makes sense.</p>
    <div class="lp-rows">${STEPS.map(step).join('')}</div>
  </div></section>

  <section class="lp-sec"><div class="lp-in">
    <h2>Everything in one place</h2>
    <p class="lp-sub">Your portfolio, the markets and your friends, in one app.</p>
    <div class="lp-grid lp-four">${MORE.map(card).join('')}</div>
  </div></section>

  <section class="lp-sec"><div class="lp-in">
    <div class="lp-safe">${logo(72)}<div><h2>Only you hold the key.</h2><p>Your journal is encrypted on your device with a key made from your password. We store it, but we cannot read it. We never ask for your broker login, and we never sell your information.</p></div></div>
  </div></section>

  ${inApp ? '' : `<section class="lp-sec"><div class="lp-in lp-center">
    <h2>Free, or Pro</h2>
    <p class="lp-sub">Clavis is free to use. Pro adds your analyst and the markets. Every new account starts with a month of Pro, free, no credit card.</p>
    ${plansTableHtml()}
    <button type="button" class="lp-btn lp-pri lp-big" data-ld="create">Start free, with a month of Pro</button>
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
