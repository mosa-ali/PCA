/**
 * PUBLIC-7 — HOW PCA WORKS content (Arabic). The consolidated journey page.
 *
 * OWNER IA RULING, 2026-09-05. Mirrors howItWorks.en.mjs key for key. Every
 * Arabic sentence below is an owner-approved string already transcribed into
 * this package (from the former /how-it-works, /download and /parents Arabic
 * tables), re-selected and shortened -- not re-translated and never machine
 * translated. The new strings are written as natural Arabic, not as literal
 * renderings of the English.
 *
 * NATIVE ARABIC REVIEW PENDING (OD-12 / CLM-050). The approved AR document
 * marks the Android sentence NATIVE_REVIEW_REQUIRED, and the /parents Arabic
 * table flags the final term for "Trusted Browser". The marker text itself is
 * never copied into a value. Keys awaiting sign-off on this page:
 *   howItWorks.steps.label
 *   howItWorks.steps.title
 *   howItWorks.steps.items[1].title, howItWorks.steps.items[1].body
 *   howItWorks.steps.items[4].title, howItWorks.steps.items[4].body
 *   howItWorks.security.body            (term: “المتصفح الموثوق”)
 *   howItWorks.child.title
 *   howItWorks.child.items[0].title, howItWorks.child.items[0].body
 *   howItWorks.child.items[1].title, howItWorks.child.items[1].body
 * The coordinator owns AR_REVIEW_PENDING in src/content/global.ar.mjs.
 *
 * DEF-1. The implementer directives embedded in the approved Arabic body copy
 * -- the store-badge direction, the "حتى اجتياز اختبارات التشغيل..." sentence
 * and the encryption-scope verification sentence -- are not transcribed into
 * any value here. iPhone/iPad uses the owner-approved replacement wording as
 * natural Arabic; the Android release status is carried by CLM-024's
 * registered "قادم لاحقًا" label rather than by prose. The Arabic iPhone/iPad
 * sentence is worded differently from the Home page's ("حماية الطفل على iPhone
 * وiPad...") for the same reason as the English one: build.mjs fails a build in
 * which the same substantive sentence appears on two routes. The meaning is
 * identical and no availability is asserted.
 *
 * TWO DELIBERATE ADJUSTMENTS, both mechanical: a sentence-initial "و" is
 * dropped where an approved sentence is lifted out of the middle of a
 * paragraph and now opens a card (parent.items[1].body, sensitive.body).
 *
 * FILE OWNERSHIP: exactly one writer owns this file. Do NOT edit
 * src/content/index.mjs, routes.mjs, claims.mjs, build.mjs or any shared
 * component from here -- the coordinator registers pages and owns those.
 */

export default {
  "howItWorks.seo.title": "كيف تعمل PCA؟ — مسار الوالدين وحماية الطفل",
  "howItWorks.seo.description": "تعرّف على المسار المخطط في PCA، من إنشاء حساب الوالدين إلى ربط جهاز الطفل واختيار الحماية ومتابعة الحالة والتعامل مع طلبات الوالدين والطفل.",

  "howItWorks.hero.title": "من إنشاء الحساب إلى الحماية اليومية",
  "howItWorks.hero.body": "صُممت PCA لتكون خطوات الحماية واضحة: أنشئ حساب الوالدين، واربط جهاز الطفل المدعوم، واختر القواعد المناسبة، ثم راجع حالة الحماية عبر PCA Parent.",

  "howItWorks.steps.label": "المسار",
  "howItWorks.steps.title": "ثماني خطوات",
  "howItWorks.steps.items": [
    {
      "title": "إنشاء حساب الوالدين",
      "body": "استخدم البريد الإلكتروني وكلمة المرور لإنشاء حساب PCA Parent."
    },
    {
      "title": "تأكيد البريد الإلكتروني",
      "body": "أكّد بريدك الإلكتروني لتفعيل الوصول إلى PCA Parent."
    },
    {
      "title": "إعداد الطفل داخل PCA Parent",
      "body": "يتم إعداد الطفل داخل بيئة PCA Parent المحمية."
    },
    {
      "claimId": "CLM-024",
      "title": "تثبيت PCA Child",
      "body": "اتبع الإرشادات المناسبة للجهاز الذي تقوم بإعداده."
    },
    {
      "title": "إنشاء رمز أو رابط التسجيل",
      "body": "أنشئ من داخل PCA Parent رمز التسجيل أو الرابط الخاص بهذا الطفل."
    },
    {
      "title": "ربط جهاز الطفل",
      "body": "استخدم مسار التسجيل والربط المعتمد."
    },
    {
      "title": "اختيار إعدادات الحماية",
      "body": "وفقًا لإمكانات المنصة التي تم التحقق منها، يمكن للوالدين إعداد قواعد وقت الشاشة والجداول والتحكم بالتطبيقات والويب وغيرها من وسائل الحماية المدعومة."
    },
    {
      "title": "متابعة الحالة والطلبات",
      "body": "ينبغي أن تساعد PCA Parent الوالدين على فهم ما إذا كانت الحماية تعمل والتعامل مع طلبات الطفل المدعومة."
    }
  ],

  "howItWorks.parent.title": "PCA Parent",
  "howItWorks.parent.items": [
    {
      "claimId": "CLM-021",
      "title": "لا حاجة إلى تثبيت",
      "body": "صُممت PCA Parent للعمل في متصفح مدعوم على الهاتف أو الجهاز اللوحي أو الكمبيوتر، دون تثبيت أي شيء."
    },
    {
      "claimId": "CLM-019",
      "title": "تثبيت PCA Parent",
      "body": "عندما يكون التثبيت مدعومًا، يمكنك تثبيتها للحصول على تجربة أقرب إلى استخدام التطبيق."
    },
    {
      "claimId": "CLM-020",
      "title": "يبقى التثبيت اختياريًا",
      "body": "لا تحتاج إلى تثبيت PCA Parent لمجرد استخدام الخدمة."
    }
  ],

  "howItWorks.security.title": "فرق مهم من ناحية الأمان",
  "howItWorks.security.body": "تثبيت PCA Parent يتعلق بالسهولة والوصول. أما “المتصفح الموثوق” فهو مفهوم أمني منفصل وله قواعده الخاصة.",

  "howItWorks.child.title": "PCA Child",
  "howItWorks.child.items": [
    {
      "claimId": "CLM-024",
      "title": "أندرويد",
      "body": "عند جاهزية أول إصدار من PCA Child ستكون أندرويد هي المنصة الأساسية المخطط لها."
    },
    {
      "claimId": "CLM-026",
      "title": "iPhone وiPad",
      "body": "حماية أجهزة iPhone وiPad مخطط لها في إصدار لاحق."
    }
  ],

  "howItWorks.sensitive.title": "ماذا يحدث للمعلومات الحساسة؟",
  "howItWorks.sensitive.body": "تنتقل إعدادات الحماية وحالتها بين أجهزتك الموثوقة. وتشرح صفحة الخصوصية والسلامة ما الذي تتم معالجته وأين."
};
