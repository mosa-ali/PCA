/**
 * PUBLIC-1 / PUBLIC-4 — GLOBAL Arabic content. Page-specific copy lives in
 * src/content/pages/<route>.ar.mjs, one file per route.
 *
 * SOURCE OF TRUTH for transcribed strings: PCA_PUBLIC_CONTENT_AR.md v0.2.
 *
 * NATIVE REVIEW IS A RELEASE GATE (OD-12), AND IT COVERS THE WHOLE CORPUS.
 *
 * This list used to be a hand-curated 22 keys. PUBLIC-14 showed why that was
 * wrong: the /ar/privacy/ H1 and lede — both marked NATIVE_REVIEW_REQUIRED in
 * the frozen baseline, both shipping verbatim — were missing from it, as was
 * every key the page authors recorded in their own file headers. A reviewer
 * working the published list would have signed off 22 strings and believed the
 * job done.
 *
 * The frozen baseline's own header gates the entire Arabic corpus before any
 * public publication, so the review surface IS every Arabic string. The list is
 * now derived from the content tables rather than maintained by hand, which
 * makes it impossible to understate. assertArabicReviewCoversCorpus() in
 * build.mjs enforces that.
 *
 * When an owner-designated native reviewer signs off, record the sign-off and
 * narrow this deliberately — do not let it drift narrow by omission.
 */
export const AR_REVIEW_STATUS = 'PENDING_NATIVE_REVIEWER_SIGN_OFF';

// AR_REVIEW_PENDING is DERIVED in src/content/index.mjs from the merged
// Arabic content table, so it cannot be narrower than the corpus. It is not
// maintained here; there is no hand-typed list to fall out of date.

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
  "nav.download": "التنزيل",
  "nav.contact": "التواصل",
  "nav.accessibility": "إمكانية الوصول",
  "nav.privacyPolicy": "سياسة الخصوصية",
  "nav.terms": "الشروط",
  "footer.group.pca": "PCA",
  "footer.group.trust": "الثقة",
  "footer.group.help": "المساعدة",
  "footer.group.legal": "المعلومات القانونية",
  "footer.legalNote": "‏PCA منصة لحماية الأطفال في المساحات الرقمية. الخطط والأسعار وأي عناصر مذكورة على أنها «قادمة لاحقًا» لم تُطرح بعد.",
  "legal.provisionalNotice": "هذه مسودة أولية وليست الوثيقة القانونية المنشورة. ما زالت قيد المراجعة القانونية ولا تظهر في محركات البحث.",
  "release.journeyNotice": "**لم تُفتح PCA لإنشاء حسابات جديدة بعد.** تشرح هذه الصفحة رحلة الإعداد التي نعمل على بنائها حتى تعرف ما الذي تتوقعه. وسيُتاح إنشاء الحساب وتأكيد البريد الإلكتروني وتطبيق PCA Child في إصدار لاحق.",
  "release.contactNotice": "**لا يمكننا استقبال الرسائل بعد.** تُعِدّ PCA قنوات الدعم والخصوصية والأمان، وستُنشر هنا قبل إتاحة PCA للأسر. وتوضح الموضوعات أدناه ما ستغطيه هذه القنوات.",
  "release.reportingPending": "لم تفتح PCA قنوات الإبلاغ بعد. وستُنشر هذه القنوات في صفحة التواصل قبل إتاحة PCA للأسر.",
  "notFound.seo.title": "الصفحة غير موجودة — PCA",
  "notFound.title": "الصفحة غير موجودة",
  "notFound.body": "الصفحة التي تبحث عنها غير متاحة. ربما تكون قد نُقلت، أو أن الرابط غير مكتمل.",
  "notFound.homeCta": "اذهب إلى الصفحة الرئيسية لـPCA",
  "notFound.arabicNote": "الصفحة غير متاحة.",
  "notFound.arabicHomeCta": "العودة إلى الصفحة الرئيسية",
  "status.available": "متاح",
  "status.limited": "محدود",
  "status.later": "قادم لاحقًا",
  "status.platform": "يتطلب دعم المنصة",
  "cta.getStarted": "ابدأ الآن",
  "cta.login": "تسجيل الدخول",
  "cta.createAccount": "إنشاء حساب",
  "cta.seeHowPcaWorks": "تعرّف على طريقة عمل PCA",
  "cta.exploreFeatures": "استكشف المزايا",
  "cta.whyPca": "لماذا PCA؟",
  "cta.howPcaWorks": "كيف تعمل PCA؟",
  "cta.pcaParent": "PCA Parent",
  "cta.privacyHandling": "تعرّف على كيفية تعامل PCA مع الخصوصية",
  "cta.childSafety": "اقرأ مبادئ سلامة الطفل",
  "cta.access": "تعرّف على خيارات الوصول إلى PCA",
  "cta.allFaqs": "عرض جميع الأسئلة الشائعة"
};
