/**
 * The sign-in backdrop: a rotating globe of particles, ringed by orbiting
 * symbols of the things this app tracks.
 *
 * Written against the platform rather than pulled in as a component. The
 * original was React, Tailwind and a shadcn install away, which for one
 * decorative background would have cost this project its two best properties:
 * no build step, and a single file you can double-click. All of it is CSS
 * keyframes and about forty lines of canvas.
 *
 * The symbols are drawn inline as SVG rather than fetched. The app's own
 * content policy allows images only from itself, so anything remote would be
 * refused by the browser — and a sign-in screen that waits on a CDN to look
 * finished is a worse sign-in screen.
 *
 * Nothing here is announced: it is decoration, hidden from assistive tech, and
 * it stops entirely when someone would rather it did not move.
 */

/** Kept still for anyone who has asked for less motion. */
const STILL = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Symbols, not brands.
 *
 * Real broker marks were the ask, and the reasons against are practical: they
 * would have to be redrawn from memory and would come out subtly wrong, and
 * they are trademarks on a page that gets shared. What the account actually
 * holds says more anyway — an index, a currency, a chart.
 */
const SYMBOLS = {
  chartUp: '<path d="M3 17.5 9.5 11l3.5 3.5L21 6.5" /><path d="M15 6.5h6v6" />',
  candles: '<path d="M7 4v3M7 17v3M17 3v4M17 15v6" /><rect x="4.5" y="7" width="5" height="10" rx="1" /><rect x="14.5" y="7" width="5" height="8" rx="1" />',
  bitcoin: '<path d="M8 5v14M11.5 3.5v3M11.5 17.5v3M15 3.5v3M15 17.5v3" /><path d="M8 5h6.5a3.5 3.5 0 0 1 0 7H8m0 0h7a3.5 3.5 0 0 1 0 7H8" />',
  ether: '<path d="M12 2.5 5.5 12 12 15.5 18.5 12 12 2.5Z" /><path d="M5.5 13.5 12 21.5l6.5-8" />',
  dollar: '<path d="M12 2.5v19" /><path d="M16.5 6.5H9.75a3.25 3.25 0 0 0 0 6.5h4.5a3.25 3.25 0 0 1 0 6.5H7" />',
  coins: '<ellipse cx="12" cy="6.5" rx="7.5" ry="3.5" /><path d="M4.5 6.5v5c0 1.9 3.4 3.5 7.5 3.5s7.5-1.6 7.5-3.5v-5" /><path d="M4.5 11.5v5c0 1.9 3.4 3.5 7.5 3.5s7.5-1.6 7.5-3.5v-5" />',
  vault: '<rect x="3" y="4.5" width="18" height="15" rx="2" /><circle cx="12" cy="12" r="3.5" /><path d="M12 8.5v-1M12 16.5v1M15.5 12h1M7.5 12h-1" />',
  pie: '<path d="M12 3.5v8.5h8.5" /><circle cx="12" cy="12" r="8.5" />',
  percent: '<circle cx="7.5" cy="7.5" r="2.5" /><circle cx="16.5" cy="16.5" r="2.5" /><path d="M18.5 5.5 5.5 18.5" />',
};

/**
 * Three rings, turning alternately, each carrying a few symbols. Every symbol
 * is mirrored to its opposite side so the rings look balanced without needing
 * twice as many entries.
 */
const ORBITS = [
  { scale: 0.46, seconds: 34, icons: [['chartUp', -60], ['bitcoin', 0], ['percent', 60]] },
  { scale: 0.68, seconds: 46, icons: [['candles', 0], ['ether', -90]] },
  { scale: 0.94, seconds: 58, icons: [['pie', -55], ['dollar', 0], ['coins', 55], ['vault', 130]] },
];

const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${SYMBOLS[name]}</svg>`;

function buildOrbits(host) {
  host.innerHTML = ORBITS.map((orbit, ring) => {
    const clockwise = ring % 2 === 0;
    const spin = clockwise ? 'orbit-cw' : 'orbit-ccw';
    const unspin = clockwise ? 'orbit-counter-cw' : 'orbit-counter-ccw';

    const all = [...orbit.icons, ...orbit.icons.map(([n, a]) => [n, a + 180])];
    const badges = all.map(([name, angle]) => `
      <div class="orbit-arm" style="--start:${angle}deg;animation-name:${spin};animation-duration:${orbit.seconds}s">
        <div class="orbit-badge" style="--counter:${-angle}deg;animation-name:${unspin};animation-duration:${orbit.seconds}s">
          ${icon(name)}
        </div>
      </div>`).join('');

    return `<div class="orbit-ring" style="--scale:${orbit.scale}">${badges}</div>`;
  }).join('');
}

/**
 * The globe: points spread evenly over a sphere, spun about the vertical axis
 * and projected flat.
 *
 * Spread by the golden angle rather than at random, which is what stops the
 * points clumping at the poles the way naive spherical coordinates do. Points
 * on the far side are drawn fainter and smaller, which is the whole illusion
 * of depth — there is no 3D here, only a z used for alpha.
 */
function startGlobe(canvas) {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return () => {};

  const COUNT = 340;
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const points = Array.from({ length: COUNT }, (_, i) => {
    const y = 1 - (i / (COUNT - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN * i;
    return { x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius };
  });

  let width = 0;
  let height = 0;
  let frame = 0;
  let angle = 0;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const draw = () => {
    if (!width || !height) resize();
    ctx.clearRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const r = Math.min(width, height) * 0.42;
    const tint = getComputedStyle(document.body).getPropertyValue('--blue').trim() || '#4a9ae8';

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    for (const p of points) {
      const x = p.x * cos - p.z * sin;
      const z = p.x * sin + p.z * cos;
      // z runs -1 (behind) to 1 (facing). Everything visual follows from it.
      const depth = (z + 1) / 2;
      ctx.globalAlpha = 0.08 + depth * 0.5;
      ctx.beginPath();
      ctx.arc(cx + x * r, cy + p.y * r, 0.5 + depth * 1.4, 0, Math.PI * 2);
      ctx.fillStyle = tint;
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (!STILL) angle += 0.0016;
    frame = requestAnimationFrame(draw);
  };

  resize();
  window.addEventListener('resize', resize);
  frame = requestAnimationFrame(draw);

  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', resize);
  };
}

let stopGlobe = null;

/**
 * Show or hide the backdrop.
 *
 * The globe is torn down rather than merely covered when it goes away: a
 * requestAnimationFrame loop behind an opaque app is pure battery, and this
 * runs on phones.
 */
export function setLockBackdrop(visible) {
  const host = document.getElementById('lockBackdrop');
  if (!host) return;

  host.style.display = visible ? 'block' : 'none';
  if (!visible) {
    if (stopGlobe) { stopGlobe(); stopGlobe = null; }
    return;
  }
  if (stopGlobe) return;

  const field = document.getElementById('orbitField');
  if (field && !field.childElementCount) buildOrbits(field);
  const canvas = document.getElementById('lockGlobe');
  if (canvas) stopGlobe = startGlobe(canvas);
}
