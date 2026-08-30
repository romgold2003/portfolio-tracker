/**
 * A wave of particles behind the app.
 *
 * Taken from the design of the "Particle Wave" component on 21st.dev — a grid
 * of points rippling as a wave, responding to the cursor, following the theme —
 * and rebuilt for this codebase. The original is React and three.js; this app
 * has neither, and adding a 3D engine and a framework for a background would
 * cost it the two things it was built around: no build step, and a single file
 * you can double-click. A plane of dots needs no GPU pipeline. It is one canvas
 * and a sine wave.
 *
 * It lives behind the shell, and the panels above it are opaque, so it shows
 * only in the gaps between them. That is the intent: something in the empty
 * space, and nothing behind a number.
 */

const STILL = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Spacing between points. Larger is calmer and cheaper. */
const GAP = 34;
/** A ceiling for very large screens, so the cost cannot run away. */
const MAX_POINTS = 2600;

/** How far the cursor's influence reaches, and how strongly. */
const REACH = 190;
const LIFT = 13;

let canvas = null;
let ctx = null;
let frame = 0;
let width = 0;
let height = 0;
let time = 0;
const pointer = { x: -9999, y: -9999, seen: false };

function resize() {
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/**
 * One frame.
 *
 * The wave is two sines crossed, which is what gives it the sense of travelling
 * diagonally rather than marching in rows. Height drives both size and alpha,
 * so crests read as nearer without anything actually being in perspective.
 */
function draw() {
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);

  const styles = getComputedStyle(document.body);
  const tint = styles.getPropertyValue('--blue').trim() || '#4a9ae8';
  // Deliberately faint. This sits under a page of numbers, and anything more
  // assertive competes with them.
  const base = styles.getPropertyValue('--wave-strength').trim() || '0.30';
  const strength = Number(base) || 0.3;

  const cols = Math.ceil(width / GAP) + 1;
  const rows = Math.ceil(height / GAP) + 1;
  const step = cols * rows > MAX_POINTS ? 2 : 1;

  ctx.fillStyle = tint;
  for (let ix = 0; ix < cols; ix += step) {
    for (let iy = 0; iy < rows; iy += step) {
      const x = ix * GAP;
      const y = iy * GAP;

      // -1 to 1, travelling across both axes at slightly different rates so
      // the pattern never repeats on a short cycle.
      const wave = Math.sin(x * 0.012 + time) * Math.cos(y * 0.014 - time * 0.8);

      let lift = 0;
      let near = 0;
      if (pointer.seen) {
        const dx = x - pointer.x;
        const dy = y - pointer.y;
        const dist = Math.hypot(dx, dy);
        if (dist < REACH) {
          // Falls away smoothly rather than at a hard edge.
          near = (1 - dist / REACH) ** 2;
          lift = near * LIFT;
        }
      }

      const height01 = (wave + 1) / 2;
      const alpha = (0.06 + height01 * 0.4 + near * 0.5) * strength;
      if (alpha <= 0.004) continue;

      ctx.globalAlpha = Math.min(alpha, 0.75);
      const radius = 0.6 + height01 * 1.1 + near * 1.3;
      ctx.beginPath();
      ctx.arc(x, y - wave * 5 - lift, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  if (!STILL) time += 0.011;
  frame = requestAnimationFrame(draw);
}

function start() {
  if (frame) return;
  frame = requestAnimationFrame(draw);
}

function stop() {
  cancelAnimationFrame(frame);
  frame = 0;
}

/**
 * Begin. Safe to call more than once.
 *
 * Nothing runs while the tab is in the background: an animation nobody is
 * looking at is only a drain on the battery.
 */
export function initParticleWave() {
  canvas = document.getElementById('particleWave');
  if (!canvas) return;
  ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  resize();
  window.addEventListener('resize', resize);

  // Tracked on the window so the cursor still moves the field while it is over
  // the panels sitting on top of it.
  window.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.seen = true;
  }, { passive: true });
  window.addEventListener('pointerleave', () => { pointer.seen = false; });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stop(); else start();
  });

  start();
}
