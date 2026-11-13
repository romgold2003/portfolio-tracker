/**
 * The little drawings on the trader card (November 2026): one for each of the
 * 30 achievements and the 12 trading styles. Line drawings in one hand, a
 * little playful and still tidy: a knocked-out bear for surviving a bear
 * market, a castle for the Fortress Builder, a turtle with a dollar on its
 * shell for Patience Pays.
 *
 * Each is a 64×64 SVG drawn in the text colour, with the card's rarity colour
 * as its accent (CSS: .art, and --r on the card), so it works in light and
 * dark and greys out with the card when it is locked:
 *   .a  accent wash (a soft fill of the rarity colour, outlined)
 *   .s  accent line
 *   .f  solid accent shape
 *   .k  solid ink (eyes, dots)
 *   .t  a short label in the drawing
 */

const svg = (body) => `<svg class="art" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${body}</svg>`;

/** A four-point sparkle centred on (x, y). */
const spark = (x, y, r = 4) => `<path class="s" d="M${x} ${y - r}v${r * 2}M${x - r} ${y}h${r * 2}"/>`;

const ART = {
  /* ── market survival ── */
  correction: svg(`
    <path class="a" d="M32 6 52 13v17c0 14-9 23-20 28C21 53 12 44 12 30V13Z"/>
    <polyline class="s" points="20,24 27,37 34,31 44,21"/>
    <polyline class="s" points="38,21 44,21 44,27"/>`),
  // The bear market, knocked out flat on its back: paws up, X eyes, seeing stars.
  bear: svg(`
    <path d="M3 57h58"/>
    <ellipse class="a" cx="29" cy="31" rx="3.6" ry="6.5" transform="rotate(-18 29 31)"/>
    <ellipse class="a" cx="38" cy="29.5" rx="3.6" ry="6.5"/>
    <ellipse class="a" cx="46" cy="30" rx="3.6" ry="6.5" transform="rotate(10 46 30)"/>
    <ellipse class="a" cx="53.5" cy="34" rx="3.6" ry="6.5" transform="rotate(28 53.5 34)"/>
    <ellipse class="a" cx="40" cy="46" rx="18" ry="10.5"/>
    <circle class="a" cx="15" cy="44" r="11"/>
    <circle class="a" cx="7" cy="35" r="4"/><circle class="a" cx="21.5" cy="33.5" r="4"/>
    <ellipse cx="14" cy="49" rx="5.5" ry="3.8"/>
    <ellipse class="k" cx="14" cy="47.6" rx="1.9" ry="1.3"/>
    <path d="M8 40.5l3 3M11 40.5l-3 3M17 40.5l3 3M20 40.5l-3 3"/>
    <path class="s" d="M16.5 52.6c.3 2.8 3.2 3 3.4.6"/>
    ${spark(6, 23, 2.6)}${spark(15, 19, 3.2)}${spark(24, 22, 2.4)}`),
  storm: svg(`
    <path class="a" d="M18 30a8 8 0 0 1 2-15.7A11 11 0 0 1 41 12a8 8 0 0 1 5 18Z"/>
    <path class="f" d="M34 30l-7 11h6l-4 11 12-15h-6l4-7Z"/>
    <path d="M18 36l-2 5M47 36l-2 5M21 45l-2 5"/>`),
  crashproof: svg(`
    <path class="a" d="M10 32a22 22 0 0 1 44 0c-5-4-10-4-11 0-1-4-10-4-11 0-1-4-10-4-11 0-1-4-6-4-11 0Z"/>
    <path d="M32 32v18a4 4 0 0 1-8 0"/>
    <path d="M6 38v8M3 43l3 3 3-3M58 38v8M55 43l3 3 3-3"/>
    <path class="s" d="M42 54V42M38 46l4-4 4 4"/>`),
  dip: svg(`
    <path class="a" d="M15 22h37l-5 18H19Z"/>
    <path d="M5 14h8l6 26h28l5-18"/>
    <circle cx="23" cy="48" r="3"/><circle cx="43" cy="48" r="3"/>
    <polyline class="s" points="22,4 30,11 35,8 41,19"/>
    <path class="s" d="M41 19l.4-5.5M41 19l-5-2"/>`),
  fed: svg(`
    <path class="a" d="M8 22 32 8l24 14Z"/>
    <path d="M10 26h44M14 26v22M24 26v22M40 26v22M50 26v22M10 48h44M8 53h48"/>
    <circle class="k" cx="28" cy="15" r="1.5"/><circle class="k" cx="36" cy="19" r="1.5"/>
    <path d="M35.5 13.5l-7 7" style="stroke-width:1.6"/>`),

  /* ── big wins and streaks ── */
  doubler: svg(`
    <path class="a" d="M32 4c10 8 12 22 8 36H24c-4-14-2-28 8-36Z"/>
    <circle cx="32" cy="19" r="4"/>
    <path d="M24 31l-8 11 8-2M40 31l8 11-8-2"/>
    <path class="f" d="M27 41q5 16 10 0Z"/>
    <text class="t" x="32" y="34">2×</text>`),
  tenbagger: svg(`
    <path class="a" d="M38 8a24 24 0 1 0 18 40A20 20 0 1 1 38 8Z"/>
    <circle cx="20" cy="42" r="3"/><circle cx="16" cy="28" r="2"/><circle cx="28" cy="50" r="1.6"/>
    <path d="M30 34V14h12l-3 4.5 3 4.5H30"/>
    <text class="t" x="36" y="21" style="font-size:6px">10×</text>
    ${spark(54, 12, 3)}${spark(58, 28, 2.5)}`),
  fourfigures: svg(`
    <rect class="a" x="6" y="18" width="52" height="28" rx="4"/>
    <circle cx="32" cy="32" r="8"/>
    <text class="t" x="32" y="36" style="font-size:11px">$</text>
    <path d="M12 24h5M47 40h5"/>`),
  fivefigures: svg(`
    <path class="a" d="M24 12h16l-4 7c10 4 16 14 16 24 0 9-7 13-20 13s-20-4-20-13c0-10 6-20 16-24Z"/>
    <path d="M26 19h12"/>
    <text class="t" x="32" y="45" style="font-size:15px">$</text>
    <ellipse class="a" cx="54" cy="55" rx="6" ry="2.4"/><ellipse class="a" cx="54" cy="51" rx="6" ry="2.4"/>`),
  hotstreak: svg(`
    <path class="a" d="M32 5c4 10 14 14 14 29a14 14 0 0 1-28 0c0-8 6-12 8-20 2 6 4 8 6 8 0-6-1-11 0-17Z"/>
    <path class="f" d="M32 30c2 6 6 8 6 13a6 6 0 0 1-12 0c0-4 4-6 6-13Z"/>
    <circle class="k" cx="20" cy="59" r="1.6"/><circle class="k" cx="26" cy="59" r="1.6"/><circle class="k" cx="32" cy="59" r="1.6"/>
    <circle class="k" cx="38" cy="59" r="1.6"/><circle class="k" cx="44" cy="59" r="1.6"/>`),
  unstoppable: svg(`
    <circle class="f" cx="46" cy="18" r="7"/><circle cx="46" cy="18" r="7"/>
    <path d="M41 23 10 54M44 26 24 52M38 20 12 42"/>
    <path class="s" d="M36 30 20 46"/>
    ${spark(14, 14, 3)}${spark(56, 44, 2.5)}`),
  perfectweek: svg(`
    <rect class="a" x="8" y="12" width="48" height="42" rx="5"/>
    <path d="M8 22h48M20 8v8M44 8v8"/>
    <path class="s" d="M13 32l3 3 4-5M25 32l3 3 4-5M37 32l3 3 4-5M49 32l3 3 4-5M13 44l3 3 4-5"/>`),
  marketbeater: svg(`
    <path class="a" d="M20 8h24v14a12 12 0 0 1-24 0Z"/>
    <path d="M20 12h-8a6 6 0 0 0 8 10M44 12h8a6 6 0 0 1-8 10"/>
    <path d="M32 34v10M26 44h12v8H26ZM22 56h20"/>
    <path class="s" d="M25 25l5-6 4 3 5-7M35 15h4v4"/>`),

  /* ── patience and comebacks ── */
  oneyear: svg(`
    <path d="M16 6h32M16 58h32"/>
    <path d="M20 6c0 16 10 20 10 26S20 42 20 58M44 6c0 16-10 20-10 26s10 10 10 26"/>
    <path class="a" d="M25 15h14c-2 6-6 9-7 10-1-1-5-4-7-10Z"/>
    <path class="f" d="M23 56c1-8 7-10 9-12 2 2 8 4 9 12Z"/>`),
  longhaul: svg(`
    <path class="a" d="M32 6c12 0 20 8 18 18 6 4 4 16-6 16H20c-10 0-12-12-6-16-2-10 6-18 18-18Z"/>
    <path d="M28 40v16M36 40v16M22 56h20M32 40V30M32 35l-6-5M32 33l6-5"/>
    <circle class="k" cx="22" cy="20" r="1.4"/><circle class="k" cx="40" cy="16" r="1.4"/><circle class="k" cx="44" cy="30" r="1.4"/>`),
  ironwill: svg(`
    <path class="a" d="M10 22h40c0 6-6 8-10 8v8h4v6H18v-6h4v-8c-8 0-12-4-12-8Z"/>
    <path d="M14 52h34M20 44l-4 8M42 44l4 8"/>
    <path class="s" d="M54 12l4-4M56 18h5M50 9V3"/>`),
  diamond: svg(`
    <path class="a" d="M18 14h28l10 12-24 28L8 26Z"/>
    <path d="M8 26h48M18 14l8 12 6 28 6-28 8-12M26 26l6-12 6 12"/>
    ${spark(55, 8, 3.5)}${spark(8, 46, 2.5)}`),
  // Rising out of its own flames, wings up.
  phoenix: svg(`
    <path class="f" d="M32 40c-5 6-4 12 0 20 4-8 5-14 0-20Z"/>
    <path class="f" d="M28 42c-6 3-8 8-6 13 2-4 5-6 8-8ZM36 42c6 3 8 8 6 13-2-4-5-6-8-8Z" style="opacity:.6"/>
    <path class="a" d="M31 32C26 22 17 15 5 13c4 8 9 15 16 19-5 0-9 2-11 5 7-1 14 0 19 2Z"/>
    <path class="a" d="M33 32c5-10 14-17 26-19-4 8-9 15-16 19 5 0 9 2 11 5-7-1-14 0-19 2Z"/>
    <path class="a" d="M32 20c3 0 4 4 2 8l-2 14-2-14c-2-4-1-8 2-8Z"/>
    <path d="M32 20c0-3 2-5 4-4l-2 2"/>
    <circle class="k" cx="33" cy="18.5" r="0.9"/>`),
  patiencepays: svg(`
    <path class="a" d="M12 42a20 18 0 0 1 40 0Z"/>
    <text class="t" x="32" y="38" style="font-size:12px">$</text>
    <path d="M52 40c4-2 8-2 8-6s-6-4-8 0M12 42l-5 2M18 42v6M28 42v6M37 42v6M46 42v6M4 52h56"/>
    <circle class="k" cx="57" cy="33" r="1"/>`),
  steady: svg(`
    <circle class="a" cx="32" cy="32" r="24"/>
    <path d="M32 6v4M32 54v4M6 32h4M54 32h4"/>
    <path class="f" d="M32 13l5 19h-10Z"/>
    <path d="M27 32l5 19 5-19"/>
    <circle class="k" cx="32" cy="32" r="2"/>`),

  /* ── milestones and discipline ── */
  first: svg(`
    <path class="a" d="M20 46c-4 0-6-6-5-12 1-5 7-5 8 0 1 6 0 12-3 12Z"/>
    <circle class="k" cx="15" cy="27" r="1.4"/><circle class="k" cx="18.5" cy="25.5" r="1.4"/><circle class="k" cx="22" cy="26.5" r="1.4"/>
    <path class="a" d="M42 32c-4 0-6-6-5-12 1-5 7-5 8 0 1 6 0 12-3 12Z"/>
    <circle class="k" cx="37" cy="13" r="1.4"/><circle class="k" cx="40.5" cy="11.5" r="1.4"/><circle class="k" cx="44" cy="12.5" r="1.4"/>
    <path d="M6 56h52"/>`),
  ten: svg(`
    <path class="a" d="M20 40h24l-3 16H23Z"/>
    <path d="M18 40h28M32 40V22"/>
    <path class="a" d="M32 30c-8 0-12-6-12-12 8 0 12 6 12 12Z"/>
    <path class="a" d="M32 25c8 0 12-6 12-12-8 0-12 6-12 12Z"/>`),
  fifty: svg(`
    <path class="a" d="M4 54 24 18l10 16 8-10 18 30Z"/>
    <path d="M24 18V6h9l-3 3 3 3h-9"/>
    <path class="s" d="M18 30l6 2 4-3"/>`),
  hundred: svg(`
    <path d="M20 52C8 44 8 22 18 12M44 52c12-8 12-30 2-40"/>
    <ellipse class="a" cx="12" cy="38" rx="3" ry="5.5" transform="rotate(-25 12 38)"/>
    <ellipse class="a" cx="11" cy="26" rx="3" ry="5.5" transform="rotate(15 11 26)"/>
    <ellipse class="a" cx="17" cy="47" rx="3" ry="5.5" transform="rotate(-55 17 47)"/>
    <ellipse class="a" cx="52" cy="38" rx="3" ry="5.5" transform="rotate(25 52 38)"/>
    <ellipse class="a" cx="53" cy="26" rx="3" ry="5.5" transform="rotate(-15 53 26)"/>
    <ellipse class="a" cx="47" cy="47" rx="3" ry="5.5" transform="rotate(55 47 47)"/>
    <text class="t" x="32" y="37" style="font-size:13px">100</text>`),
  explorer: svg(`
    <path class="a" d="M6 14 22 8l20 6 16-6v42l-16 6-20-6-16 6Z"/>
    <path d="M22 8v42M42 14v42"/>
    <path class="s" d="M12 44c6-8 14-4 18-12s12-2 16-10" style="stroke-dasharray:2 4"/>
    <path class="s" d="M46 16l6 6M52 16l-6 6"/>`),
  crypto: svg(`
    <circle class="a" cx="32" cy="32" r="22"/>
    <circle cx="32" cy="32" r="17"/>
    <text class="t" x="32" y="39" style="font-size:19px">₿</text>`),
  short: svg(`
    <path class="s" d="M6 34l14 8 8-3 24 17"/>
    <path class="s" d="M52 56h-8M52 56v-8"/>
    <circle class="a" cx="21" cy="19" r="9"/>
    <circle class="a" cx="14" cy="11" r="3"/><circle class="a" cx="28" cy="11" r="3"/>
    <path class="k" d="M14.5 17h5v3h-5ZM22.5 17h5v3h-5Z"/>
    <path d="M19.5 18h3M19 24q2 2 4 0"/>`),
  journal: svg(`
    <rect class="a" x="10" y="8" width="34" height="48" rx="3"/>
    <path d="M16 8v48M22 20h16M22 28h16M22 36h10"/>
    <path d="M38 50 54 18l4 2-16 32Z"/>
    <path class="f" d="M38 50l4 2-5 4Z"/>`),
  smalllosses: svg(`
    <circle cx="14" cy="44" r="6"/><circle cx="14" cy="20" r="6"/>
    <path d="M19 40 46 24M19 24l27 16"/>
    <path class="s" d="M44 32h6"/>
    <path class="s" d="M54 34l6 10" style="stroke-dasharray:3 3"/>`),

  /* ── the twelve styles ── */
  'style:scalper': svg(`
    <circle class="a" cx="32" cy="36" r="20"/>
    <path d="M28 8h8M32 8v8M48 20l4-4"/>
    <path class="f" d="M34 22l-8 16h6l-3 12 11-18h-6Z"/>`),
  'style:sniper': svg(`
    <circle class="a" cx="32" cy="32" r="20"/><circle cx="32" cy="32" r="10"/>
    <path d="M32 4v14M32 46v14M4 32h14M46 32h14"/>
    <circle class="f" cx="32" cy="32" r="3"/>`),
  // A loop-the-loop, the cart right at the top.
  'style:adrenaline': svg(`
    <path class="s" d="M3 50c13 0 19-3 23-9A13 13 0 1 1 38 41c4 6 10 9 23 9"/>
    <path d="M12 50v8M32 42v16M52 50v8M3 58h58"/>
    <rect class="a" x="26.5" y="9.5" width="11" height="6.5" rx="2"/>
    <circle class="k" cx="29" cy="17.5" r="1.3"/><circle class="k" cx="35" cy="17.5" r="1.3"/>
    <path class="s" d="M24 6l-3-3M40 6l3-3M32 4V1"/>`),
  'style:wave': svg(`
    <path class="a" d="M4 46c10 0 14-26 32-30 14-3 22 8 20 16-6-6-14-4-14 4 0 6 6 8 10 6-4 8-12 10-22 8-10-2-18-4-26-4Z"/>
    <path d="M4 55c6-3 10 3 16 0s10 3 16 0 10 3 16 0 6 2 8 0"/>`),
  'style:surfer': svg(`
    <path class="a" d="M12 40c8-14 30-24 44-28-6 12-24 28-42 32Z"/>
    <path d="M20 38c10-8 22-16 32-22"/>
    <path d="M4 52c6-4 10 4 16 0s10 4 16 0 10 4 16 0 6 3 8 0"/>`),
  // An eagle in profile: hooked beak, stern brow, waiting for its moment.
  'style:hunter': svg(`
    <path class="a" d="M12 56C9 38 16 20 32 15c10-3 19 1 22 9l1 5c-4 0-8 2-10 6-4 10-15 17-33 21Z"/>
    <path class="f" d="M52 23c6 0 10 4 9 10-1 3-3 4-4 3 0-3-2-5-5-5Z"/>
    <path d="M52 23c6 0 10 4 9 10-1 3-3 4-4 3 0-3-2-5-5-5"/>
    <circle class="k" cx="43" cy="25" r="2.1"/>
    <path d="M37 20.5l10 2"/>
    <path d="M17 49l7-4M21 53l7-5M27 54l6-6"/>`),
  'style:oak': svg(`
    <path class="a" d="M32 6c14 0 22 10 20 20 6 6 0 16-8 14-4 6-20 6-24 0-8 2-14-8-8-14-2-10 6-20 20-20Z"/>
    <path d="M28 42v14M36 42v14M22 56h20"/>
    <ellipse class="f" cx="53" cy="53" rx="3.6" ry="4.6"/>
    <path d="M48.5 49h9"/>`),
  'style:fortress': svg(`
    <path class="a" d="M6 58V22h4v-4h4v4h4v-4h4v40Z"/>
    <path class="a" d="M42 58V22h4v-4h4v4h4v-4h4v40Z"/>
    <path class="a" d="M22 58V32h4v-4h4v4h4v-4h4v4h4v26Z"/>
    <path d="M27 58v-9a5 5 0 0 1 10 0v9M14 30v5M50 30v5"/>
    <path class="s" d="M14 18V7h8l-2.5 3 2.5 3h-8"/>`),
  'style:homerun': svg(`
    <path class="a" d="M8 52 38 24c4-4 9-4 11-1s1 7-3 10L14 58Z"/>
    <circle cx="52" cy="11" r="6"/>
    <path d="M48 7c2 2 2 6 0 8M56 7c-2 2-2 6 0 8"/>
    <path class="s" d="M41 6h-8M42 14h-10M43 22h-6"/>`),
  'style:sharpshooter': svg(`
    <circle class="a" cx="28" cy="36" r="20"/><circle cx="28" cy="36" r="12"/>
    <circle class="f" cx="28" cy="36" r="4"/>
    <path d="M28 36 56 8M49 8h7v7M47 14l3-1M50 17l1-3"/>`),
  'style:labrat': svg(`
    <path d="M24 6h16M27 6v18L12 52c-2 4 0 6 4 6h32c4 0 6-2 4-6L37 24V6"/>
    <path class="f" d="M17 45h30l4 8c1 3-1 4-3 4H16c-2 0-4-1-3-4Z" style="opacity:.55"/>
    <circle cx="30" cy="38" r="2.5"/><circle cx="36" cy="31" r="1.8"/><circle cx="31" cy="16" r="1.5"/>`),
  'style:tortoise': svg(`
    <path class="a" d="M12 44a20 18 0 0 1 40 0Z"/>
    <path d="M24 34l8-8 8 8M18 40l6-6M46 40l-6-6"/>
    <path d="M52 42c4-2 8-2 8-6s-6-4-8 0M12 44l-5 2M18 44v6M28 44v6M37 44v6M46 44v6M4 54h56"/>
    <circle class="k" cx="57" cy="35" r="1"/>
    <path class="f" d="M51 30l2-5 3 3 3-3 1 5Z"/>`),
};

/** The drawing for an achievement (its key) or a style ('style:' + its key); a plain star otherwise. */
export function art(key) {
  return ART[key] ?? svg(`<path class="a" d="M32 8l7 15 16 2-12 11 3 16-14-8-14 8 3-16L9 25l16-2Z"/>`);
}
