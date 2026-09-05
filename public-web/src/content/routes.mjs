/**
 * PUBLIC-2 (revision 2) — canonical route table.
 *
 * OWNER IA RULING, 2026-09-05: three main public pages, not fourteen. Parents
 * will not read a fourteen-page marketing tree, so the useful content is
 * consolidated rather than spread:
 *
 *   /                 HOME             absorbs Why PCA, About, Features,
 *                                      For Parents, Access, Child Safety
 *                                      summary, FAQ summary
 *   /how-it-works/    HOW PCA WORKS    absorbs How It Works, Download, parent
 *                                      onboarding, enrollment, PWA install
 *   /privacy/         PRIVACY & SAFETY absorbs Privacy, Security, Child Safety
 *                                      Principles
 *
 * Everything else is a utility, auth or legal route reachable from the footer,
 * never from primary navigation.
 *
 * WHY THE OLD ROUTES ARE DELETED RATHER THAN REDIRECTED. The owner ruling
 * permits redirects "for compatibility/SEO". None are needed: PUBLIC-0
 * established that nothing has ever been deployed -- all five pcasafe.com
 * hostnames serve Azure's placeholder container, there is no deployment source
 * configured, and `pcasafe` appears in zero non-docs files. So there are no
 * indexed URLs, no inbound links and no legacy traffic to preserve. Adding
 * redirect stubs would create exactly the duplicate-content maze the ruling
 * forbids, to serve visitors who cannot exist. Recorded here so the decision is
 * auditable rather than assumed.
 *
 * URL SCHEME (topology-neutral, unchanged):
 *   English  ->  /            /how-it-works/       /privacy/
 *   Arabic   ->  /ar/         /ar/how-it-works/    /ar/privacy/
 *
 * Every URL is a real directory + index.html. No client router, no SPA history
 * fallback, no origin baked into any link -- so the artifact drops unchanged
 * onto the current placeholder container, a host-routing container (predeploy
 * PATH C) or a dedicated App Service (PATH B).
 */

/**
 * Release gates. PUBLIC-0 established Release B is blocked (no transactional
 * email provider: production signup returns 202 and the verification code
 * never leaves the process). IA section 4 requires that Release A must not
 * route users into non-production auth.
 *
 * Flipping `authLive` to true is the ONLY change needed to turn Get Started and
 * Login into real account actions -- see resolvePrimaryCta()/loginCta().
 */
export const RELEASE = {
  /** PUBLIC RELEASE B — auth/account entry. Blocked: no email sender. */
  authLive: false,
  /** PUBLIC RELEASE C — Parent Web + PWA entry. */
  parentLive: false,
  /** PUBLIC RELEASE D — PCA Child Android distribution. */
  childLive: false,
};

export const LOCALES = /** @type {const} */ (['en', 'ar']);
export const DEFAULT_LOCALE = 'en';

export const LOCALE_META = {
  en: { dir: 'ltr', htmlLang: 'en', endonym: 'EN', label: 'English' },
  ar: { dir: 'rtl', htmlLang: 'ar', endonym: 'العربية', label: 'Arabic' },
};

/**
 * `kind`      — 'main' (primary navigation), 'utility', 'legal' or 'auth'.
 * `release`   — which staged release activates the route.
 * `build`     — emit HTML for it in this build.
 * `indexable` — allow crawlers. Auth/recovery routes are never indexable
 *               (IA section 17); legal drafts stay out until legal review closes.
 */
export const ROUTES = [
  // --- The three main public pages ----------------------------------------
  { id: 'home',        path: '',              kind: 'main', release: 'A', build: true, indexable: true, priority: '1.0' },
  { id: 'howItWorks',  path: 'how-it-works',  kind: 'main', release: 'A', build: true, indexable: true, priority: '0.9' },
  { id: 'privacy',     path: 'privacy',       kind: 'main', release: 'A', build: true, indexable: true, priority: '0.9' },

  // --- Utility (footer only, never primary nav) ----------------------------
  { id: 'contact',       path: 'contact',       kind: 'utility', release: 'A', build: true, indexable: true,  priority: '0.5' },
  { id: 'accessibility', path: 'accessibility', kind: 'utility', release: 'A', build: true, indexable: true,  priority: '0.4' },

  // --- Legal (route shells; PUBLICATION IS OWNER/LEGAL GATED) --------------
  // PPR1R-D035 (no privacy policy artifact) and OD-13 (legal entity/
  // jurisdiction) are both OPEN. These build so the routes exist and the
  // provisional drafts are reviewable, behind a visible provisional notice.
  // They are NOT indexable and are excluded from sitemap.xml until legal
  // review closes -- robots and sitemap are generated from this one flag, so
  // the two can never disagree.
  { id: 'privacyPolicy', path: 'privacy-policy', kind: 'legal', release: 'A', build: true, indexable: false, priority: null },
  { id: 'terms',         path: 'terms',          kind: 'legal', release: 'A', build: true, indexable: false, priority: null },

  // --- Conditional (IA section 13) -----------------------------------------
  // NOT BUILT. Owner ruling on CLM-055: require /cookies only if runtime
  // evidence shows a real need. Release A sets no cookies beyond the
  // URL-expressed language choice and loads no third-party resource, so the
  // condition is unmet. Kept so the decision stays visible.
  { id: 'cookies', path: 'cookies', kind: 'legal', release: 'A', build: false, indexable: false, priority: null },

  // --- Auth (PUBLIC RELEASE B) ---------------------------------------------
  // NOT BUILT while RELEASE.authLive is false. Never indexable. PUBLIC-9
  // decides whether these are hosted here or hand off to the Parent origin --
  // note parent-web implements /register, not /signup, so an alias or redirect
  // is required either way.
  { id: 'login',          path: 'login',           kind: 'auth', release: 'B', build: RELEASE.authLive, indexable: false, priority: null },
  { id: 'signup',         path: 'signup',          kind: 'auth', release: 'B', build: RELEASE.authLive, indexable: false, priority: null },
  { id: 'forgotPassword', path: 'forgot-password', kind: 'auth', release: 'B', build: RELEASE.authLive, indexable: false, priority: null },
  { id: 'resetPassword',  path: 'reset-password',  kind: 'auth', release: 'B', build: RELEASE.authLive, indexable: false, priority: null },
  { id: 'verifyEmail',    path: 'verify-email',    kind: 'auth', release: 'B', build: RELEASE.authLive, indexable: false, priority: null },
];

/** Primary navigation — exactly the three main pages, in owner order. */
export const NAV_ORDER = ['home', 'howItWorks', 'privacy'];

/**
 * Footer. Deliberately small: the three main pages plus the utility and legal
 * routes that must remain reachable but must not clutter primary navigation.
 */
export const FOOTER_GROUPS = [
  { id: 'pca',   items: ['home', 'howItWorks', 'privacy'] },
  { id: 'help',  items: ['contact'] },
  { id: 'legal', items: ['privacyPolicy', 'terms', 'accessibility'] },
];

const BY_ID = new Map(ROUTES.map((r) => [r.id, r]));

export function routeById(id) {
  const route = BY_ID.get(id);
  if (!route) throw new Error(`Unknown route id: ${id}`);
  return route;
}

export function buildableRoutes() {
  return ROUTES.filter((r) => r.build);
}

export function mainRoutes() {
  return ROUTES.filter((r) => r.kind === 'main' && r.build);
}

export function utilityRoutes() {
  return ROUTES.filter((r) => r.kind !== 'main' && r.build);
}

/** Absolute, origin-relative URL for a route in a locale. Always trailing-slashed. */
export function urlFor(routeId, locale) {
  const { path } = routeById(routeId);
  const prefix = locale === DEFAULT_LOCALE ? '' : `/${locale}`;
  return path === '' ? `${prefix}/` : `${prefix}/${path}/`;
}

/** Output file path, relative to dist/. */
export function outputPathFor(routeId, locale) {
  const { path } = routeById(routeId);
  const segs = [];
  if (locale !== DEFAULT_LOCALE) segs.push(locale);
  if (path !== '') segs.push(path);
  segs.push('index.html');
  return segs.join('/');
}

/**
 * Where the primary conversion CTA points, given the current release gates.
 *
 * The owner's navigation spec lists "Get Started" and "Login". Both stay gated
 * on RELEASE.authLive, because PUBLIC-0 proved the destination is broken:
 * production registration returns 202 while the verification code never leaves
 * the process, so a parent following a live signup CTA today dead-ends at
 * /verify-email with no error and no way to obtain a code. IA section 4
 * explicitly permits routing to an informational start page instead, and
 * /how-it-works/ is now exactly that page -- it walks the whole journey.
 */
export function resolvePrimaryCta() {
  return RELEASE.authLive
    ? { routeId: 'signup', labelKey: 'cta.getStarted' }
    : { routeId: 'howItWorks', labelKey: 'cta.seeHowPcaWorks' };
}

/** Login is hidden from the header entirely until Release B. */
export function loginCta() {
  return RELEASE.authLive ? { routeId: 'login', labelKey: 'cta.login' } : null;
}
