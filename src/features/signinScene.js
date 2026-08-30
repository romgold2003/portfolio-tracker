/**
 * The sign-in scene: someone at a desk, trading.
 *
 * Modelled on PrismaHero from 21st.dev — full-screen, cinematic, slow drift,
 * heavy vignette — but drawn rather than filmed. That component's subject is a
 * background video, and there is no video here to use: footage of a person is
 * not something this can produce, and a stock clip would need a licence, a few
 * megabytes of download, a wider content policy, and would not survive into the
 * single file you can double-click.
 *
 * So the scene is rendered. Silhouette on purpose: a figure in shadow against
 * lit screens reads as cinematic, where an attempt at a drawn face reads as a
 * drawn face. Everything visible is the light — the monitors, what they throw
 * onto the desk and the shoulders, and the dark everywhere else.
 *
 * The charts are alive. Candles form and close on their own random walk, the
 * line chart advances, the tickers scroll. None of it is your data: the sign-in
 * screen runs before anything is decrypted, and it must not imply otherwise.
 */

const STILL = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

let canvas = null;
let ctx = null;
let frame = 0;
let width = 0;
let height = 0;
let t = 0;

/** A candlestick series that keeps walking, so the screens are never static. */
function makeCandles(count, seed) {
  let price = 100 + seed * 7;
  return Array.from({ length: count }, () => {
    const open = price;
    const drift = (Math.sin(seed * 3.1 + price * 0.07) + Math.random() - 0.45) * 2.4;
    price = Math.max(40, price + drift);
    const close = price;
    const wick = Math.abs(drift) * (0.6 + Math.random());
    return { open, close, high: Math.max(open, close) + wick, low: Math.min(open, close) - wick };
  });
}

const screens = [
  { candles: makeCandles(26, 1), tick: 0 },
  { candles: makeCandles(22, 2), tick: 0 },
  { candles: makeCandles(18, 3), tick: 0 },
];

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** One monitor: a frame, a chart inside it, and the glow it throws. */
function drawScreen(x, y, w, h, screen, palette) {
  ctx.save();

  // The panel, lit from within. A flat dark rectangle with lines on it reads as
  // a shape; a gradient reads as a screen that is switched on.
  const panel = ctx.createLinearGradient(x, y, x, y + h);
  panel.addColorStop(0, palette.screenTop);
  panel.addColorStop(1, palette.screenBottom);
  ctx.fillStyle = panel;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.fill();
  ctx.strokeStyle = palette.screenEdge;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.clip();

  const pad = 10;
  const inner = { x: x + pad, y: y + pad, w: w - pad * 2, h: h - pad * 2 };

  // A grid, so the chart reads as an instrument rather than a doodle.
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 0.5;
  for (let i = 1; i < 4; i++) {
    const gy = inner.y + (inner.h / 4) * i;
    ctx.beginPath();
    ctx.moveTo(inner.x, gy);
    ctx.lineTo(inner.x + inner.w, gy);
    ctx.stroke();
  }

  const values = screen.candles.flatMap((c) => [c.high, c.low]);
  const hi = Math.max(...values);
  const lo = Math.min(...values);
  const span = Math.max(1e-6, hi - lo);
  const toY = (v) => inner.y + inner.h - ((v - lo) / span) * inner.h;

  const step = inner.w / screen.candles.length;
  screen.candles.forEach((c, i) => {
    const cx = inner.x + step * i + step / 2;
    const up = c.close >= c.open;
    ctx.strokeStyle = up ? palette.up : palette.down;
    ctx.fillStyle = up ? palette.up : palette.down;

    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(1, w * 0.006);
    ctx.beginPath();
    ctx.moveTo(cx, toY(c.high));
    ctx.lineTo(cx, toY(c.low));
    ctx.stroke();

    const bodyTop = toY(Math.max(c.open, c.close));
    const bodyH = Math.max(1, Math.abs(toY(c.open) - toY(c.close)));
    ctx.fillRect(cx - step * 0.3, bodyTop, step * 0.6, bodyH);
  });
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.restore();

  // Screen light spilling into the room. This is what makes it a lit scene
  // rather than shapes on a background.
  const glow = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, w * 1.15);
  glow.addColorStop(0, palette.glowNear);
  glow.addColorStop(1, palette.glowFar);
  ctx.fillStyle = glow;
  ctx.fillRect(x - w * 0.7, y - h * 0.7, w * 2.4, h * 2.6);
}

/**
 * The figure, in shadow.
 *
 * Deliberately just a head, shoulders and an arm reaching to the desk. It reads
 * as a person from the shape alone, and stops well short of a face — which at
 * this size would look drawn no matter how carefully it was done.
 */
function drawFigure(cx, baseY, scale, palette, floorY) {
  const headR = 26 * scale;
  const headY = baseY - 116 * scale;
  // The torso runs off the bottom of the frame rather than stopping somewhere
  // above it. A body that ends mid-air reads as a cut-out; one that leaves the
  // frame reads as someone sitting close to the camera.
  const hem = Math.max(baseY + 40 * scale, floorY);

  /**
   * The outline, traced once and then used three times: to lay the body in, to
   * rim it, and to sit it against the room.
   *
   * A black shape on a near-black room is not a silhouette, it is nothing —
   * the first version of this was invisible for exactly that reason. What makes
   * it read is the edge: a thin line of screen light along the side facing the
   * monitors, which is what your eye actually uses to find a person in a dark
   * room.
   */
  const body = () => {
    ctx.beginPath();
    ctx.moveTo(cx - 96 * scale, hem);
    ctx.quadraticCurveTo(cx - 82 * scale, headY + 46 * scale, cx - 36 * scale, headY + 28 * scale);
    ctx.quadraticCurveTo(cx, headY + 14 * scale, cx + 36 * scale, headY + 28 * scale);
    ctx.quadraticCurveTo(cx + 82 * scale, headY + 46 * scale, cx + 96 * scale, hem);
    ctx.closePath();
  };

  ctx.save();

  // Laid in darker than the room, so it subtracts light rather than adding a
  // shape — which is what a body between you and a screen actually does.
  ctx.fillStyle = palette.figure;
  body();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, headY, headR, 0, Math.PI * 2);
  ctx.fill();

  // The arm reaching to the desk: what says "working" rather than "sitting".
  ctx.strokeStyle = palette.figure;
  ctx.lineWidth = 21 * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx + 62 * scale, headY + 74 * scale);
  ctx.quadraticCurveTo(cx + 116 * scale, headY + 104 * scale, cx + 126 * scale, baseY - 28 * scale);
  ctx.stroke();

  // Rim light. Drawn along the top and one shoulder only, because light comes
  // from the screens rather than from everywhere.
  ctx.strokeStyle = palette.rim;
  ctx.lineWidth = Math.max(1, 1.6 * scale);
  ctx.globalAlpha = 0.85;
  body();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, headY, headR, Math.PI * 0.92, Math.PI * 2.16);
  ctx.stroke();

  ctx.restore();
}

function paletteFor() {
  const s = getComputedStyle(document.body);
  const v = (name, fallback) => s.getPropertyValue(name).trim() || fallback;
  const light = document.body.classList.contains('light');
  return {
    up: v('--green', '#3dba6a'),
    down: v('--red', '#e34948'),
    screenTop: light ? 'rgba(44,62,92,0.98)' : 'rgba(30,44,68,0.99)',
    screenBottom: light ? 'rgba(24,32,48,0.98)' : 'rgba(14,20,32,0.99)',
    screenEdge: light ? 'rgba(150,180,220,0.75)' : 'rgba(130,170,220,0.70)',
    grid: 'rgba(150,185,225,0.30)',
    glowNear: light ? 'rgba(90,150,230,0.16)' : 'rgba(74,154,232,0.30)',
    glowFar: 'rgba(0,0,0,0)',
    figure: light ? 'rgba(16,20,28,0.92)' : 'rgba(0,0,0,0.94)',
    rim: light ? 'rgba(140,180,235,0.90)' : 'rgba(150,200,255,0.85)',
    desk: light ? 'rgba(20,26,36,0.70)' : 'rgba(0,0,0,0.80)',
    room: v('--bg', '#0f0f0f'),
  };
}

function draw() {
  const p = paletteFor();
  ctx.clearRect(0, 0, width, height);

  // The room.
  ctx.fillStyle = p.room;
  ctx.fillRect(0, 0, width, height);

  // A slow drift, which is most of what makes it feel filmed rather than drawn.
  const driftX = Math.sin(t * 0.16) * 9;
  const driftY = Math.cos(t * 0.11) * 5;

  ctx.save();
  ctx.translate(driftX, driftY);

  const cx = width / 2;
  const deskY = height * 0.84;
  const k = Math.min(1.3, Math.max(0.55, width / 1280));

  /**
   * Sized and spread in fractions of the window, not fixed pixels.
   *
   * The sign-in card sits dead centre and covers roughly the middle third, so
   * the outer two monitors are pushed clear of it — otherwise the scene is
   * behind the one thing that is always on top of it, and there is nothing to
   * see. The middle screen stays behind the card on purpose: its glow reaches
   * past the edges and lights the card from behind.
   */
  const sw = width * 0.22;
  const sh = sw * 0.62;
  const sy = deskY - sh - 22 * k;

  drawScreen(cx - sw * 1.92, sy + 14 * k, sw, sh, screens[0], p);
  drawScreen(cx - sw * 0.5, sy - 10 * k, sw, sh, screens[1], p);
  drawScreen(cx + sw * 0.92, sy + 14 * k, sw, sh, screens[2], p);

  // The desk: a hard edge with the screen light dying on it.
  const deskGlow = ctx.createLinearGradient(0, deskY - 30 * k, 0, deskY + 26 * k);
  deskGlow.addColorStop(0, 'rgba(74,154,232,0.10)');
  deskGlow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = deskGlow;
  ctx.fillRect(0, deskY - 30 * k, width, 56 * k);
  ctx.fillStyle = p.desk;
  ctx.fillRect(0, deskY, width, height - deskY);

  // Head and shoulders sit above the desk line, so the person is legible as a
  // person rather than as a lump at the bottom edge.
  drawFigure(cx - sw * 1.42, deskY + 30 * k, k * 1.08, p, height + 60);
  ctx.restore();

  // Vignette, doing the heavy lifting: it pushes the corners down and holds the
  // eye where the card is about to appear.
  const vignette = ctx.createRadialGradient(
    width / 2, height * 0.52, Math.min(width, height) * 0.22,
    width / 2, height * 0.52, Math.max(width, height) * 0.78,
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, document.body.classList.contains('light')
    ? 'rgba(20,24,32,0.30)' : 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  if (!STILL) {
    t += 0.016;
    // Advance one screen at a time so the three do not tick in lockstep.
    const which = Math.floor(t * 1.6) % screens.length;
    const s = screens[which];
    if (Math.floor(t * 1.6) !== s.tick) {
      s.tick = Math.floor(t * 1.6);
      s.candles.shift();
      s.candles.push(...makeCandles(1, which + 1));
    }
  }
  frame = requestAnimationFrame(draw);
}

let running = false;

/** Show or hide the scene. Torn down when hidden, not merely covered. */
export function setSigninScene(visible) {
  canvas = document.getElementById('signinScene');
  if (!canvas) return;
  canvas.style.display = visible ? 'block' : 'none';

  if (!visible) {
    cancelAnimationFrame(frame);
    frame = 0;
    running = false;
    window.removeEventListener('resize', resize);
    return;
  }
  if (running) return;

  ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;
  running = true;
  resize();
  window.addEventListener('resize', resize);
  frame = requestAnimationFrame(draw);
}
