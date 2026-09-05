/**
 * PUBLIC-6 — Privacy Policy. PROVISIONAL LEGAL DRAFT.
 *
 * Section order follows PCA_PUBLIC_CONTENT_EN.md section 15 exactly: summary,
 * parent account, child/device, information not centrally collected,
 * protection processing, retention, deletion, feedback/support,
 * providers/subprocessors, cookies/analytics, contact.
 *
 * Claim discipline on this page:
 *   - BLOCK-3 is open (PPR1R-D035: no privacy policy artifact; OD-13: legal
 *     entity and jurisdiction), so the page opens with the global
 *     `legal.provisionalNotice` banner in a pw-notice block, above the title,
 *     where a reader meets it before any draft sentence. routes.mjs keeps
 *     privacyPolicy non-indexable, so the notice and robots agree;
 *   - no status pill is rendered. The privacy claims this page touches
 *     (CLM-003/010/016/017/053) are EXTERNAL_SECURITY_REVIEW, and the register
 *     permits no visible status label for those at all -- they appear only as
 *     the design-language wording carried in the approved draft;
 *   - no legal entity name, jurisdiction, address, company number, contact
 *     address, retention period or provider name is stated anywhere. Where the
 *     approved draft carries only a ledger token, the page says the detail is
 *     pending owner approval;
 *   - no CTA. The approved document defines none for this page, and inventing
 *     one would put a legal draft in a conversion path.
 */

import { html, frag, richText, layout } from '../lib/components.mjs';

/** Ordered section ids; each supplies `<title>` and `<body>` content keys. */
const SECTIONS = [
  'summary',
  'account',
  'childDevice',
  'notCollected',
  'processing',
  'retention',
  'deletion',
  'feedback',
  'providers',
  'cookies',
  'contact',
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
    <h1 class="pw-hero__title">${richText(t('privacyPolicy.hero.title'))}</h1>
  </div>
</section>`;

  const sections = SECTIONS.map((id, i) =>
    section(ctx, {
      title: t(`privacyPolicy.${id}.title`),
      body: html`<p class="pw-prose">${richText(t(`privacyPolicy.${id}.body`))}</p>`,
      modifier: i % 2 === 1 ? 'pw-section--raised' : undefined,
    })
  );

  const main = frag([hero, ...sections]);

  return layout(ctx, { main });
}
