/**
 * Refresh the copy of the company list kept in the repository
 * (api/_lib/listedCompanies.js): every company on Nasdaq, the NYSE and NYSE
 * American. The earnings picker falls back to it when Nasdaq's directories do
 * not answer the server — as they did not from Vercel on the day the picker
 * shipped. New listings appear in the picker once this is run again:
 *   npm run refresh:listings
 */
import { writeFileSync } from 'node:fs';
import { readListings, fetchDirectories } from '../api/_lib/earnings.js';

const list = readListings(await fetchDirectories());
if (list.length < 3000) throw new Error(`Only ${list.length} companies came back.`);

const asOf = new Date().toISOString().slice(0, 10);
writeFileSync(new URL('../api/_lib/listedCompanies.js', import.meta.url), `/**
 * Every company listed on Nasdaq, the NYSE and NYSE American, as of ${asOf}:
 * what the earnings picker shows when Nasdaq's directories cannot be reached.
 * Written by scripts/refresh-listings.mjs; do not edit by hand.
 */
export const AS_OF = '${asOf}';
export const COMPANIES = ${JSON.stringify(list)};
`);
const by = (x) => list.filter((c) => c.x === x).length;
console.log(`${list.length} companies (Nasdaq ${by('Nasdaq')}, NYSE ${by('NYSE')}, NYSE American ${by('NYSE American')}), as of ${asOf}.`);
