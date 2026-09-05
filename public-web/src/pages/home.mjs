/**
 * HOME — the concise overview. OWNER IA RULING (Owner UAT, 2026-09-05).
 *
 * Home was measured at 5,784px / 6.4 viewports, ten top-level sections, nine
 * H2s, twenty cards and twelve status pills -- eight of them the same
 * "Requires platform support" label. The content was mostly right; the problem
 * was that one page owned the jobs of four.
 *
 * Home now introduces and routes, and owns no detail:
 *
 *   A hero -> B why PCA exists -> C what PCA helps protect (summary)
 *   -> D privacy difference (summary) -> E final CTA
 *
 * What moved, and to the page that owns it:
 *   - the eight protection cards and their eight status pills -> How PCA Works
 *   - the FAQ                                                  -> How PCA Works
 *   - the PCA Introduction video                               -> How PCA Works
 *   - platform availability and affordability                  -> Download PCA
 *   - the five-step summary  -> deleted; How PCA Works already carries the full
 *     eight-step journey, and a summary of it one click away was the clearest
 *     signal that the content belonged there.
 *
 * SUMMARISE AND LINK, NEVER RESTATE. Section C lists four feature NAMES copied
 * verbatim from the approved How PCA Works titles -- names, not capability
 * sentences -- so Home asserts no availability and needs no status pill. The one
 * sentence beneath them says availability depends on the platform and sends the
 * reader to the page that explains each limit. Section D shows two of the four
 * differentiators and links to /privacy/ for the rest.
 *
 * That is also what keeps Home clear of the cross-route duplicate-sentence gate:
 * the shared strings are two- and three-word titles, well under its eight-word
 * threshold, while every full sentence lives on exactly one page.
 *
 * CLAIM DISCIPLINE: Home now renders NO status pill, because it makes no
 * availability claim. That is a reduction in visual noise achieved by removing
 * the claims from this page, not by weakening them -- all eight
 * REQUIRES_PLATFORM_SUPPORT labels still render, on How PCA Works, where the
 * capability sentences they qualify now live.
 *
 * CTAs come from the shell: primaryCta() resolves the release-gated destination
 * and ctaLink() drops a link entirely when its route is not built, so Home can
 * never emit a 404 or route a parent into non-production auth.
 */

import {
  html,
  frag,
  richText,
  paragraphs,
  layout,
  card,
  ctaLink,
  primaryCta,
} from '../lib/components.mjs';

function section(ctx, { id, label, title, lead, body, modifier }) {
  return html`<section class="pw-section ${modifier ?? ''}"${id ? html` id="${id}"` : ''}>
  <div class="pw-container">
    ${label ? html`<span class="pw-eyebrow">${label}</span>` : ''}
    <h2>${richText(title)}</h2>
    ${lead ? html`<p class="pw-section__lead">${richText(lead)}</p>` : ''}
    ${body ?? ''}
  </div>
</section>`;
}

export function render(ctx) {
  const t = ctx.t;

  // --- A. Hero -------------------------------------------------------------
  // Primary CTA: See How PCA Works. Secondary: Download PCA. No third CTA --
  // three buttons in a hero is a menu, not a decision.
  const hero = html`<section class="pw-hero">
  <div class="pw-container">
    <h1 class="pw-hero__title">${richText(t('home.hero.title'))}</h1>
    <p class="pw-hero__lead">${richText(t('home.hero.body'))}</p>
    <div class="pw-cta-row">
      ${primaryCta(ctx, 'primary')}
      ${ctaLink(ctx, { routeId: 'download', label: t('nav.download'), variant: 'secondary' })}
    </div>
    <p class="pw-reassure">${richText(t('home.hero.reassure'))}</p>
  </div>
</section>`;

  // --- B. Why PCA exists ---------------------------------------------------
  const why = section(ctx, {
    label: t('home.why.label'),
    title: t('home.why.title'),
    modifier: 'pw-section--raised',
    body: paragraphs(t('home.why.body')),
  });

  // --- C. What PCA helps protect — NAMES ONLY ------------------------------
  // Four feature names, copied verbatim from the approved How PCA Works titles.
  // Names, not capability sentences: Home therefore asserts nothing about
  // availability and correctly renders no status pill. The single line beneath
  // states that availability depends on the platform and routes to the page
  // that explains each limit.
  const protects = section(ctx, {
    title: t('home.protects.title'),
    body: html`<ul class="pw-chip-list pw-plain-list">
        ${frag(t('home.protects.items').map((name) => html`<li class="pw-chip">${richText(name)}</li>`))}
      </ul>
      <p class="pw-prose">${richText(t('home.protects.body'))}</p>
      <div class="pw-cta-row">
        ${ctaLink(ctx, { routeId: 'howItWorks', label: t('cta.exploreFeatures') })}
      </div>`,
  });

  // --- D. The privacy difference — two of four ------------------------------
  // Items 1 and 3, not the first two: the owner named exactly these concepts --
  // "designed without a readable central child profile" and the family-side /
  // local-first one. Picked by meaning rather than by position.
  //
  // The remaining two, and the whole framework behind them, live on /privacy/,
  // which mentions "readable central" four times because it is the page that
  // explains it. Home now says it in the hero reassurance and in one card, and
  // nowhere else.
  const HOME_DIFFERENTIATORS = [0, 2];
  const different = section(ctx, {
    title: t('home.different.title'),
    modifier: 'pw-section--warm',
    body: html`<div class="pw-grid pw-grid--2">
        ${frag(HOME_DIFFERENTIATORS.map((i) => card(ctx, t('home.different.items')[i])))}
      </div>
      <div class="pw-cta-row">
        ${ctaLink(ctx, { routeId: 'privacy', label: t('cta.privacyHandling') })}
      </div>`,
  });

  // --- E. Final CTA --------------------------------------------------------
  const final = section(ctx, {
    title: t('home.final.title'),
    body: html`<p class="pw-prose">${richText(t('home.final.body'))}</p>
      <div class="pw-cta-row">
        ${ctaLink(ctx, { routeId: 'howItWorks', label: t('cta.howPcaWorks'), variant: 'primary' })}
        ${ctaLink(ctx, { routeId: 'download', label: t('nav.download'), variant: 'secondary' })}
      </div>`,
  });

  return layout(ctx, { main: frag([hero, why, protects, different, final]) });
}
