/**
 * The sign-in backdrop: PrismaHero from 21st.dev, with the text removed.
 *
 * That component is a full-bleed looping video, a noise pass over it, and a
 * vertical gradient, inside a rounded frame — plus a headline, a nav, a
 * paragraph and a button. Strip the words, which is what was asked for, and the
 * first four are the whole thing. They are markup and CSS; this file only
 * decides when the video runs and what shows while it does not.
 *
 * The video is served from this origin rather than hotlinked from the CDN in
 * the original snippet: that URL belongs to someone else's account, can be
 * withdrawn without notice, and would need its host opening up in the content
 * security policy. A copy in the repository needs none of that.
 *
 * It is a large file for a screen that appears before anything is unlocked, so
 * nothing waits on it. The drawn scene renders immediately underneath, and the
 * video is faded in over it once it can actually play. If it never can — the
 * standalone single-file build carries no assets folder, and a phone on a bad
 * connection may simply not finish — the drawn scene is what stays.
 */
import { setSigninScene } from './signinScene.js';

let wired = false;

/** Show or hide the backdrop. Safe to call repeatedly. */
export function setSigninHero(visible) {
  const host = document.getElementById('signinHero');
  if (!host) return;
  host.style.display = visible ? 'block' : 'none';

  const video = document.getElementById('signinHeroVideo');
  if (!visible) {
    setSigninScene(false);
    video?.pause();
    return;
  }

  // No video element at all: the drawn scene is the backdrop.
  if (!video) {
    setSigninScene(true);
    return;
  }

  const ready = video.classList.contains('is-ready');
  setSigninScene(!ready);

  if (!wired) {
    wired = true;
    // Only once a frame exists. `canplay` fires with enough decoded to start,
    // which is the earliest point the fade is not a fade into nothing.
    video.addEventListener('canplay', () => {
      video.classList.add('is-ready');
      // Stop the fallback: it is a full-screen animation loop, and leaving it
      // running behind an opaque video is battery spent on nothing.
      setSigninScene(false);
    }, { once: true });
    video.addEventListener('error', () => setSigninScene(true));
  }

  if (ready) video.currentTime = 0;
  // Muted autoplay is normally allowed, but a refusal is not an error worth
  // surfacing — the fallback is already on screen.
  const started = video.play();
  if (started && typeof started.catch === 'function') started.catch(() => {});
}
