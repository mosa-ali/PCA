/**
 * PUBLIC-2r2 — PUBLIC VIDEO SCRIPTS (Arabic).
 *
 * Arabic counterpart of src/content/pages/video.en.mjs. Same two videos, same
 * key set, same array lengths -- the parity gate in build.mjs enforces all
 * three.
 *
 * WRITTEN AS ARABIC, NOT TRANSLATED FROM ENGLISH. These are spoken lines: the
 * sentence order, connectives and rhythm follow Arabic narration, so several
 * entries are deliberately NOT word-for-word equivalents of the English. The
 * meaning, the claim scope and the scene order are identical; the phrasing is
 * native.
 *
 * NATIVE REVIEW IS A RELEASE GATE (OD-12). Every key in this file is new copy
 * with no approved Arabic source in PCA_PUBLIC_CONTENT_AR.md v0.2, so EVERY key
 * here is reported to the coordinator for native Arabic sign-off before
 * publication. CLM-050 and CLM-051 stay COMING_LATER until that sign-off exists.
 *
 * TWO POINTS A NATIVE REVIEWER SHOULD LOOK AT FIRST:
 *   - video.enroll.transcript[3] embeds the Latin brand names "iPhone" and
 *     "iPad" inside Arabic text (matching the existing house style, which keeps
 *     "iOS", "PCA Parent" and "PCA Child" in Latin). Confirm the bidirectional
 *     rendering reads cleanly in the real RTL page, not just in source.
 *   - video.intro.transcript[7] renders the affordability VALUES claim
 *     (CLM-040). It must stay a value, never a plan, a tier or a price.
 *
 * DEF-1. video.enroll.transcript[3] carries the owner-approved replacement
 * wording for iPhone/iPad (CLM-026) as natural Arabic -- never a literal
 * translation of the internal directive it replaces, which is not parent-facing
 * text in either language.
 *
 * Visual direction, storyboard notes and the physical-device UAT constraint are
 * documented once, in the English file, and are not repeated here.
 *
 * FILE OWNERSHIP: exactly one writer owns this file. Do NOT edit
 * src/content/index.mjs, routes.mjs, claims.mjs, videos.mjs, build.mjs or any
 * shared component from here -- the coordinator registers content and owns those.
 */

export default {
  // لا يوجد مسار /video؛ هذه المفاتيح موجودة لاستيفاء عقد المحتوى القياسي فقط
  // ولا يعرضها أي قالب اليوم.
  "video.seo.title": "فيديوهات PCA — التعريف وخطوات الإعداد",
  "video.seo.description": "فيديوهان قصيران مع النص المكتوب كاملًا: لماذا وُجدت PCA، وكيف تُعِدّ الحماية لطفلك خطوة بخطوة.",

  "video.intro.title": "نبذة تعريفية عن PCA",
  "video.intro.summary": "مقدمة قصيرة تشرح سبب وجود PCA، وما الذي تساعدك عليه في يومك، وكيف صُممت لحماية طفلك دون إنشاء ملف مركزي مقروء عن نشاطه.",
  "video.intro.transcript": [
    "في البيت وفي المدرسة وفي الأماكن التي يلعبون فيها، نحرص دائمًا على حماية أطفالنا.",
    "والمساحات الرقمية التي يقضون فيها وقتهم تستحق العناية نفسها.",
    "بدأت PCA من اهتمام أبٍ بحماية أطفاله، ومن قناعة بأن حياتهم على الإنترنت ليست استثناءً.",
    "ولذلك بُنيت PCA لمساعدتك في الأمور اليومية، بحسب ما تدعمه منصة جهاز الطفل: وقت الشاشة، وتصفح أكثر أمانًا، والتحكم بالتطبيقات والويب، وجداول تناسب يوم أسرتك.",
    "وتنبّهك عندما يحتاج أمر ما إلى انتباهك، وتمنح طفلك طريقة واضحة ليطلب وقتًا إضافيًا أو إذنًا بالوصول.",
    "ولـ PCA نهج مختلف في الخصوصية: صُممت لحماية طفلك دون إنشاء ملف مركزي مقروء عنه.",
    "فالحماية اليومية لا تتطلب من PCA جمع صور طفلك أو مقاطعه المصوّرة أو ملفاته أو رسائله.",
    "ونؤمن بأن عالمًا رقميًا أكثر أمانًا لا ينبغي أن يرتبط بدخل الأسرة، لذلك كانت التكلفة المعقولة وسعة الإتاحة جزءًا من تصميم PCA.",
    "ابدأ بحماية المساحات الرقمية لطفلك، وتعرّف على طريقة عمل PCA خطوة بخطوة."
  ],

  "video.enroll.title": "خطوات التسجيل في PCA",
  "video.enroll.summary": "شرح كامل لخطوات الإعداد، من إنشاء حساب الوالدين حتى مراجعة حالة الحماية، لتعرف ما ينتظرك قبل أن تبدأ.",
  "video.enroll.transcript": [
    "ابدأ بإنشاء حساب PCA Parent باستخدام بريدك الإلكتروني وكلمة مرور.",
    "ثم افتح بريدك وأكّد عنوانك الإلكتروني لتفعيل الحساب.",
    "أضف طفلك داخل PCA Parent، ويكفي من المعلومات ما يميّز حماية كل طفل عن غيره.",
    "اختر نوع الجهاز الذي يستخدمه طفلك؛ فأندرويد هي المنصة الأولى المخطط لها في PCA Child، أما حماية الأطفال على iPhone وiPad فهي مخططة لإصدار لاحق.",
    "أنشئ دعوة خاصة بهذا الطفل، فهي ما يربط الجهاز بأسرتك أنت دون غيرها.",
    "وعند إطلاق PCA Child ستثبّته وتفتحه على جهاز طفلك.",
    "أدخل رمز الإعداد الوارد في الدعوة، أو افتح رابط الإعداد، ليقترن جهاز الطفل بحساب الوالدين.",
    "أكّد الربط على جهاز الطفل، وامنح PCA الأذونات اللازمة لتطبيق القواعد التي اخترتها.",
    "عد إلى PCA Parent واختر وسائل الحماية المناسبة لهذا الطفل: وقت الشاشة، والجداول الزمنية، والتحكم بالتطبيقات والويب حيث تدعم المنصة ذلك.",
    "وأخيرًا راجع حالة الحماية لتعرف ما إذا كانت تعمل وما الذي يحتاج إلى انتباهك."
  ]
};
