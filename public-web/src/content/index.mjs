/**
 * Content registry — COORDINATOR-OWNED.
 *
 * Registers the content tables for the three main public pages, the utility and
 * legal routes, and the two public video scripts.
 *
 * Page writers own only their own three files:
 *   src/content/pages/<routeId>.en.mjs
 *   src/content/pages/<routeId>.ar.mjs
 *   src/pages/<routeId>.mjs
 * and must not edit this file, routes.mjs, claims.mjs, videos.mjs, build.mjs or
 * anything under src/lib or src/styles. That is what keeps parallel page work
 * free of write contention (PCA_PUBLIC_IMPLEMENTATION_PROGRAMME.md section 5).
 *
 * `video` is registered here as content WITHOUT a route: it has no page of its
 * own. videoBlock() reads video.intro.* and video.enroll.* while rendering Home
 * and How PCA Works. Registering it in PAGE_CONTENT is what makes those keys
 * resolvable -- omitting it is why both pages crashed with
 * "scenes.map is not a function" during the consolidation pass.
 */

import globalEn, { NEW_COPY } from './global.en.mjs';
import globalAr, { AR_REVIEW_STATUS } from './global.ar.mjs';

// --- The three main public pages -------------------------------------------
import homeEn from './pages/home.en.mjs';
import homeAr from './pages/home.ar.mjs';
import howItWorksEn from './pages/howItWorks.en.mjs';
import howItWorksAr from './pages/howItWorks.ar.mjs';
import privacyEn from './pages/privacy.en.mjs';
import privacyAr from './pages/privacy.ar.mjs';

// --- Utility and legal routes ----------------------------------------------
import contactEn from './pages/contact.en.mjs';
import contactAr from './pages/contact.ar.mjs';
import accessibilityEn from './pages/accessibility.en.mjs';
import accessibilityAr from './pages/accessibility.ar.mjs';
import privacyPolicyEn from './pages/privacyPolicy.en.mjs';
import privacyPolicyAr from './pages/privacyPolicy.ar.mjs';
import termsEn from './pages/terms.en.mjs';
import termsAr from './pages/terms.ar.mjs';

// --- Video scripts (content only; no route of its own) ----------------------
import videoEn from './pages/video.en.mjs';
import videoAr from './pages/video.ar.mjs';

/** routeId (or content-only id) -> { en, ar } content tables. */
export const PAGE_CONTENT = {
  home: { en: homeEn, ar: homeAr },
  howItWorks: { en: howItWorksEn, ar: howItWorksAr },
  privacy: { en: privacyEn, ar: privacyAr },
  contact: { en: contactEn, ar: contactAr },
  accessibility: { en: accessibilityEn, ar: accessibilityAr },
  privacyPolicy: { en: privacyPolicyEn, ar: privacyPolicyAr },
  terms: { en: termsEn, ar: termsAr },
  video: { en: videoEn, ar: videoAr },
};

function mergeLocale(globalTable, locale) {
  const merged = { ...globalTable };
  for (const [routeId, tables] of Object.entries(PAGE_CONTENT)) {
    const table = tables[locale];
    if (!table) throw new Error(`Page "${routeId}" has no ${locale} content table registered.`);
    for (const [key, value] of Object.entries(table)) {
      if (key in merged) {
        throw new Error(
          `Duplicate content key "${key}" — page "${routeId}" (${locale}) collides with an existing key. ` +
            'Page keys must be namespaced by route id.'
        );
      }
      merged[key] = value;
    }
  }
  return merged;
}

export const CONTENT = {
  en: mergeLocale(globalEn, 'en'),
  ar: mergeLocale(globalAr, 'ar'),
};

/**
 * The Arabic native-review surface, DERIVED rather than curated.
 *
 * OD-12 gates the whole Arabic corpus before any public publication, so the
 * review surface is every Arabic string. A hand-maintained subset can only
 * understate it — PUBLIC-14 found exactly that, with the /ar/privacy/ H1 and
 * lede both omitted from a 22-key list. Deriving it makes understatement
 * structurally impossible rather than merely gated.
 */
export const AR_REVIEW_PENDING = Object.keys(CONTENT.ar).sort();

export { NEW_COPY, AR_REVIEW_STATUS };
