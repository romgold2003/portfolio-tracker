/**
 * When each whale collector last ran, and when it last worked.
 *
 * This exists because the collector failed for four days in late September
 * and nothing anywhere said so. The scheduled job stayed green, the card went
 * empty, and the Spot panel's "updated 1 minute ago" — which was when the
 * browser had fetched the list, not when anything had been collected — told
 * the reader everything was fine throughout.
 *
 * So each job notes its own outcome, and the card reads it back: the real time
 * of the last successful collection, and a plain warning when that is old.
 *
 * Kept in the `settings` table as one small row per job, written with an
 * upsert both Postgres and SQLite understand.
 */
import { query } from './db.js';

/** The jobs worth reporting on, as the card names them. */
export const JOBS = ['transfers', 'holders', 'gmx', 'spot'];

/**
 * Twelve hours. GitHub runs the schedule about every four, so three runs in a
 * row have to miss before this trips — long enough not to cry wolf over one
 * bad afternoon, short enough to say so the same day.
 */
export const STALE_AFTER_S = 12 * 60 * 60;

const UPSERT = 'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value';

/** Record one run of a job. A success also moves its last-good time. */
export async function noteRun(job, { ok, detail = '', now = Date.now() }) {
  const at = Math.floor(now / 1000);
  await query(UPSERT, [`collector:${job}:last`, JSON.stringify({ at, ok: !!ok, detail: String(detail).slice(0, 300) })]);
  if (ok) await query(UPSERT, [`collector:${job}:ok`, String(at)]);
}

/** Every job's last run and last success, and whether that success is too old. */
export async function readHealth({ now = Date.now() } = {}) {
  const nowS = Math.floor(now / 1000);
  const { rows } = await query("SELECT key, value FROM settings WHERE key LIKE 'collector:%'", []);
  const raw = new Map(rows.map((r) => [r.key, r.value]));

  const out = {};
  for (const job of JOBS) {
    let last = null;
    try { last = JSON.parse(raw.get(`collector:${job}:last`) ?? 'null'); } catch { /* a bad row reads as none */ }
    const okAt = Number(raw.get(`collector:${job}:ok`)) || null;
    out[job] = {
      okAt,
      lastAt: last?.at ?? null,
      lastOk: last?.ok ?? null,
      detail: last?.detail ?? '',
      // Never collected counts as stale: an empty panel with no history is
      // exactly the state that needs saying out loud.
      stale: !okAt || nowS - okAt > STALE_AFTER_S,
    };
  }
  return out;
}
