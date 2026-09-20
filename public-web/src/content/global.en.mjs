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
  // Added during Owner UAT. The Release A conversion action is DOWNLOAD, not
  // login, and the IA rebalance gave that its own page. Everything listed here
  // is outside the completed native Arabic review and needs OD-12 coverage
  // before publication.
  //
  // Note what is NOT here: every string MOVED to /download/ or to How PCA Works
  // kept its exact text and only changed key, so the reviewer's judgement on it
  // still stands. Only genuinely new wording is listed.
  'cta.getTheApp',
  'download.child.lead',
  'download.seo.title',
  'download.seo.description',
  'download.hero.title',
  'download.hero.body',
  'home.protects.title',
  'home.protects.body',
  // home.protects.items is four feature NAMES copied verbatim from the approved
  // howItWorks.protects.items titles -- new key, previously reviewed text.
  'home.protects.items',
  // Authored during the PUBLIC-14 remediation pass.
  'release.journeyNotice',
  'release.contactNotice',
  'release.reportingPending',
  'notFound.seo.title',
  'notFound.title',
  'notFound.body',
  'notFound.homeCta',
  'notFound.arabicNote',
  'notFound.arabicHomeCta',
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
  'signIn.seo.title',
  'signIn.seo.description',
  'signIn.hero.title',
  'signIn.hero.body',
  'signIn.parent.title',
  'signIn.parent.body',
  'signIn.parent.cta',
  'signIn.register.prompt',
  'signIn.register.cta',
  'download.parent.openCta',
  'download.parent.registerCta',
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
  "release.journeyNotice": "**PCA Parent account creation and sign-in are now available online.** Create an account, verify your email, and begin setting up the child-protection settings and supported devices currently available to you. Some child-device protection features are still being completed before the PCA Child apps are released.",
  "release.contactNotice": "**PCA Parent is available online, but this page does not receive messages yet.** Support, privacy, accessibility and security contact channels are still being prepared. The topics below show what those channels will cover.",
  "release.reportingPending": "PCA's reporting channels are not open yet. They will be published on the Contact page when available. Please do not send sensitive child information through this page.",
  "notFound.seo.title": "Page not found — PCA",
  "notFound.title": "Page not found",
  "notFound.body": "The page you were looking for is not available. It may have moved, or the link may be incomplete.",
  "notFound.homeCta": "Go to the PCA home page",
  "notFound.arabicNote": "The page is not available.",
  "notFound.arabicHomeCta": "Return to the home page",
  "status.available": "Available online",
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
  "cta.getTheApp": "Get the App",
  "cta.privacyHandling": "See How PCA Handles Privacy",
  "cta.childSafety": "Read Our Child Safety Principles",
  "cta.access": "Learn About Access",
  "cta.allFaqs": "View All FAQs"
};
