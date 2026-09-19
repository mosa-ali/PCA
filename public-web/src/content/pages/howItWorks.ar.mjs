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
  "howItWorks.seo.title": "كيف يعمل نظام الحماية الأبوية؟ — إعداد الوالدين وحماية الطفل",
  "howItWorks.seo.description": "تعرّف على مسار إعداد نظام الحماية الأبوية، من إنشاء حساب الوالدين إلى ربط جهاز الطفل واختيار الحماية ومتابعة الحالة والتعامل مع طلبات الوالدين والطفل.",
  "howItWorks.hero.title": "من إنشاء الحساب إلى الحماية اليومية",
  "howItWorks.hero.body": "صُمم نظام الحماية الأبوية لتكون خطوات الحماية واضحة: أنشئ حساب الوالدين، واربط جهاز الطفل المدعوم، واختر القواعد المناسبة، ثم راجع حالة الحماية عبر تطبيق الوالدين (PCA Parent).",
  "howItWorks.steps.label": "المسار",
  "howItWorks.steps.title": "ثماني خطوات",
  "howItWorks.steps.items": [
    {
      "title": "إنشاء حساب الوالدين",
      "body": "استخدم بريدك الإلكتروني وكلمة المرور لإنشاء حساب الوالدين."
    },
    {
      "title": "تأكيد البريد الإلكتروني",
      "body": "أكّد بريدك الإلكتروني لتفعيل الوصول إلى تطبيق الوالدين."
    },
    {
      "title": "إعداد الطفل في تطبيق الوالدين",
      "body": "أكمل إعداد الطفل داخل بيئة تطبيق الوالدين المحمية."
    },
    {
      "claimId": "CLM-024",
      "title": "تثبيت تطبيق الطفل (PCA Child)",
      "body": "اتبع الإرشادات المناسبة للجهاز الذي تقوم بإعداده."
    },
    {
      "title": "إنشاء رمز أو رابط التسجيل",
      "body": "أنشئ من داخل تطبيق الوالدين رمز التسجيل أو الرابط الخاص بهذا الطفل."
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
      "body": "يساعد تطبيق الوالدين على معرفة ما إذا كانت الحماية تعمل والتعامل مع طلبات الطفل المدعومة."
    }
  ],
  "howItWorks.parent.title": "تطبيق الوالدين (PCA Parent)",
  "howItWorks.parent.items": [
    {
      "claimId": "CLM-021",
      "title": "لا حاجة إلى تثبيت",
      "body": "صُمم تطبيق الوالدين للعمل في متصفح مدعوم على الهاتف أو الجهاز اللوحي أو الكمبيوتر، دون تثبيت أي شيء."
    },
    {
      "claimId": "CLM-019",
      "title": "تثبيت تطبيق الوالدين",
      "body": "عندما يكون التثبيت مدعومًا، يمكنك تثبيته للحصول على تجربة أقرب إلى استخدام التطبيق."
    },
    {
      "claimId": "CLM-020",
      "title": "يبقى التثبيت اختياريًا",
      "body": "لا تحتاج إلى تثبيت تطبيق الوالدين لمجرد استخدام الخدمة."
    }
  ],
  "howItWorks.security.title": "فرق مهم من ناحية الأمان",
  "howItWorks.security.body": "يتعلق تثبيت تطبيق الوالدين بالسهولة والوصول. أما «المتصفح الموثوق» فهو مفهوم أمني منفصل وله قواعده الخاصة.",
  "howItWorks.sensitive.title": "ماذا يحدث للمعلومات الحساسة؟",
  "howItWorks.sensitive.body": "تنتقل إعدادات الحماية وحالتها بين أجهزتك الموثوقة. وتشرح صفحة الخصوصية والسلامة ما الذي تتم معالجته وأين.",
  "howItWorks.protects.label": "ما الذي يحميه نظام الحماية الأبوية؟",
  "howItWorks.protects.title": "حماية عملية يمكن للأسرة فهمها",
  "howItWorks.protects.items": [
    {
      "claimId": "CLM-028",
      "title": "وقت الشاشة",
      "body": "دعم حدود وروتين أكثر توازنًا لاستخدام الأجهزة."
    },
    {
      "claimId": "CLM-030",
      "title": "تصفح أكثر أمانًا",
      "body": "المساعدة في تطبيق قرارات السلامة المعتمدة على الويب."
    },
    {
      "claimId": "CLM-029",
      "title": "التحكم بالتطبيقات والويب",
      "body": "وضع حدود مناسبة للتطبيقات والوصول إلى الويب."
    },
    {
      "claimId": "CLM-031",
      "title": "الجداول الزمنية",
      "body": "تحديد أوقات واضحة للدراسة والراحة والنوم."
    },
    {
      "claimId": "CLM-032",
      "title": "حالة الحماية",
      "body": "معرفة ما إذا كانت وسائل الحماية مفعّلة."
    },
    {
      "claimId": "CLM-033",
      "title": "طلبات الوالدين والطفل",
      "body": "إتاحة تواصل واضح عندما يطلب الطفل وقتًا إضافيًا."
    },
    {
      "claimId": "CLM-034",
      "title": "التنبيهات",
      "body": "تلقي تنبيهات ذات صلة بالحماية."
    },
    {
      "claimId": "CLM-035",
      "title": "حماية الجهاز",
      "body": "المساعدة في الحفاظ على إعدادات الحماية على جهاز الطفل."
    }
  ],
  "howItWorks.faq.label": "أسئلة شائعة",
  "howItWorks.faq.title": "إجابات سريعة",
  "howItWorks.faq.items": [
    {
      "q": "هل يقرأ نظام الحماية الأبوية رسائل طفلي؟",
      "a": "لم يُصمم النظام لالتقاط الرسائل الشخصية أو قراءتها مركزيًا."
    },
    {
      "q": "هل يجمع نظام الحماية الأبوية صور الطفل أو ملفاته؟",
      "a": "لا تحتاج الحماية المعتادة إلى مكتبة صور الطفل أو فيديوهاته أو ملفاته العشوائية."
    },
    {
      "q": "هل يمكن استخدام تطبيق الوالدين دون تثبيته؟",
      "a": "نعم. التثبيت اختياري ويمكن استخدام نسخة الويب من المتصفح."
    },
    {
      "q": "هل يستخدم نظام الحماية الأبوية الذكاء الاصطناعي؟",
      "a": "المزايا المدعومة بالذكاء الاصطناعي مخطط لها في إصدار لاحق."
    },
    {
      "q": "هل يحمي نظام الحماية الأبوية استخدام YouTube؟",
      "a": "الحماية المتقدمة لـYouTube مخطط لها في إصدار لاحق."
    },
    {
      "q": "كم تبلغ تكلفة نظام الحماية الأبوية؟",
      "a": "لم تُنشر الخطط والأسعار النهائية بعد."
    }
  ]
};
