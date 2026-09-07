/**
 * The sign-in backdrop: PrismaHero from 21st.dev, with the text removed.
 *
 * That component is a full-bleed looping video, a noise pass over it, and a
 * vertical gradient, inside a rounded frame — plus a headline, a nav, a
 * paragraph and a button. Strip the words, which is what was asked for, and the
 * first four are the whole thing. They are markup and CSS; this file only
 * starts and stops the video.
 *
 * The video is served from this origin rather than hotlinked from the CDN in
 * the original snippet: that URL belongs to someone else's account, can be
 * withdrawn without notice, and would need its host opening up in the content
 * security policy. A copy in the repository needs none of that.
 *
 * Nothing waits on it. Its own first frame is inlined in the stylesheet as a
 * small JPEG behind it, so the picture is there immediately and the video fades
 * in over it once it can play.
 *
 * ── Why the file is named here and not in the markup ─────────────────────
 *
 * It used to be a `src` with `preload="auto"`, which meant the browser started
 * downloading sixteen megabytes while it was still parsing the page — for
 * every visitor, including every signed-in one, who never sees this screen at
 * all. Measured on the deployed site: the video request went out on load,
 * before any code had decided whether the backdrop was wanted.
 *
 * So the file is named only when the backdrop is actually shown, and not at
 * all when the connection or the reader has said not to. The still behind it
 * is the same picture, so nobody who skips the video sees a gap.
 */

/**
 * When a sixteen megabyte decoration is the wrong thing to send.
 *
 * Data saver is an explicit request and is obeyed as one. A slow connection is
 * a strong hint that the bytes are better spent on the app itself. Reduced
 * motion is an accessibility setting, and a looping background video is
 * exactly the motion it asks about.
 */
function wantsVideo() {
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
    const link = navigator.connection;
    if (link?.saveData) return false;
    if (link?.effectiveType && /^(slow-)?2g$|^3g$/.test(link.effectiveType)) return false;
  } catch { /* an old browser tells us nothing, which is not a reason to skip */ }
  return true;
}

/** Show or hide the backdrop. Safe to call repeatedly. */
export function setSigninHero(visible) {
  const host = document.getElementById('signinHero');
  if (!host) return;
  host.style.display = visible ? 'block' : 'none';

  const video = document.getElementById('signinHeroVideo');
  if (!video) return;

  if (!visible) {
    video.pause();
    return;
  }

  // Only once there is a frame to show, so the fade is not a fade into nothing.
  if (!video.classList.contains('is-ready')) {
    video.addEventListener('canplay', () => video.classList.add('is-ready'), { once: true });
  }

  /**
   * The first request for it, made now rather than at parse time.
   *
   * A failure needs no handling: `canplay` never fires, `is-ready` is never
   * added, and the still stays exactly as it was. That is also what happens in
   * the standalone single-file build, which has no assets folder to serve from.
   */
  if (!video.src && video.dataset.src) {
    if (!wantsVideo()) return;
    video.src = video.dataset.src;
  }

  // Muted autoplay is normally allowed, but a refusal is not an error worth
  // surfacing — the still behind it is already the same picture.
  const started = video.play();
  if (started && typeof started.catch === 'function') started.catch(() => {});
}
