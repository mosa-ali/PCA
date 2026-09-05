/**
 * PUBLIC-2r2 — HOME content (Arabic). THE consolidated main page.
 *
 * OWNER IA RULING, 2026-09-05: three public pages, not fourteen. This table is
 * the Arabic counterpart of home.en.mjs, key for key and index for index.
 *
 * PROVENANCE. Every string is taken from Arabic that was ALREADY approved and
 * transcribed into this repository (home.ar.mjs, whyPca.ar.mjs, about.ar.mjs,
 * features.ar.mjs, parents.ar.mjs, access.ar.mjs, childSafety.ar.mjs,
 * faq.ar.mjs), then shortened by dropping a trailing clause or a whole
 * sentence. Nothing is machine-translated from the English table and nothing is
 * re-transcribed from PCA_PUBLIC_CONTENT_AR.md.
 *
 * DEF-1. The Arabic source carried the same internal implementation directives
 * as the English (for example features.ar.mjs's "لا يجوز الإعلان عن ميزة ذكاء
 * اصطناعي في الإنتاج قبل ... واعتماد ادعائها في سجل الادعاءات."). None of them
 * appears here. The owner-approved replacements are rendered as NATURAL Arabic
 * meaning, never as a literal technical translation:
 *   AI          -> home.faq.items[3].a          (CLM-057)
 *   YouTube     -> home.faq.items[4].a          (CLM-058)
 *   iPhone/iPad -> home.availability.items[2].b (CLM-026)
 *
 * NATIVE ARABIC REVIEW (OD-12 / CLM-050) is still pending for the site as a
 * whole. The strings condensed or newly worded in THIS pass are listed in the
 * build report so the reviewer sees exactly what changed:
 *   home.protects.label, home.protects.items[1..7].body,
 *   home.different.label, home.different.items[0..3],
 *   home.steps.items[1..4].body,
 *   home.availability.label/.title/.items[0..2],
 *   home.faq.items[1].a, home.faq.items[2].q, home.faq.items[3],
 *   home.faq.items[4], home.faq.items[5].
 *
 * CLAIM DISCIPLINE is identical to the English table: CLM-028..CLM-035 on the
 * protection cards, no claimId anywhere in home.different.items, CLM-024/CLM-026
 * on availability, and the CLM-040 affordability statement as prose with no
 * pill, no price, no plan and no free-tier statement.
 *
 * FILE OWNERSHIP: exactly one writer owns this file. Do NOT edit
 * src/content/index.mjs, routes.mjs, claims.mjs, videos.mjs, global.*.mjs,
 * build.mjs or any shared component from here.
 */

export default {
  "home.seo.title": "PCA — حماية الأطفال في المساحات الرقمية",
  "home.seo.description": "تساعد PCA الوالدين على توفير مساحات رقمية أكثر أمانًا للأطفال من خلال حماية عملية، وتصميم يحد من جمع المعلومات، وتحكم واضح للوالدين.",

  // --- A. الواجهة ---------------------------------------------------------
  "home.hero.title": "حماية الأطفال في المساحات الرقمية",
  "home.hero.body": "يستحق الأطفال الرعاية والحماية أينما يقضون وقتهم، بما في ذلك الإنترنت.",
  "home.hero.reassure": "صُممت PCA بحيث لا تنشئ ملفًا مركزيًا مقروءًا عن النشاط الحساس لطفلك.",

  // --- C. لماذا وُجدت PCA؟ -------------------------------------------------
  "home.why.label": "لماذا وُجدت PCA؟",
  "home.why.title": "بدأت من اهتمام أب بحماية أطفاله",
  "home.why.body": [
    "بدأت فكرة PCA بسؤال بسيط: إذا كنا نبذل جهدًا لحماية الأطفال في المنزل والمدرسة والأماكن العامة، فلماذا نتعامل مع المساحات الرقمية وكأن الحماية تتوقف عندها؟",
    "نؤمن بأن الأسرة تحتاج إلى أدوات مفيدة للحماية الرقمية دون أن تضطر للتنازل عن خصوصية الطفل."
  ],

  // --- D. ما الذي تحميه PCA؟ ----------------------------------------------
  "home.protects.label": "ما الذي تحميه PCA؟",
  "home.protects.title": "حماية عملية يمكن للأسرة فهمها",
  "home.protects.items": [
    {
      "claimId": "CLM-028",
      "title": "وقت الشاشة",
      "body": "المساعدة في وضع حدود وروتين أكثر توازنًا لاستخدام الأجهزة."
    },
    {
      "claimId": "CLM-030",
      "title": "تصفح أكثر أمانًا",
      "body": "المساعدة في اتخاذ قرارات الحماية على الويب."
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
      "body": "معرفة ما إذا كانت الحماية تعمل."
    },
    {
      "claimId": "CLM-033",
      "title": "طلبات الوالدين والطفل",
      "body": "إتاحة تواصل واضح عندما يطلب الطفل وقتًا إضافيًا."
    },
    {
      "claimId": "CLM-034",
      "title": "التنبيهات",
      "body": "إرسال تنبيهات مفيدة مرتبطة بالحماية."
    },
    {
      "claimId": "CLM-035",
      "title": "حماية الجهاز",
      "body": "المساعدة في الحفاظ على إعدادات الحماية على جهاز الطفل."
    }
  ],

  // --- E. لماذا PCA مختلفة؟ (نصوص بلا شارة حالة) ---------------------------
  "home.different.label": "لماذا PCA مختلفة؟",
  "home.different.title": "التقنية ينبغي أن تحمي الطفل وتحترم كرامته",
  "home.different.items": [
    {
      "title": "مصممة دون ملف مركزي مقروء عن الطفل",
      "body": "الحماية لا تتطلب نسخة مركزية مقروءة."
    },
    {
      "title": "لم تُصمم لجمع صور الطفل أو فيديوهاته أو ملفاته أو رسائله",
      "body": "الحماية المعتادة لا تحتاج إليها."
    },
    {
      "title": "حماية تبدأ من الجهاز",
      "body": "صُممت المعلومات الحساسة لتبقى لدى الأسرة."
    },
    {
      "title": "تكلفة معقولة وإتاحة أوسع",
      "body": "القدرة على تحمل التكلفة والإتاحة الواسعة جزء من التصميم."
    }
  ],

  // --- F. ملخص كيف تعمل PCA (الرحلة الكاملة في /how-it-works/) -------------
  "home.steps.label": "كيف تعمل PCA؟",
  "home.steps.title": "خمس خطوات واضحة",
  "home.steps.items": [
    {
      "title": "أنشئ حساب الوالدين",
      "body": "ابدأ بإعداد الوصول إلى PCA Parent."
    },
    {
      "title": "أضف طفلك داخل PCA Parent",
      "body": "يتم إعداد معلومات الطفل داخل بيئة الوالدين المحمية."
    },
    {
      "claimId": "CLM-024",
      "title": "ثبّت PCA Child على جهاز مدعوم",
      "body": "أندرويد هو المنصة الأساسية المخطط لها."
    },
    {
      "title": "اربط الجهاز واختر إعدادات الحماية",
      "body": "حدد القواعد والجداول المناسبة لأسرتك."
    },
    {
      "title": "راجع حالة الحماية",
      "body": "تابع حالة الحماية وتعامل مع الطلبات المدعومة."
    }
  ],

  // --- G. التوفر (بلا اسم متجر أو شعار أو رابط أو زر تنزيل) ----------------
  "home.availability.label": "التوفر",
  "home.availability.title": "PCA Parent وPCA Child",
  "home.availability.items": [
    {
      "title": "PCA Parent",
      "body": "تجربة ويب متجاوبة للهاتف والجهاز اللوحي والكمبيوتر. لم يُفتح إنشاء الحسابات بعد."
    },
    {
      "claimId": "CLM-024",
      "title": "PCA Child على أندرويد",
      "body": "المنصة الأساسية المخطط لها لأول إصدار."
    },
    {
      "claimId": "CLM-026",
      "title": "PCA Child على iPhone وiPad",
      "body": "حماية الطفل على iPhone وiPad مخطط لها في إصدار لاحق."
    }
  ],

  // --- H. الإتاحة — بيان قيَم فقط (CLM-040) بلا سعر أو خطة ----------------
  "home.affordability.label": "الإتاحة",
  "home.affordability.title": "العالم الرقمي الأكثر أمانًا لا ينبغي أن يعتمد على دخل الأسرة",
  "home.affordability.body": "تُصمم PCA مع مراعاة القدرة على تحمل التكلفة وإتاحة الخدمة على نطاق أوسع.",

  // --- I. أسئلة شائعة -----------------------------------------------------
  "home.faq.label": "أسئلة شائعة",
  "home.faq.title": "أسئلة سريعة",
  "home.faq.items": [
    {
      "q": "هل تقرأ PCA رسائل طفلي؟",
      "a": "لم تُصمم PCA لالتقاط الرسائل الشخصية أو قراءتها مركزيًا."
    },
    {
      "q": "هل تجمع PCA صور الطفل أو ملفاته؟",
      "a": "لا تحتاج الحماية المعتادة إلى مكتبة صور الطفل أو فيديوهاته أو ملفاته العشوائية."
    },
    {
      "q": "هل يمكن استخدام PCA Parent دون تثبيتها؟",
      "a": "نعم. التثبيت اختياري ويمكن استخدام نسخة الويب من المتصفح."
    },
    {
      "q": "هل تستخدم PCA الذكاء الاصطناعي؟",
      "a": "المزايا المدعومة بالذكاء الاصطناعي مخطط لها في إصدار لاحق."
    },
    {
      "q": "هل تحمي PCA استخدام YouTube؟",
      "a": "الحماية المتقدمة لـYouTube مخطط لها في إصدار لاحق."
    },
    {
      "q": "كم تكلفة PCA؟",
      "a": "لم تُنشر الخطط والأسعار النهائية بعد."
    }
  ],

  // --- J. دعوة الإجراء الختامية -------------------------------------------
  "home.final.title": "ابدأ ببناء عادات رقمية أكثر أمانًا مع أسرتك",
  "home.final.body": "تعرّف على الأدوات، واختر الحماية المناسبة لأسرتك، واحتفظ بالتحكم في المعلومات الحساسة."
};
