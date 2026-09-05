/**
 * PUBLIC-7 — HOW PCA WORKS. One of the three main public pages.
 *
 * OWNER IA RULING, 2026-09-05: the public site is Home, How PCA Works and
 * Privacy & Safety. This route is the whole journey, consolidated from the
 * former /how-it-works, /download and /parents pages, and built to be scanned
 * rather than read -- an eight-card step list, three short card groups and one
 * sentence about sensitive information that hands off to /privacy/.
 *
 * SECTION ORDER
 *   1. Hero          — what the journey is.
 *   2. The journey   — the enrollment video, then the eight step cards.
 *   3. PCA Parent    — browser use, installation, installation is optional.
 *   4. Security      — installing is not Trusted Browser authorization.
 *   5. PCA Child     — Android and iPhone/iPad release status.
 *   6. Sensitive information — one sentence, then a link to /privacy/.
 *
 * WHY THE VIDEO SITS INSIDE THE STEP SECTION, ABOVE THE CARDS. The owner ruling
 * forbids making video the only way to obtain critical information. Putting it
 * under the same heading as the step cards makes the redundancy structural: a
 * parent who ignores the video, cannot play it, or arrives while the recording
 * does not yet exist still meets all eight steps immediately below it, as text.
 * It also keeps the heading order h1 -> h2 -> h3 intact; videoBlock() emits an
 * h3, so a bare video section between the h1 and the first h2 would skip a
 * level for a screen-reader user. While VIDEOS.enroll.available is false the
 * block renders a poster, a "Coming later" label and the full transcript, and
 * emits no <video> element at all -- there is no broken player.
 *
 * CLAIM DISCIPLINE ON THIS PAGE
 *   - CLM-021 (browser use without installing) is VERIFIED_AVAILABLE and is the
 *     only "Available" label rendered here.
 *   - CLM-019 (installability) and CLM-020 (installation optional) are
 *     COMING_LATER: described, never offered. No install button is rendered,
 *     because Release C has not passed and the button would be dead.
 *   - CLM-024 appears twice, on the "Install PCA Child" step and on the Android
 *     card, so a parent cannot read the step list as an instruction to go and
 *     install something today. CLM-026 carries the owner-approved DEF-1
 *     replacement wording for iPhone/iPad.
 *   - CLM-022 is stated as plain prose in a notice with NO claimId. It is
 *     VERIFIED_AVAILABLE, so attaching it would render an "Available" pill --
 *     and a green availability badge on a security *distinction* would read as
 *     a feature badge. claims.mjs decides labels; this page decides only where
 *     a label is meaningful.
 *   - NOTHING on this page is a download action, a store badge, a store link or
 *     an availability sentence. Availability is expressed only through the
 *     register-driven status labels, so no claim can be upgraded here without
 *     changing src/content/claims.mjs and tripping the build's claim gate.
 *   - Privacy is one sentence in design language plus a link to /privacy/. The
 *     explanation itself lives on that page exactly once -- which is the point
 *     of consolidating, and what the build's duplicate-content gate enforces.
 *
 * FILE OWNERSHIP: exactly one writer owns this file. Do NOT edit
 * src/content/index.mjs, routes.mjs, claims.mjs, build.mjs or any shared
 * component from here -- the coordinator registers pages and owns those.
 */

import {
  html,
  frag,
  richText,
  layout,
  card,
  stepCard,
  faqItem,
  videoBlock,
  ctaLink,
  releaseNotice,
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
    <h1 class="pw-hero__title">${richText(t('howItWorks.hero.title'))}</h1>
    <p class="pw-hero__lead">${richText(t('howItWorks.hero.body'))}</p>
  </div>
</section>`;

  // The journey. Video first, then the eight steps as an ordered list of cards
  // -- the list is the guaranteed path to the information, not the video.
  // The PCA Introduction video moves here from Home. On Home it was a large
  // COMING_LATER placeholder in the first screen and a page-length block; here
  // it sits with the enrolment video on the page that explains the product,
  // which is where a parent who wants the explanation already is.
  const intro = html`<section class="pw-section">
  <div class="pw-container">
    ${videoBlock(ctx, 'intro', { headingLevel: 2 })}
  </div>
</section>`;

  const steps = section(ctx, {
    id: 'steps',
    label: t('howItWorks.steps.label'),
    title: t('howItWorks.steps.title'),
    body: html`${videoBlock(ctx, 'enroll')}
      <ol class="pw-grid pw-grid--2 pw-grid--4 pw-plain-list">
        ${frag(
          t('howItWorks.steps.items').map(
            (item, i) => html`<li>${stepCard(ctx, { ...item, index: i + 1 })}</li>`
          )
        )}
      </ol>`,
  });

  // CLM-021 / CLM-019 / CLM-020. Three cards, three registered statuses, no
  // install action anywhere.
  const parent = section(ctx, {
    title: t('howItWorks.parent.title'),
    modifier: 'pw-section--raised',
    body: html`<div class="pw-grid pw-grid--3">
        ${frag(t('howItWorks.parent.items').map((item) => card(ctx, item)))}
      </div>`,
  });

  // CLM-022, stated plainly and on its own, where a parent cannot read
  // installation as a security authorization. No status pill: see the header.
  const security = section(ctx, {
    title: t('howItWorks.security.title'),
    modifier: 'pw-section--warm',
    body: html`<div class="pw-notice">
        <p>${richText(t('howItWorks.security.body'))}</p>
      </div>`,
  });

  // The eight protection cards move here from Home, WITH their eight registered
  // REQUIRES_PLATFORM_SUPPORT labels (CLM-028..CLM-035). Home showed the same
  // eight pills above one-line summaries; here each pill sits beside the
  // capability sentence it actually qualifies, which is the only place the
  // repetition earns its keep.
  const protects = section(ctx, {
    id: 'protects',
    label: t('howItWorks.protects.label'),
    title: t('howItWorks.protects.title'),
    body: html`<div class="pw-grid pw-grid--2 pw-grid--4">
        ${frag(t('howItWorks.protects.items').map((item) => card(ctx, item)))}
      </div>`,
  });

  // The FAQ moves here from Home: every answer is about how the product works.
  const faq = section(ctx, {
    id: 'faq',
    label: t('howItWorks.faq.label'),
    title: t('howItWorks.faq.title'),
    modifier: 'pw-section--raised',
    body: html`<div class="pw-faq">
        ${frag(t('howItWorks.faq.items').map((item) => faqItem(item)))}
      </div>`,
  });

  // Privacy gets one sentence and a link. The explanation lives on /privacy/.
  const sensitive = section(ctx, {
    title: t('howItWorks.sensitive.title'),
    modifier: 'pw-section--raised',
    body: html`<p class="pw-prose">${richText(t('howItWorks.sensitive.body'))}</p>
      <div class="pw-cta-row">
        ${ctaLink(ctx, { routeId: 'privacy', label: t('cta.privacyHandling') })}
      </div>`,
  });

  const notice = html`<div class="pw-section"><div class="pw-container">${releaseNotice(ctx, 'release.journeyNotice')}</div></div>`;

  const main = frag([hero, notice, intro, steps, protects, parent, security, faq, sensitive]);

  return layout(ctx, { main });
}
