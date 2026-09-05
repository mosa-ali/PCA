/**
 * PUBLIC-6 (revision 2) — HOME, the consolidated main page.
 *
 * OWNER IA RULING, 2026-09-05. Parents will not read a fourteen-page marketing
 * tree, so Home now carries everything the old /why-pca, /about, /features,
 * /parents, /access, /child-safety and /faq pages carried that a parent
 * actually needs, in a fast, scannable, visual, low-text form. Section order is
 * the owner's, exactly:
 *
 *   A hero -> B intro video -> C why PCA exists -> D what PCA protects
 *   -> E why PCA is different -> F how it works (summary) -> G availability
 *   -> H affordability -> I FAQ -> J final CTA
 *
 * SUMMARISE AND LINK, NEVER RESTATE. The long-form privacy explanation belongs
 * to /privacy/ and the full enrollment journey to /how-it-works/. Sections E
 * and F therefore end in a link to those pages instead of repeating them, and
 * every card body is a single short line. That is both the ruling and what
 * keeps Home clear of build.mjs's cross-route duplicate-sentence gate.
 *
 * CLAIM DISCIPLINE ON THIS PAGE
 *   - the eight "What PCA protects" cards each render their registered
 *     REQUIRES_PLATFORM_SUPPORT label (CLM-028..CLM-035) via card()'s claimId;
 *   - the four "Why PCA is different" cards carry NO claimId on purpose. Their
 *     claims are EXTERNAL_SECURITY_REVIEW or values-level, which claims.mjs
 *     maps to a null label, so they must be plain prose in design language;
 *   - availability renders CLM-024 / CLM-026 ("Coming later") and carries no
 *     store name, badge, link or download action of any kind;
 *   - affordability is the CLM-040 VALUES claim rendered as prose with no
 *     status pill: an "Available" badge beside it would read as a pricing
 *     promise. No price, no plan, no free-tier statement.
 *
 * CTAs come from the shell, never from this file: primaryCta() resolves the
 * release-gated destination and ctaLink() drops the link entirely when the
 * target route is not built, so Home can never emit a 404 or route a parent
 * into non-production auth.
 *
 * FILE OWNERSHIP: exactly one writer owns this file plus its two content
 * tables. It does not import from, and must not modify, src/content/index.mjs,
 * routes.mjs, claims.mjs, videos.mjs, build.mjs, src/lib or src/styles.
 */

import {
  html,
  frag,
  richText,
  paragraphs,
  layout,
  card,
  stepCard,
  faqItem,
  videoBlock,
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

  // --- A. Hero ------------------------------------------------------------
  // Headline, one very short supporting line, both CTAs from the shell, and
  // the short reassurance line.
  const hero = html`<section class="pw-hero">
  <div class="pw-container">
    <h1 class="pw-hero__title">${richText(t('home.hero.title'))}</h1>
    <p class="pw-hero__lead">${richText(t('home.hero.body'))}</p>
    <div class="pw-cta-row">
      ${primaryCta(ctx, 'primary')}
      ${ctaLink(ctx, { routeId: 'privacy', label: t('cta.privacyHandling'), variant: 'secondary' })}
    </div>
    <p class="pw-reassure">${richText(t('home.hero.reassure'))}</p>
  </div>
</section>`;

  // --- B. Short PCA introduction video ------------------------------------
  // headingLevel 2: this block is a top-level page section with no h2 of its
  // own, so an h3 here skips a level after the hero h1.
  // videoBlock() supplies the title, summary and full transcript from the video
  // content table, and renders the poster-and-transcript placeholder while no
  // recording exists. Nothing is added around it: the figure carries its own
  // heading, so a second one here would only duplicate it.
  const video = html`<section class="pw-section">
  <div class="pw-container">
    ${videoBlock(ctx, 'intro', { headingLevel: 2 })}
  </div>
</section>`;

  // --- C. Why PCA exists --------------------------------------------------
  const why = section(ctx, {
    label: t('home.why.label'),
    title: t('home.why.title'),
    modifier: 'pw-section--raised',
    body: paragraphs(t('home.why.body')),
  });

  // --- D. What PCA protects — one visual card per capability --------------
  const protects = section(ctx, {
    label: t('home.protects.label'),
    title: t('home.protects.title'),
    body: html`<div class="pw-grid pw-grid--2 pw-grid--4">
        ${frag(t('home.protects.items').map((item) => card(ctx, item)))}
      </div>`,
  });

  // --- E. Why PCA is different — prose cards, no status pill --------------
  // The detail lives on /privacy/. This links there rather than restating it.
  const different = section(ctx, {
    label: t('home.different.label'),
    title: t('home.different.title'),
    modifier: 'pw-section--warm',
    body: html`<div class="pw-grid pw-grid--2">
        ${frag(t('home.different.items').map((item) => card(ctx, item)))}
      </div>
      <div class="pw-cta-row">
        ${ctaLink(ctx, { routeId: 'privacy', label: t('cta.privacyHandling') })}
      </div>`,
  });

  // --- F. How it works — SUMMARY ONLY -------------------------------------
  // The full journey lives on /how-it-works/; these are one short line each.
  const steps = section(ctx, {
    label: t('home.steps.label'),
    title: t('home.steps.title'),
    modifier: 'pw-section--raised',
    body: html`<ol class="pw-grid pw-grid--2 pw-grid--3 pw-plain-list">
        ${frag(
          t('home.steps.items').map(
            (item, i) => html`<li>${stepCard(ctx, { ...item, index: i + 1 })}</li>`
          )
        )}
      </ol>
      <div class="pw-cta-row">
        ${ctaLink(ctx, { routeId: 'howItWorks', label: t('cta.howPcaWorks') })}
      </div>`,
  });

  // --- G. Availability — COMING_LATER labels, no download action ----------
  const availability = section(ctx, {
    label: t('home.availability.label'),
    title: t('home.availability.title'),
    body: html`<div class="pw-grid pw-grid--3">
        ${frag(t('home.availability.items').map((item) => card(ctx, item)))}
      </div>`,
  });

  // --- H. Affordability — CLM-040 values statement, deliberately no pill --
  const affordability = section(ctx, {
    label: t('home.affordability.label'),
    title: t('home.affordability.title'),
    modifier: 'pw-section--warm',
    body: html`<p class="pw-prose">${richText(t('home.affordability.body'))}</p>`,
  });

  // --- I. FAQ -------------------------------------------------------------
  const faq = section(ctx, {
    label: t('home.faq.label'),
    title: t('home.faq.title'),
    body: html`<div class="pw-faq">${frag(t('home.faq.items').map((item) => faqItem(item)))}</div>`,
  });

  // --- J. Final CTA -------------------------------------------------------
  const final = section(ctx, {
    title: t('home.final.title'),
    modifier: 'pw-section--raised',
    body: html`<p class="pw-prose">${richText(t('home.final.body'))}</p>
      <div class="pw-cta-row">
        ${primaryCta(ctx, 'primary')}
        ${ctaLink(ctx, { routeId: 'privacy', label: t('cta.privacyHandling'), variant: 'secondary' })}
      </div>`,
  });

  const main = frag([hero, video, why, protects, different, steps, availability, affordability, faq, final]);

  return layout(ctx, { main });
}
