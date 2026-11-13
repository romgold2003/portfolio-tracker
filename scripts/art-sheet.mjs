/**
 * A contact sheet of every trader-card drawing (src/ui/art/cards.js), in the
 * dark and the light theme, for checking them by eye after a change:
 *
 *   node scripts/art-sheet.mjs <out>   → <out>-dark.png and <out>-light.png
 *
 * Needs puppeteer-core and Chrome, as scripts/tour-shots.mjs does.
 */
import { readFileSync } from 'node:fs';
import { art } from '../src/ui/art/cards.js';
import { TITLES } from '../src/core/insights.js';

const { default: puppeteer } = await import(process.env.PUPPETEER ?? 'puppeteer-core');
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const out = process.argv[2] ?? 'art-sheet';

const ACH = ['correction', 'bear', 'storm', 'crashproof', 'dip', 'fed', 'doubler', 'tenbagger', 'fourfigures', 'fivefigures',
  'hotstreak', 'unstoppable', 'perfectweek', 'marketbeater', 'oneyear', 'longhaul', 'ironwill', 'diamond', 'phoenix',
  'patiencepays', 'steady', 'first', 'ten', 'fifty', 'hundred', 'explorer', 'crypto', 'short', 'journal', 'smalllosses'];
const keys = [...ACH, ...Object.keys(TITLES).map((k) => `style:${k}`)];
const rarity = ['r-common', 'r-rare', 'r-epic', 'r-legendary'];
const css = readFileSync(new URL('../styles/components.css', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');

const grid = () => `<section class="sheet">${keys.map((k, i) => `
  <div class="ach ${rarity[i % 4]}"><span class="ach-icon">${art(k)}</span><b>${k.replace('style:', '')}</b></div>`).join('')}</section>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${tokens}${css}
  body{margin:0;font-family:system-ui,sans-serif}
  .sheet{display:grid;grid-template-columns:repeat(9,1fr);gap:8px;padding:12px;background:var(--panel)}
  .ach{padding:8px 4px}.ach b{font-size:10px}
</style></head><body>${grid()}</body></html>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: 1100, height: 900, deviceScaleFactor: 1 } });
const page = await browser.newPage();
await page.setContent(html);
await page.screenshot({ path: `${out}-dark.png`, fullPage: true });
await page.evaluate(() => document.body.classList.add('light'));
await page.screenshot({ path: `${out}-light.png`, fullPage: true });
await browser.close();
console.log(`${out}-dark.png`, `${out}-light.png`);
