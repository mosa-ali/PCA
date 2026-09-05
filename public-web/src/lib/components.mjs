/**
 * PUBLIC-5 — shared shell and component primitives.
 *
 * Every public and (later) auth page renders through layout(), so the header,
 * language switcher, skip link, footer and metadata are defined exactly once.
 * PUBLIC-0 found parent-web has NO shared auth shell -- its five auth pages
 * are flat siblings with no header, no logo and, critically, no language
 * switcher, so an Arabic-speaking parent landing on /login cannot switch
 * language at all. This layout exists so that defect cannot be repeated here.
 */

import { html, frag, raw, esc, attrs, richText, paragraphs } from './html.mjs';
import {
  LOCALE_META,
  LOCALES,
  NAV_ORDER,
  FOOTER_GROUPS,
  urlFor,
  routeById,
  buildableRoutes,
  resolvePrimaryCta,
  loginCta,
} from '../content/routes.mjs';
import { labelKeyForClaim, STATUS_CSS } from '../content/claims.mjs';
import { videoById } from '../content/videos.mjs';
import { CSP_CONTENT, absoluteUrl, languageAlternates, robotsContent } from './seo.mjs';

/**
 * A route is linkable only when it is BOTH enabled for this release in
 * routes.mjs AND actually has a renderer registered in build.mjs. `ctx.built`
 * carries the second half.
 *
 * Both halves are required. Using the route table alone silently produces
 * links to routes that are approved but not yet implemented, which serve 404s
 * -- a defect this file shipped until the internal-link check in the UAT
 * harness caught it. Never link from the route table alone.
 */
const RELEASE_ENABLED = new Set(buildableRoutes().map((r) => r.id));

export function isLinkable(ctx, routeId) {
  return RELEASE_ENABLED.has(routeId) && ctx.built.has(routeId);
}

export function routeHref(ctx, routeId) {
  if (!isLinkable(ctx, routeId)) return null;
  return urlFor(routeId, ctx.locale);
}

export function statusPill(ctx, claimId) {
  const labelKey = labelKeyForClaim(claimId);
  if (!labelKey) return raw('');
  const cssClass = STATUS_CSS[labelKey];
  return html`<span class="pw-status ${cssClass}" data-claim="${claimId}">${ctx.t(labelKey)}</span>`;
}

export function card(ctx, { title, body, claimId }) {
  return html`<article class="pw-card">
    ${claimId ? statusPill(ctx, claimId) : ''}
    <h3 class="pw-card__title">${richText(title)}</h3>
    <p class="pw-card__body">${richText(body)}</p>
  </article>`;
}

export function stepCard(ctx, { index, title, body, claimId }) {
  return html`<article class="pw-card">
    <span class="pw-step__num" aria-hidden="true">${index}</span>
    ${claimId ? statusPill(ctx, claimId) : ''}
    <h3 class="pw-card__title">${richText(title)}</h3>
    <p class="pw-card__body">${richText(body)}</p>
  </article>`;
}

export function faqItem({ q, a }) {
  return html`<details class="pw-faq__item">
    <summary class="pw-faq__q">${richText(q)}</summary>
    <div class="pw-faq__a">${paragraphs(Array.isArray(a) ? a : [a])}</div>
  </details>`;
}

/**
 * Public video block.
 *
 * Two states, one contract: the transcript is always present. Owner ruling --
 * "Do not make video the only way to obtain critical information" -- so the
 * scene-by-scene script renders as real text whether or not a file exists.
 *
 * headingLevel exists because the block's correct level depends on where it
 * sits. On Home the video is its own top-level block, so its title is the
 * page's first h2; on How PCA Works it sits inside a section that already has
 * an h2, so h3 is right. Hardcoding h3 produced a real h1 -> h3 skip on Home in
 * both locales, caught by the PUBLIC-12 heading-order check.
 *
 * Unavailable state emits NO <video> element, so there is no broken player and
 * nothing for the browser to fetch. Available state emits controls, no
 * autoplay, preload="none" (nothing downloads on first paint) and a caption
 * track per locale.
 */
export function videoBlock(ctx, videoId, { headingLevel = 3 } = {}) {
  const video = videoById(videoId);
  const p = video.contentPrefix;
  const scenes = ctx.t(`${p}.transcript`);

  const transcript = html`<details class="pw-video__transcript">
    <summary class="pw-faq__q">${ctx.t('video.transcriptLabel')}</summary>
    <div class="pw-faq__a">
      <ol class="pw-video__scenes">
        ${frag(scenes.map((line) => html`<li>${richText(line)}</li>`))}
      </ol>
    </div>
  </details>`;

  const player = video.available
    ? html`<video class="pw-video__player" controls preload="none" playsinline
        poster="${video.poster}" aria-describedby="pw-video-${video.id}-summary">
        <source src="${video.src}" type="video/mp4">
        ${frag(
          video.captions.map(
            (loc) => html`<track kind="captions" src="/assets/video/${video.id}.${loc}.vtt"
              srclang="${loc}" label="${ctx.t(`video.captions.${loc}`)}"${loc === ctx.locale ? html` default` : ''}>`
          )
        )}
      </video>`
    : html`<div class="pw-video__placeholder" role="img"
        aria-label="${ctx.t(`${p}.title`)} — ${ctx.t('status.later')}">
        <img src="${video.poster}" alt="" class="pw-video__poster" loading="lazy" decoding="async" width="960" height="540">
        <span class="pw-status pw-status--later" data-claim="CLM-059">${ctx.t('status.later')}</span>
      </div>`;

  return html`<figure class="pw-video">
    ${player}
    <figcaption class="pw-video__caption">
      <h${headingLevel} class="pw-video__title">${ctx.t(`${p}.title`)}</h${headingLevel}>
      <p class="pw-video__summary" id="pw-video-${video.id}-summary">${richText(ctx.t(`${p}.summary`))}</p>
      ${transcript}
    </figcaption>
  </figure>`;
}

/**
 * Release-state notice.
 *
 * PUBLIC-14 found How PCA Works walking a parent through "Create your parent
 * account" and "Verify your email" as live steps, when production registration
 * returns 202 and the verification code never leaves the process — the single
 * worst publication-day outcome after a broken store link. The steps are still
 * the right content: they describe the journey PCA is building. What was
 * missing was saying so, once, before the reader starts following them.
 */
export function releaseNotice(ctx, key) {
  return html`<div class="pw-notice" role="note">
    <p>${richText(ctx.t(key))}</p>
  </div>`;
}

export function ctaLink(ctx, { routeId, label, variant = 'secondary' }) {
  const href = routeHref(ctx, routeId);
  if (!href) return raw('');
  return html`<a class="pw-btn pw-btn--${variant}" href="${href}">${label}</a>`;
}

/** The release-gated primary conversion CTA. Never points at broken auth. */
export function primaryCta(ctx, variant = 'primary') {
  const cta = resolvePrimaryCta(ctx.locale);
  return ctaLink(ctx, { routeId: cta.routeId, label: ctx.t(cta.labelKey), variant });
}

function header(ctx) {
  const login = loginCta(ctx.locale);
  const navItems = NAV_ORDER.filter((id) => isLinkable(ctx, id));

  const navLinks = navItems.map((id) => {
    const current = id === ctx.routeId;
    return html`<li>
      <a class="pw-nav__link" href="${urlFor(id, ctx.locale)}"${attrs({
        'aria-current': current ? 'page' : false,
      })}>${ctx.t(`nav.${id}`)}</a>
    </li>`;
  });

  const mobileLinks = navItems.map((id) => {
    const current = id === ctx.routeId;
    return html`<li>
      <a class="pw-mobile-menu__link" href="${urlFor(id, ctx.locale)}"${attrs({
        'aria-current': current ? 'page' : false,
      })}>${ctx.t(`nav.${id}`)}</a>
    </li>`;
  });

  // The switcher preserves the equivalent route in the other locale (IA s.9).
  const langOptions = LOCALES.map((locale) => {
    const active = locale === ctx.locale;
    return html`<a class="pw-lang__opt" href="${urlFor(ctx.routeId, locale)}" lang="${LOCALE_META[locale].htmlLang}"${attrs(
      {
        'aria-current': active ? 'true' : false,
        hreflang: LOCALE_META[locale].htmlLang,
      }
    )}>${LOCALE_META[locale].endonym}</a>`;
  });

  return html`<header class="pw-header">
  <div class="pw-container pw-header__bar">
    <a class="pw-brand" href="${urlFor('home', ctx.locale)}">
      <span class="pw-brand__mark" aria-hidden="true">PCA</span>
      <span class="pw-sr-only">${ctx.t('brand.homeLink')}</span>
      <span aria-hidden="true">PCA</span>
    </a>

    <nav class="pw-nav" aria-label="${ctx.t('nav.primaryLabel')}">
      <ul class="pw-nav__list">${frag(navLinks)}</ul>
    </nav>

    <div class="pw-header__actions">
      <nav class="pw-lang" aria-label="${ctx.t('nav.languageLabel')}">${frag(langOptions)}</nav>
      ${login ? ctaLink(ctx, { routeId: login.routeId, label: ctx.t(login.labelKey), variant: 'secondary' }) : ''}
      <button class="pw-menu-toggle" type="button" id="pw-menu-toggle"
        aria-expanded="false" aria-controls="pw-mobile-menu">
        <span class="pw-menu-toggle__bars" aria-hidden="true"></span>
        <span class="pw-menu-toggle__label">${ctx.t('nav.menu')}</span>
      </button>
    </div>
  </div>

  <div class="pw-mobile-menu" id="pw-mobile-menu" data-open="false">
    <div class="pw-container">
      <ul class="pw-mobile-menu__list">${frag(mobileLinks)}</ul>
      ${primaryCta(ctx)}
    </div>
  </div>
</header>`;
}

function footer(ctx) {
  const groups = FOOTER_GROUPS.map((group) => {
    const items = group.items.filter((id) => isLinkable(ctx, id));
    if (!items.length) return raw('');
    const links = items.map(
      (id) => html`<li><a class="pw-footer__link" href="${urlFor(id, ctx.locale)}">${ctx.t(`nav.${id}`)}</a></li>`
    );
    return html`<div>
      <h2 class="pw-footer__heading">${ctx.t(`footer.group.${group.id}`)}</h2>
      <ul class="pw-footer__list">${frag(links)}</ul>
    </div>`;
  });

  const langOptions = LOCALES.map((locale) => {
    const active = locale === ctx.locale;
    return html`<a class="pw-lang__opt" href="${urlFor(ctx.routeId, locale)}" lang="${LOCALE_META[locale].htmlLang}"${attrs(
      { 'aria-current': active ? 'true' : false }
    )}>${LOCALE_META[locale].endonym}</a>`;
  });

  return html`<footer class="pw-footer">
  <div class="pw-container">
    <div class="pw-footer__groups">${frag(groups)}</div>
    <div class="pw-footer__bottom">
      <nav class="pw-lang" aria-label="${ctx.t('nav.languageLabel')}">${frag(langOptions)}</nav>
      <p class="pw-footer__legal-note">${richText(ctx.t('footer.legalNote'))}</p>
    </div>
  </div>
</footer>`;
}

/**
 * Full document. Emits real per-locale lang/dir in the SERVED HTML, which is
 * the specific defect PUBLIC-0 found in both existing SPAs (they always serve
 * lang="en" dir="ltr" and fix it only after JS boots, so a crawler never sees
 * Arabic as Arabic).
 */
export function layout(ctx, { main }) {
  const meta = LOCALE_META[ctx.locale];
  const canonical = absoluteUrl(ctx.routeId, ctx.locale, ctx.origin);
  const alternates = languageAlternates(ctx.routeId, ctx.origin).map(
    (alt) => html`<link rel="alternate" hreflang="${alt.hreflang}" href="${alt.href}">`
  );

  const title = ctx.t(`${ctx.routeId}.seo.title`);
  const description = ctx.t(`${ctx.routeId}.seo.description`);

  return `<!doctype html>
<html lang="${esc(meta.htmlLang)}" dir="${esc(meta.dir)}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${esc(CSP_CONTENT)}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="${esc(robotsContent(ctx.routeId))}">
<link rel="canonical" href="${esc(canonical)}">
${alternates.map((a) => a.__raw).join('\n')}
<meta property="og:type" content="website">
<meta property="og:site_name" content="PCA">
<meta property="og:locale" content="${esc(ctx.locale === 'ar' ? 'ar_AR' : 'en_US')}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#ffffff">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/pca-public.css">
</head>
<body>
<a class="pw-skip" href="#pw-main">${esc(ctx.t('a11y.skipToContent'))}</a>
${header(ctx).__raw}
<main id="pw-main" tabindex="-1">
${typeof main === 'string' ? main : main.__raw}
</main>
${footer(ctx).__raw}
<script src="/assets/pca-public.js" defer></script>
</body>
</html>
`;
}

export { html, frag, raw, esc, richText, paragraphs, attrs };
