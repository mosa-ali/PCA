import { esc } from '../lib/components.mjs';
import { CSP_CONTENT } from '../lib/seo.mjs';

/**
 * Static bilingual browser fallback for the Android App Link. This page is
 * deliberately scriptless and never receives or reflects the bearer token
 * from the URL path. When an approved distribution is configured, it offers
 * only a same-origin link to the installation-options page.
 */
export function renderEnrollmentFallbackPage(t, tAr, distributionAvailable = false) {
  const availabilityKey = distributionAvailable
    ? 'enrollmentFallback.availabilityAvailable'
    : 'enrollmentFallback.availabilityUnavailable';
  const installationOptionsLink = distributionAvailable
    ? '<div class="pw-cta-row"><a class="pw-btn pw-btn--primary" href="/child-app/">'
      + `${esc(t('enrollmentFallback.downloadCta'))}</a></div>`
    : '';
  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${esc(CSP_CONTENT)}">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(t('enrollmentFallback.seoTitle'))}</title>
<meta name="description" content="${esc(t('enrollmentFallback.seoDescription'))}">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/pca-public.css">
</head>
<body>
<main id="pw-main">
  <section class="pw-hero" lang="en" dir="ltr" aria-labelledby="enrollment-fallback-title-en">
    <div class="pw-container">
      <h1 class="pw-hero__title" id="enrollment-fallback-title-en">${esc(t('enrollmentFallback.title'))}</h1>
      <p class="pw-hero__lead">${esc(t('enrollmentFallback.body'))}</p>
      <p class="pw-prose">${esc(t(availabilityKey))}</p>
      ${installationOptionsLink}
      <p class="pw-prose">${esc(t('enrollmentFallback.privacy'))}</p>
    </div>
  </section>
  <section class="pw-section pw-section--raised" lang="ar" dir="rtl" aria-labelledby="enrollment-fallback-title-ar">
    <div class="pw-container">
      <h2 class="pw-section__title" id="enrollment-fallback-title-ar">${esc(tAr('enrollmentFallback.title'))}</h2>
      <p class="pw-section__lead">${esc(tAr('enrollmentFallback.body'))}</p>
      <p class="pw-prose">${esc(tAr(availabilityKey))}</p>
      ${distributionAvailable
        ? `<div class="pw-cta-row"><a class="pw-btn pw-btn--primary" href="/child-app/">${esc(tAr('enrollmentFallback.downloadCta'))}</a></div>`
        : ''}
      <p class="pw-prose">${esc(tAr('enrollmentFallback.privacy'))}</p>
    </div>
  </section>
</main>
</body>
</html>
`;
}
