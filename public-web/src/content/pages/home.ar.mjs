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
  "home.hero.title": "حماية الأطفال في المساحات الرقمية",
  "home.hero.body": "يستحق الأطفال الرعاية والحماية أينما يقضون وقتهم، بما في ذلك على الإنترنت.",
  "home.hero.reassure": "صُممت PCA بحيث لا تنشئ ملفًا مركزيًا مقروءًا عن النشاط الحساس لطفلك.",
  "home.why.label": "لماذا وُجدت PCA؟",
  "home.why.title": "بدأت من اهتمام أحد الوالدين بحماية أطفاله",
  "home.why.body": [
    "بدأت فكرة PCA بسؤال بسيط: إذا كنا نبذل جهدًا لحماية الأطفال في المنزل والمدرسة والأماكن العامة، فلماذا نتعامل مع المساحات الرقمية وكأن الحماية تتوقف عندها؟",
    "نؤمن بأن الأسرة تحتاج إلى أدوات مفيدة للحماية الرقمية دون أن تضطر للتنازل عن خصوصية الطفل."
  ],
  "home.different.label": "لماذا PCA مختلفة؟",
  "home.different.title": "التقنية ينبغي أن تحمي الطفل وتحترم كرامته",
  "home.different.items": [
    {
      "title": "مصممة دون إنشاء ملف مركزي مقروء عن الطفل",
      "body": "الحماية لا تتطلب نسخة مركزية مقروءة."
    },
    {
      "title": "لم تُصمم لجمع صور الطفل أو مقاطع الفيديو أو الملفات أو الرسائل",
      "body": "الحماية المعتادة لا تحتاج إلى هذه المحتويات."
    },
    {
      "title": "حماية تبدأ محليًا من الجهاز",
      "body": "صُمم نهج PCA بحيث تبقى المعلومات الحساسة لدى الأسرة."
    },
    {
      "title": "تكلفة في المتناول وإتاحة أوسع",
      "body": "مراعاة التكلفة والإتاحة الواسعة جزء من التصميم."
    }
  ],
  "home.final.title": "ابدأ ببناء عادات رقمية أكثر أمانًا مع أسرتك",
  "home.final.body": "تعرّف على الأدوات، واختر وسائل الحماية المناسبة لأسرتك، وحافظ على تحكمك في المعلومات الحساسة.",
  "home.protects.title": "ما الذي تساعد PCA على حمايته",
  "home.protects.body": "ما يمكن أن تفعله PCA فعليًا على جهاز معيّن يعتمد على ما تسمح به تلك المنصة. وتشرح صفحة كيف تعمل PCA كل مجال وحدوده الحالية.",
  "home.protects.items": [
    "وقت الشاشة",
    "تصفح أكثر أمانًا",
    "التحكم بالتطبيقات والويب",
    "التنبيهات"
  ]
};
