/**
 * PUBLIC-1 / PUBLIC-3 — GLOBAL English content: chrome, navigation, calls to
 * action, feature status labels and legal notices. Page-specific copy lives in
 * src/content/pages/<route>.en.mjs, one file per route, so page writers never
 * contend for this file.
 *
 * SOURCE OF TRUTH for transcribed strings: PCA_PUBLIC_CONTENT_EN.md v0.2.
 *
 * NEW_COPY lists strings authored here rather than transcribed. The gated
 * primary CTA now uses approved copy ("See How PCA Works") per the owner
 * ruling of 2026-09-05, so the previously-authored diverted-CTA label is gone.
 * What remains is structural chrome and a11y text with no document equivalent,
 * plus the two video scripts.
 * build.mjs prints this list on every build and writes it to the build report
 * so PUBLIC-3 review and the Arabic native reviewer both see it.
 */

export const NEW_COPY = [
  'nav.menu',
  'nav.primaryLabel',
  'nav.languageLabel',
  'brand.homeLink',
  'a11y.skipToContent',
  'footer.legalNote',
  'legal.provisionalNotice',
  'video.transcriptLabel',
  'video.captions.en',
  'video.captions.ar',
  'video.enroll.summary',
  'video.enroll.title',
  'video.enroll.transcript',
  'video.intro.summary',
  'video.intro.title',
  'video.intro.transcript',
  'video.seo.description',
  'video.seo.title',
  'howItWorks.sensitive.body',
];

export default {
  "brand.homeLink": "PCA home",
  "a11y.skipToContent": "Skip to main content",
  "video.transcriptLabel": "Read the transcript",
  "video.captions.en": "English",
  "video.captions.ar": "Arabic",
  "nav.primaryLabel": "Primary",
  "nav.languageLabel": "Language",
  "nav.menu": "Menu",
  "nav.home": "Home",
  "nav.whyPca": "Why PCA",
  "nav.howItWorks": "How It Works",
  "nav.features": "Features",
  "nav.privacy": "Privacy & Safety",
  "nav.security": "Security",
  "nav.parents": "For Parents",
  "nav.access": "Access",
  "nav.faq": "Help",
  "nav.about": "About",
  "nav.childSafety": "Child Safety Principles",
  "nav.download": "Download",
  "nav.contact": "Contact",
  "nav.accessibility": "Accessibility",
  "nav.privacyPolicy": "Privacy Policy",
  "nav.terms": "Terms",
  "footer.group.pca": "PCA",
  "footer.group.trust": "Trust",
  "footer.group.help": "Help",
  "footer.group.legal": "Legal",
  "footer.legalNote": "PCA is a digital child protection platform. Plans, prices and availability described as coming later are not yet released.",
  "legal.provisionalNotice": "This is a provisional draft and is not the published legal document. It is pending legal review and is not indexed.",
  "status.available": "Available",
  "status.limited": "Limited",
  "status.later": "Coming later",
  "status.platform": "Requires platform support",
  "cta.getStarted": "Get Started",
  "cta.login": "Sign In",
  "cta.createAccount": "Create Account",
  "cta.seeHowPcaWorks": "See How PCA Works",
  "cta.exploreFeatures": "Explore Features",
  "cta.whyPca": "Why PCA",
  "cta.howPcaWorks": "How PCA Works",
  "cta.pcaParent": "PCA Parent",
  "cta.privacyHandling": "See How PCA Handles Privacy",
  "cta.childSafety": "Read Our Child Safety Principles",
  "cta.access": "Learn About Access",
  "cta.allFaqs": "View All FAQs"
};
