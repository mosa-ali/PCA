/**
 * PUBLIC-1 / PUBLIC-4 — GLOBAL Arabic content. Page-specific copy lives in
 * src/content/pages/<route>.ar.mjs, one file per route.
 *
 * SOURCE OF TRUTH for transcribed strings: PCA_PUBLIC_CONTENT_AR.md v0.2.
 *
 * NATIVE REVIEW IS A RELEASE GATE (OD-12). AR_REVIEW_PENDING lists every key
 * whose Arabic is drafted but NOT approved for publication -- the strings the
 * approved document marks NATIVE_REVIEW_REQUIRED, plus the new copy introduced
 * by this implementation.
 *
 * Unlike parent-web's `_arReviewPending` array -- which PUBLIC-0 found is read
 * by no test, no lint rule and no CI step, and whose count the PPR-2 ledger
 * records incorrectly -- build.mjs READS this list, prints it on every build
 * and writes it into dist/build-report.json. CLM-050 and CLM-051 stay
 * COMING_LATER until an owner-designated native reviewer signs off.
 */

export const AR_REVIEW_PENDING = [
  'home.hero.reassure',
  'home.steps.items',
  'video.enroll.summary',
  'video.enroll.title',
  'video.enroll.transcript',
  'video.intro.summary',
  'video.intro.title',
  'video.intro.transcript',
  'video.seo.description',
  'video.seo.title',
  'howItWorks.sensitive.body',
  'nav.menu',
  'nav.primaryLabel',
  'nav.languageLabel',
  'nav.privacy',
  'brand.homeLink',
  'a11y.skipToContent',
  'footer.legalNote',
  'legal.provisionalNotice',
  'video.transcriptLabel',
  'video.captions.en',
  'video.captions.ar',
];

export default {
  "brand.homeLink": "الصفحة الرئيسية لـ PCA",
  "a11y.skipToContent": "تخطَّ إلى المحتوى الرئيسي",
  "video.transcriptLabel": "اقرأ النص المكتوب",
  "video.captions.en": "الإنجليزية",
  "video.captions.ar": "العربية",
  "nav.primaryLabel": "التنقل الرئيسي",
  "nav.languageLabel": "اللغة",
  "nav.menu": "القائمة",
  "nav.home": "الرئيسية",
  "nav.whyPca": "لماذا PCA؟",
  "nav.howItWorks": "كيف تعمل PCA؟",
  "nav.features": "المزايا",
  "nav.privacy": "الخصوصية والسلامة",
  "nav.security": "الأمان",
  "nav.parents": "للوالدين",
  "nav.access": "إتاحة الخدمة",
  "nav.faq": "المساعدة",
  "nav.about": "عن PCA",
  "nav.childSafety": "مبادئ سلامة الطفل",
  "nav.download": "التنزيل والتثبيت",
  "nav.contact": "التواصل",
  "nav.accessibility": "إمكانية الوصول",
  "nav.privacyPolicy": "سياسة الخصوصية",
  "nav.terms": "الشروط",
  "footer.group.pca": "PCA",
  "footer.group.trust": "الثقة والخصوصية",
  "footer.group.help": "المساعدة",
  "footer.group.legal": "الشؤون القانونية",
  "footer.legalNote": "PCA منصة لحماية الأطفال في المساحات الرقمية. الخطط والأسعار والمزايا الموصوفة بأنها قادمة لاحقًا لم تُطلق بعد.",
  "legal.provisionalNotice": "هذه مسودة أولية وليست الوثيقة القانونية المنشورة. ما زالت قيد المراجعة القانونية ولا تظهر في محركات البحث.",
  "status.available": "متوفر",
  "status.limited": "محدود",
  "status.later": "قادم لاحقًا",
  "status.platform": "يعتمد على دعم المنصة",
  "cta.getStarted": "ابدأ الآن",
  "cta.login": "تسجيل الدخول",
  "cta.createAccount": "إنشاء حساب",
  "cta.seeHowPcaWorks": "تعرّف على طريقة عمل PCA",
  "cta.exploreFeatures": "استكشف المزايا",
  "cta.whyPca": "لماذا PCA؟",
  "cta.howPcaWorks": "كيف تعمل PCA؟",
  "cta.pcaParent": "PCA Parent",
  "cta.privacyHandling": "كيف تتعامل PCA مع الخصوصية؟",
  "cta.childSafety": "اقرأ مبادئ سلامة الطفل",
  "cta.access": "تعرّف على إتاحة PCA",
  "cta.allFaqs": "جميع الأسئلة الشائعة"
};
