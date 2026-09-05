/**
 * PUBLIC-2r2 — PRIVACY & SAFETY (/privacy, /ar/privacy).
 *
 * The consolidated trust page. The owner IA ruling of 2026-09-05 collapses the
 * public site to three pages, and this one absorbs the former /privacy,
 * /security and /child-safety routes.
 *
 * SHAPE. Parents who open this page are actively looking for trust information,
 * so it may be longer than Home or How PCA Works -- but it is still built to be
 * scanned, not read end to end: a one-line promise, then three cards for where
 * information lives, a bullet list of what is never centrally stored, six short
 * topic cards, and only then prose. Section order is the owner's A..M:
 *
 *   A hero promise               E what PCA does not collect
 *   B/C/D where information lives  F..J photos, messages, app use, browsing,
 *   (one card each)                     location, camera
 *   K retention and deletion     L child safety principles
 *   M privacy FAQ                + a clearly-marked advanced section, last
 *
 * The "why we avoid absolute privacy slogans" block sits between E and F: it
 * explains why the page never says PCA collects nothing at all, which reads
 * naturally straight after the exclusion list. It is not one of the owner's
 * lettered sections, so its placement does not disturb their order.
 *
 * CLAIM DISCIPLINE. Only four elements on this page carry a claimId, and each
 * one is a claim whose register status permits a visible label:
 *   CLM-015 (local processing)      -> "Limited"
 *   CLM-036 (location feature)      -> "Requires platform support"
 *   CLM-037 (camera/eye distance)   -> "Coming later"
 *   CLM-046 (Parent/Admin realms)   -> "Available", inside the advanced section
 * Everything else is EXTERNAL_SECURITY_REVIEW (CLM-003, CLM-004, CLM-005..
 * CLM-014, CLM-016, CLM-017, CLM-049, CLM-053) or NOT_APPROVED (CLM-043), so no
 * claimId is attached and no pill renders -- the wording carries the hedge
 * instead ("is designed to", "may keep", "must not", "will be documented once it
 * has been verified"). Post-proof wording such as "cannot read" or "never sees"
 * appears nowhere, and no element promises a deletion control: PPR1R-D036
 * records that no account-deletion path exists.
 *
 * ADVANCED SECTION. The ruling forbids internal implementation jargon in
 * parent-facing copy except inside a clearly-marked advanced section. Exactly
 * one section is so marked, it is last, it carries its own "you do not need
 * this" lead, and it is the only place words like RBAC or TLS appear.
 *
 * MARKUP. Only classes that already exist in src/styles/base.css and
 * components.css are used, and no element carries a style attribute -- the
 * production CSP blocks inline styles. Every outbound link goes through
 * ctaLink(), which renders nothing for a route this release does not build.
 */

import {
  html,
  frag,
  richText,
  paragraphs,
  layout,
  card,
  faqItem,
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

/** The page's two calls to action: the full policy, and how PCA works. */
function ctaRow(ctx) {
  return html`<div class="pw-cta-row">
      ${ctaLink(ctx, { routeId: 'howItWorks', label: ctx.t('cta.howPcaWorks'), variant: 'primary' })}
      ${ctaLink(ctx, { routeId: 'privacyPolicy', label: ctx.t('privacy.cta.policy'), variant: 'secondary' })}
    </div>`;
}

export function render(ctx) {
  const t = ctx.t;

  // A — the promise, in one sentence. CLM-004 / CLM-003, design language.
  const hero = html`<section class="pw-hero">
  <div class="pw-container">
    <h1 class="pw-hero__title">${richText(t('privacy.hero.title'))}</h1>
    <p class="pw-hero__lead">${richText(t('privacy.hero.body'))}</p>
    ${ctaRow(ctx)}
  </div>
</section>`;

  // B, C, D — three cards, scannable side by side. Only the first carries a
  // label (CLM-015, LIMITED); CLM-016/CLM-053/CLM-017 render none.
  const where = section(ctx, {
    title: t('privacy.where.title'),
    body: html`<div class="pw-grid pw-grid--3">
        ${frag(t('privacy.where.items').map((item) => card(ctx, item)))}
      </div>`,
  });

  // E — the exclusion list, stated as a design requirement, not a proven
  // outcome. CLM-003 / CLM-005..CLM-014.
  const notStored = section(ctx, {
    title: t('privacy.notStored.title'),
    modifier: 'pw-section--warm',
    body: html`<ul class="pw-principles">
        ${frag(t('privacy.notStored.items').map((item) => html`<li>${richText(item)}</li>`))}
      </ul>`,
  });

  // Why the page never claims PCA collects nothing at all.
  const honesty = section(ctx, {
    title: t('privacy.honesty.title'),
    modifier: 'pw-section--raised',
    body: html`<p class="pw-prose">${richText(t('privacy.honesty.body'))}</p>`,
  });

  // F..J — one short card per sensitive topic. Location and camera carry their
  // registered labels instead of the internal availability directives the
  // approved source embedded in their body copy.
  const topics = section(ctx, {
    title: t('privacy.topics.title'),
    body: html`<div class="pw-grid pw-grid--2 pw-grid--3">
        ${frag(t('privacy.topics.items').map((item) => card(ctx, item)))}
      </div>`,
  });

  // K — CLM-043 is NOT_APPROVED. No deletion control is offered or implied.
  const retention = section(ctx, {
    title: t('privacy.retention.title'),
    modifier: 'pw-section--raised',
    body: paragraphs(t('privacy.retention.body'), 'pw-prose'),
  });

  // L — the nine child safety principles, absorbed from /child-safety. An <ol>
  // because the approved document numbers them; .pw-principles supplies the
  // list styling, so no inline style is needed.
  const principleItems = t('privacy.principles.items').map(
    (item) => html`<li>
          <div>
            <h3 class="pw-card__title">${richText(item.title)}</h3>
            <p class="pw-card__body">${richText(item.body)}</p>
          </div>
        </li>`
  );

  const principles = section(ctx, {
    title: t('privacy.principles.title'),
    lead: t('privacy.principles.lead'),
    body: html`<ol class="pw-principles">${frag(principleItems)}</ol>`,
  });

  // M — a short FAQ, not the old fifteen-question page.
  const faq = section(ctx, {
    title: t('privacy.faq.title'),
    modifier: 'pw-section--warm',
    body: html`<div class="pw-faq">${frag(t('privacy.faq.items').map((item) => faqItem(item)))}</div>`,
  });

  // The only place technical vocabulary is allowed, clearly marked and last.
  const advanced = section(ctx, {
    id: 'advanced',
    title: t('privacy.advanced.title'),
    lead: t('privacy.advanced.lead'),
    body: html`<div class="pw-grid pw-grid--2">
        ${frag(t('privacy.advanced.items').map((item) => card(ctx, item)))}
      </div>
      ${ctaRow(ctx)}`,
  });

  const main = frag([hero, where, notStored, honesty, topics, retention, principles, faq, advanced]);

  return layout(ctx, { main });
}
