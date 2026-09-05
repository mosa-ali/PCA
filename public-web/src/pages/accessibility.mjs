/**
 * PUBLIC-6 — Accessibility.
 *
 * Section order follows PCA_PUBLIC_CONTENT_EN.md section 14 exactly:
 * hero, accessibility goals, tell us about a barrier.
 *
 * Claim discipline on this page:
 *   - CLM-054 (accessibility conformance) is NOT_APPROVED_FOR_PUBLIC_CLAIM.
 *     A NOT_APPROVED claim may render no status pill at all, so this page
 *     attaches no claimId and shows no status label. It states what PCA
 *     designs and tests for -- a commitment -- plus a contact path, and never
 *     a conformance standard, grade or statute. build.mjs scans rendered
 *     output for those strings and fails the build on a match;
 *   - the barrier route is reached only through ctaLink(), which renders
 *     nothing while /contact is not built, so this page can never emit a dead
 *     link into an unbuilt route.
 */

import {
  html,
  frag,
  richText,
  layout,
  ctaLink,
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

  const hero = html`<section class="pw-hero">
  <div class="pw-container">
    <h1 class="pw-hero__title">${richText(t('accessibility.hero.title'))}</h1>
    <p class="pw-hero__lead">${richText(t('accessibility.hero.body'))}</p>
  </div>
</section>`;

  const goals = section(ctx, {
    title: t('accessibility.goals.title'),
    lead: t('accessibility.goals.lead'),
    modifier: 'pw-section--raised',
    body: html`<ul class="pw-principles">
        ${frag(t('accessibility.goals.items').map((item) => html`<li>${richText(item)}</li>`))}
      </ul>`,
  });

  const barrier = section(ctx, {
    title: t('accessibility.barrier.title'),
    body: html`<p class="pw-prose">${richText(t('accessibility.barrier.body'))}</p>
      <div class="pw-cta-row">
        ${ctaLink(ctx, { routeId: 'contact', label: t('accessibility.cta.contact') })}
      </div>`,
  });

  const main = frag([hero, goals, barrier]);

  return layout(ctx, { main });
}
