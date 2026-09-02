/**
 * A fear-and-greed dial: a coloured half-ring with a marker on it.
 *
 * Drawn as SVG rather than with a chart library, because it is five arcs and a
 * circle and the app already carries one charting dependency it would rather
 * not use for this.
 *
 * The ring is the scale and the dot is the reading, which is the whole idea:
 * where the dot sits along the colours says more at a glance than the number
 * does, and the number is printed underneath for when it does not.
 */

/** The bands, in the colours they are always drawn in. */
const SEGMENTS = [
  { from: 0, to: 25, colour: '#e0483f' },   // extreme fear
  { from: 25, to: 45, colour: '#e08a3c' },  // fear
  { from: 45, to: 56, colour: '#e3c53f' },  // neutral
  { from: 56, to: 76, colour: '#9ccc48' },  // greed
  { from: 76, to: 100, colour: '#3fbf63' }, // extreme greed
];

const CX = 100;
const CY = 96;
const R = 74;
/** A hair of space between segments, so the bands read as separate. */
const GAP = 1.2;

/**
 * A point on the dial for a reading.
 *
 * 0 sits at the left end of the ring and 100 at the right, sweeping over the
 * top — so the angle runs from 180 degrees down to 0.
 */
function pointAt(value) {
  const angle = ((180 - value * 1.8) * Math.PI) / 180;
  return { x: CX + R * Math.cos(angle), y: CY - R * Math.sin(angle) };
}

function arcPath(from, to) {
  const a = pointAt(from);
  const b = pointAt(to);
  // Always the minor arc: no segment here spans more than half the ring.
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${R} ${R} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

/**
 * One dial.
 *
 * `title` is the caption under it. The value is clamped rather than trusted:
 * this draws whatever it is handed, and a reading outside the scale would put
 * the marker somewhere that means nothing.
 */
export function gaugeSvg({ value, label, title }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const marker = pointAt(v);

  const arcs = SEGMENTS.map(({ from, to, colour }) => {
    const start = from === 0 ? from : from + GAP;
    const end = to === 100 ? to : to - GAP;
    return `<path d="${arcPath(start, end)}" stroke="${colour}" stroke-width="13"
      fill="none" stroke-linecap="round" />`;
  }).join('');

  return `<svg class="gauge" viewBox="0 0 200 128" role="img"
     aria-label="${title}: ${v}, ${label}">
    ${arcs}
    <circle cx="${marker.x.toFixed(2)}" cy="${marker.y.toFixed(2)}" r="7"
      fill="var(--panel)" />
    <circle cx="${marker.x.toFixed(2)}" cy="${marker.y.toFixed(2)}" r="5.2"
      fill="#ffffff" />
    <text x="${CX}" y="${CY - 8}" class="gauge-num" text-anchor="middle">${v}</text>
    <text x="${CX}" y="${CY + 12}" class="gauge-lbl" text-anchor="middle">${label}</text>
    <text x="${CX}" y="${CY + 30}" class="gauge-cap" text-anchor="middle">${title}</text>
  </svg>`;
}
