/**
 * PUBLIC-6 — Terms. PROVISIONAL LEGAL DRAFT.
 *
 * Section order follows PCA_PUBLIC_CONTENT_EN.md section 16 exactly: using
 * PCA, parent responsibility, feature availability, account security,
 * acceptable use, privacy, changes and service availability.
 *
 * Claim discipline on this page:
 *   - BLOCK-3 is open (PPR1R-D035 and OD-13), so the page opens with the
 *     global `legal.provisionalNotice` banner in a pw-notice block, above the
 *     title. routes.mjs keeps terms non-indexable, so the notice and robots
 *     agree;
 *   - no status pill is rendered: the "Feature availability" section states in
 *     prose that platform-dependent and "Coming Later" functionality is not a
 *     current contractual promise, which is the contract-side statement of the
 *     same gate the feature cards render as a pill elsewhere;
 *   - BLOCK-1: no plan, price, currency or free-tier term appears anywhere.
 *     The approved draft's plan-terms line is a publication warning addressed
 *     to legal review, not body copy, and is not printed;
 *   - no legal entity name, jurisdiction, age/guardian term, liability or
 *     dispute clause is invented. Where the approved draft carries only a
 *     ledger token, the page says the wording is pending owner approval;
 *   - no CTA. The approved document defines none for this page.
 */

import { html, frag, richText, layout } from '../lib/components.mjs';

/** Ordered section ids; each supplies `<title>` and `<body>` content keys. */
const SECTIONS = [
  'using',
  'responsibility',
  'availability',
  'accountSecurity',
  'acceptableUse',
  'privacy',
  'changes',
];

function section(ctx, { id, title, body, modifier }) {
  return html`<section class="pw-section ${modifier ?? ''}"${id ? html` id="${id}"` : ''}>
  <div class="pw-container">
    <h2>${richText(title)}</h2>
    ${body ?? ''}
  </div>
</section>`;
}

export function render(ctx) {
  const t = ctx.t;

  // The provisional banner comes first, before the page title, so it cannot be
  // mistaken for a footnote to an approved document.
  const hero = html`<section class="pw-hero">
  <div class="pw-container">
    <div class="pw-notice" role="note">
      <p>${richText(t('legal.provisionalNotice'))}</p>
    </div>
    <h1 class="pw-hero__title">${richText(t('terms.hero.title'))}</h1>
  </div>
</section>`;

  const sections = SECTIONS.map((id, i) =>
    section(ctx, {
      title: t(`terms.${id}.title`),
      body: html`<p class="pw-prose">${richText(t(`terms.${id}.body`))}</p>`,
      modifier: i % 2 === 1 ? 'pw-section--raised' : undefined,
    })
  );

  const main = frag([hero, ...sections]);

  return layout(ctx, { main });
}
