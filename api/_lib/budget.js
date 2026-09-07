/**
 * Answer with what you have rather than waiting for what you might get.
 *
 * Written for a real outage. The whale feed awaited a full sweep of five
 * chains before answering — about twenty-five seconds warm, and longer when the
 * price map and the platform map are both cold. Vercel cuts a function at
 * sixty seconds, so the first request into a cold function returned 504 and the
 * reader got nothing at all, from a store that already held thirty-three
 * perfectly good rows.
 *
 * The sweep was never the point of the request. Something else fills the store
 * on a schedule; a page load only reads it. So the read starts a sweep, waits a
 * few seconds in case it is quick, and then answers regardless.
 *
 * **The work is not cancelled.** It keeps running, and on a platform that
 * freezes a function after the response this means it finishes what it can and
 * no more — which is fine here, because every transfer is written on its own.
 * A sweep cut halfway leaves real rows behind rather than a broken half-write.
 */

/**
 * Wait for `work`, but not longer than `ms`.
 *
 * @param {Promise} work     already started — this never starts it
 * @param {number}  ms       how long the answer will wait
 * @param {*}       fallback what to answer with when the wait runs out
 * @returns the work's value if it lands in time, otherwise the fallback
 */
export function withBudget(work, ms, fallback) {
  // A budget of zero or less means "do not wait at all", which is a real
  // request and not a mistake — the caller wants the work started and nothing
  // more. It still must not reject, so the failure is swallowed here too.
  const safe = Promise.resolve(work).catch(() => fallback);
  if (!(ms > 0)) return Promise.resolve(fallback).then((v) => { safe.catch(() => {}); return v; });

  return Promise.race([
    safe,
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(fallback), ms);
      // Nothing should hold a process open for a timer that has been overtaken.
      if (typeof timer?.unref === 'function') timer.unref();
    }),
  ]);
}
