/**
 * PUBLIC-2r2 — public video registry. COORDINATOR-OWNED.
 *
 * Owner ruling of 2026-09-05 adds two first-class public videos:
 *   VIDEO 1  PCA Introduction     60-90s   on Home
 *   VIDEO 2  How to Enroll with PCA  60-120s  on How PCA Works
 *
 * RELEASE-A STRATEGY, as ruled: the site must not be blocked on final video
 * assets, must not ship a broken player, and must never make video the only way
 * to obtain critical information. So:
 *
 *   available: false  -> renders a polished poster-and-transcript card with a
 *                        "Coming later" status label. No <video> element is
 *                        emitted at all, so there is nothing to break.
 *   available: true   -> renders a real <video> with controls, preload="none",
 *                        no autoplay, a poster, and <track kind="captions"> for
 *                        every locale that has a caption file.
 *
 * The transcript renders in BOTH states. That is the accessibility requirement
 * and the redundancy requirement in one: every step a parent needs is readable
 * as text whether or not the video plays, and screen-reader and
 * reduced-motion users lose nothing.
 *
 * WHY NO CAPTION FILES YET. A .vtt file is a list of cue TIMINGS. Inventing
 * timings for a video that does not exist would be fabricating evidence of an
 * asset -- exactly the failure mode this programme exists to avoid. The scripts
 * and storyboards are authored and stored as content now; the caption files are
 * generated from them when the real recordings land, and `captions` below lists
 * the locales each video must ship before `available` may flip.
 *
 * DO NOT set available: true until the real file exists in src/assets/video/
 * AND its caption files exist. assertVideoAssets() in build.mjs enforces this.
 */

export const VIDEOS = {
  intro: {
    id: 'intro',
    /** Home. Owner target 60-90s. */
    targetDurationSeconds: [60, 90],
    poster: '/assets/video/intro-poster.svg',
    /** Set when the real recording lands. */
    src: null,
    available: false,
    /** Locales that must have caption files before `available` may flip. */
    captions: ['en', 'ar'],
    /** Content key prefix for title/summary/transcript. */
    contentPrefix: 'video.intro',
  },
  enroll: {
    id: 'enroll',
    /** How PCA Works. Owner target 60-120s. */
    targetDurationSeconds: [60, 120],
    poster: '/assets/video/enroll-poster.svg',
    src: null,
    available: false,
    captions: ['en', 'ar'],
    contentPrefix: 'video.enroll',
  },
};

export function videoById(id) {
  const video = VIDEOS[id];
  if (!video) throw new Error(`Unknown video id: ${id}`);
  return video;
}
