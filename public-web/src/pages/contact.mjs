/**
 * PUBLIC-6 — Contact.
 *
 * Section order follows PCA_PUBLIC_CONTENT_EN.md section 13 exactly: hero,
 * categories, privacy note.
 *
 * Claim discipline on this page:
 *   - RELEASE A RENDERS NO FORM. lib/seo.mjs sets form-action 'none' in the
 *     CSP and build.mjs fails on any external reference, so a form here could
 *     only be a control that cannot submit. The approved "Suggested form"
 *     block is a specification for a later release; its field labels, submit
 *     button and success/error strings are not printed as page copy. The six
 *     approved categories are rendered as descriptive content only.
 *   - The approved document names NO email address, mailbox or other contact
 *     channel for this page, and none is invented here. The page therefore
 *     routes the reader to the two approved destinations that exist today --
 *     Help (FAQ) and Privacy & Security -- via ctaLink(), which renders
 *     nothing at all for a route that is not built in this release.
 *   - No claim id is attached anywhere on this page: nothing here asserts the
 *     availability of a feature, a platform or a support channel, so no status
 *     pill is warranted and none is emitted.
 */

import { html, frag, richText, layout, ctaLink } from '../lib/components.mjs';

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
    <h1 class="pw-hero__title">${richText(t('contact.hero.title'))}</h1>
    <p class="pw-hero__lead">${richText(t('contact.hero.body'))}</p>
  </div>
</section>`;

  // Descriptive list, not a control: no <form>, no <input>, no <select> and no
  // submit action anywhere in this subtree.
  const categories = section(ctx, {
    title: t('contact.categories.title'),
    modifier: 'pw-section--raised',
    body: html`<ul class="pw-principles">
        ${frag(t('contact.categories.items').map((item) => html`<li>${richText(item)}</li>`))}
      </ul>
      <div class="pw-cta-row">
        ${ctaLink(ctx, { routeId: 'faq', label: t('cta.allFaqs') })}
      </div>`,
  });

  const privacyNote = section(ctx, {
    title: t('contact.privacyNote.title'),
    modifier: 'pw-section--warm',
    body: html`<div class="pw-notice">
        <p>${richText(t('contact.privacyNote.body'))}</p>
      </div>
      <div class="pw-cta-row">
        ${ctaLink(ctx, { routeId: 'privacy', label: t('cta.privacyHandling') })}
      </div>`,
  });

  const main = frag([hero, categories, privacyNote]);

  return layout(ctx, { main });
}
