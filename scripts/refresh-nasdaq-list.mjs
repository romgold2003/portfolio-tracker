/**
 * Refresh the copy of Nasdaq's company list kept in the repository
 * (api/_lib/nasdaqListed.js), which the earnings picker falls back to when
 * nasdaqtrader.com does not answer the server — as it did not from Vercel on
 * the day the picker shipped. New listings appear in the picker once this is
 * run again:  npm run refresh:nasdaq
 */
import { writeFileSync } from 'node:fs';
import { readNasdaqListed } from '../api/_lib/earnings.js';

const res = await fetch('https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt');
if (!res.ok) throw new Error(`Nasdaq answered ${res.status}.`);
const list = readNasdaqListed(await res.text());
if (list.length < 500) throw new Error(`Only ${list.length} companies came back.`);

const asOf = new Date().toISOString().slice(0, 10);
writeFileSync(new URL('../api/_lib/nasdaqListed.js', import.meta.url), `/**
 * Every company listed on Nasdaq, as of ${asOf}: what the earnings picker shows
 * when Nasdaq's directory cannot be reached. Written by
 * scripts/refresh-nasdaq-list.mjs; do not edit by hand.
 */
export const AS_OF = '${asOf}';
export const COMPANIES = ${JSON.stringify(list)};
`);
console.log(`${list.length} companies, as of ${asOf}.`);
