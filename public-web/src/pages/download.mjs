/**
 * DOWNLOAD PCA — the fourth primary page.
 *
 * It exists as a destination in its own right because Release A has no public
 * login, so "get the app" is the parent-facing conversion action and it needs
 * somewhere to land. It exists WHILE NOTHING IS DOWNLOADABLE for the same
 * reason: a parent looking for the app will look for it, and a page that says
 * plainly what does not exist yet is more use than no page at all.
 *
 * The whole design problem here is one sentence: the page must be visible and
 * must not imply a download. So the honest statement comes FIRST, above the
 * platform cards, rather than being a caveat underneath them. CLM-024's register
 * entry already states the constraint in terms -- "NO store badge, NO download
 * action" -- and release-a-adversarial.mjs asserts it against the built artifact:
 * no store URL, no badge wording, no badge image, no .apk/.ipa/.aab, and both
 * locales must say that nothing is downloadable yet.
 *
 * Every string on this page was MOVED unchanged from home.* or howItWorks.*,
 * except the SEO pair and the hero, so the native Arabic review carries over for
 * the rest.
 */

import { html, frag, richText } from '../lib/html.mjs';
import { layout, card, ctaLink } from '../lib/components.mjs';

function section(ctx, { id, label, title, lead, body, modifier }) {
  return html`<section class="pw-section ${modifier ?? ''}"${id ? html` id="${id}"` : ''}>
  <div class="pw-container">
    ${label ? html`<p class="pw-section__label">${label}</p>` : ''}
    <h2 class="pw-section__title">${richText(title)}</h2>
    ${lead ? html`<p class="pw-section__lead">${richText(lead)}</p>` : ''}
    ${body}
  </div>
</section>`;
}

export function render(ctx) {
  const t = ctx.t;

  const hero = html`<section class="pw-hero pw-hero--compact">
  <div class="pw-container">
    <h1 class="pw-hero__title">${richText(t('download.hero.title'))}</h1>
    <p class="pw-hero__lead">${richText(t('download.hero.body'))}</p>
  </div>
</section>`;

  // ONE availability section, not two.
  //
  // The first draft of this page had a three-card "PCA Parent and PCA Child"
  // section AND a two-card "Download PCA Child" section, which said Android and
  // iPhone/iPad twice with different wording. The cross-route duplicate-sentence
  // gate passed it -- the sentences differ -- but it is the same content purpose
  // stated twice on one page, which is exactly what "one purpose, one authority"
  // is meant to prevent. Caught by looking at the rendered page.
  //
  // So: the honest lead sits above one set of three cards covering all three
  // surfaces, each with its own registered status.
  const platforms = section(ctx, {
    id: 'download',
    label: t('download.platforms.label'),
    title: t('download.platforms.title'),
    lead: t('download.child.lead'),
    body: html`<div class="pw-grid pw-grid--3">
        ${frag(t('download.platforms.items').map((item) => card(ctx, item)))}
      </div>`,
  });

  const affordability = section(ctx, {
    label: t('download.affordability.label'),
    title: t('download.affordability.title'),
    body: html`<p class="pw-prose">${richText(t('download.affordability.body'))}</p>
      <div class="pw-cta-row">
        ${ctaLink(ctx, { routeId: 'howItWorks', label: t('cta.howPcaWorks') })}
        ${ctaLink(ctx, { routeId: 'privacy', label: t('cta.privacyHandling') })}
      </div>`,
  });

  return layout(ctx, { main: frag([hero, platforms, affordability]) });
}
