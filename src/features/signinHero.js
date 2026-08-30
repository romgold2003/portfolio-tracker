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
 */

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

  // Muted autoplay is normally allowed, but a refusal is not an error worth
  // surfacing — the still behind it is already the same picture.
  const started = video.play();
  if (started && typeof started.catch === 'function') started.catch(() => {});
}
