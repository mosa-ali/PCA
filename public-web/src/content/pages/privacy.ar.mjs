/**
 * PUBLIC-2r2 — PRIVACY & SAFETY, the consolidated trust page (Arabic).
 *
 * OWNER IA RULING 2026-09-05: three public pages. This one absorbs the former
 * /privacy, /security and /child-safety Arabic pages. Every string below is
 * SELECTED from Arabic already transcribed from
 * docs/public/PCA_Public_Programme_Documentation_Package_v0.2/
 * PCA_PUBLIC_CONTENT_AR.md into privacy.ar.mjs, security.ar.mjs,
 * childSafety.ar.mjs, features.ar.mjs and faq.ar.mjs. Nothing is
 * machine-translated from the English table and nothing is re-transcribed from
 * the source document. Where a passage had to be shortened, a WHOLE SENTENCE
 * was dropped rather than a sentence rewritten.
 *
 * Key order, array lengths and claimId positions mirror privacy.en.mjs exactly;
 * build.mjs assertContentParity fails the build otherwise.
 *
 * WHAT WAS ABSORBED, AND FROM WHERE
 *   privacy.where.items[0..2]      privacy.local/sync/central (this page, v1)
 *   privacy.notStored.*            privacy.notStored (this page, v1)
 *   privacy.honesty.*              privacy.honesty (this page, v1)
 *   privacy.topics.items[0..3]     faq.items answers on files, messages,
 *                                  app usage and browsing
 *   privacy.topics.items[4]        features.location
 *   privacy.principles.*           childSafety.hero + childSafety.principles
 *   privacy.faq.items[0]           faq.items[0]
 *   privacy.faq.items[2].a         security.concerns.body
 *   privacy.advanced.items[0..1]   security.realms, security.surveillance
 *
 * DEF-1 RESOLUTION — internal implementation directives removed from body copy.
 * The replacements are written as natural Arabic, never as a literal technical
 * translation of the English directive:
 *   - features.location.body ended "التوفر الفعلي يحتاج دليلًا." DROPPED; the
 *     gating is carried by the CLM-036 label ("يعتمد على دعم المنصة").
 *   - features.camera.body carried the runtime-evidence directive. DROPPED;
 *     privacy.topics.items[5].body says plainly that the feature is planned for
 *     a later release and that, if it ships, camera frames are designed to be
 *     processed on the device. The CLM-037 label says "قادم لاحقًا".
 *   - the FAQ AI answer carried the review-workflow directive. DROPPED;
 *     privacy.faq.items[1].a carries the owner-approved replacement (CLM-057).
 * No claim id, security-review workflow, activation instruction or the phrase
 * "سجل الادعاءات" appears in any string in this table.
 *
 * CLAIM DISCIPLINE: identical to the English table. Only CLM-015, CLM-036,
 * CLM-037 and CLM-046 carry a claimId, at the same indexes. Every other claim
 * touched here is EXTERNAL_SECURITY_REVIEW or NOT_APPROVED and appears as
 * design-language prose with no status pill. CLM-043 (deletion controls) is
 * NOT_APPROVED, so privacy.retention.body promises no deletion control.
 *
 * NATIVE ARABIC REVIEW (OD-12 gate on CLM-050). The approved AR document marks
 * privacy.hero.body NATIVE_REVIEW_REQUIRED; the marker text itself is not copied
 * into the value. That key, plus every key authored or adapted for the
 * consolidated page, is reported to the coordinator for the AR_REVIEW_PENDING
 * list: privacy.seo.title, privacy.seo.description, privacy.hero.body,
 * privacy.where.title, privacy.topics.title, privacy.topics.items[5].body,
 * privacy.retention.title, privacy.retention.body, privacy.faq.title,
 * privacy.faq.items[1].a, privacy.faq.items[2].q, privacy.advanced.title,
 * privacy.advanced.lead.
 *
 * FILE OWNERSHIP: exactly one writer owns this file. Do NOT edit
 * src/content/index.mjs, routes.mjs, claims.mjs, build.mjs or any shared
 * component from here -- the coordinator registers pages and owns those.
 */

export default {
  "privacy.seo.title": "الخصوصية والسلامة في نظام الحماية الأبوية PCA — حماية دون إنشاء ملف مركزي مقروء للطفل",
  "privacy.seo.description": "تعرّف على نهج نظام الحماية الأبوية الذي يعطي الأولوية للمعالجة المحلية، وعلى المعلومات التي تبقى لدى الأسرة، والحد الأدنى من السجلات التقنية المركزية، ومبادئ سلامة الطفل التي يقوم عليها هذا النهج.",

  // A — الوعد ببساطة.
  "privacy.hero.title": "نشاط طفلك يخصك أنت، وليس PCA",
  "privacy.hero.body": "صُمم نظام الحماية الأبوية لتقديم الحماية دون إنشاء ملف مركزي مقروء عن النشاط الحساس لطفلك.",

  // B و C و D — أين تبقى المعلومات. الحالة الظاهرة على البطاقة الأولى فقط.
  "privacy.where.title": "أين تبقى معلومات طفلك؟",
  "privacy.where.items": [
    {
      "claimId": "CLM-015",
      "title": "ما الذي تتم معالجته محليًا؟",
      "body": "تحتاج بعض وظائف الحماية إلى معلومات على جهاز الطفل. ونهج النظام هو إبقاء هذه المعالجة محليًا قدر الإمكان."
    },
    {
      "title": "ما الذي قد تتم مزامنته بين الأجهزة الموثوقة؟",
      "body": "عندما يلزم نقل معلومات حماية حساسة بين جهاز الوالد وجهاز الطفل، صُمم النظام لنقلها مشفّرةً من طرف إلى طرف عند الحاجة. ويبقى نطاق التشفير في الإنتاج خاضعًا للمراجعة الأمنية النهائية."
    },
    {
      "title": "ما الذي تحتاجه خدمات النظام المركزية؟",
      "body": "قد تحتفظ الخدمات المركزية بالحد الأدنى من السجلات التقنية اللازمة لحساب الوالدين والمصادقة، ومعرّفات مبهمة للأجهزة والأطفال، وحالة التسجيل والترخيص والاستحقاق، والتسليم المشفّر وحالته، والطوابع الزمنية، والحد الأدنى من بيانات التشغيل والأمان."
    }
  ],

  // E — قائمة ما لا يُخزَّن مركزيًا.
  "privacy.notStored.title": "ما الذي يجب ألا يخزنه النظام مركزيًا كمحتوى مقروء للطفل؟",
  "privacy.notStored.items": [
    "الصور والفيديوهات؛",
    "الملفات أو المستندات الأخرى على الجهاز؛",
    "الرسائل الشخصية؛",
    "سجل استخدام التطبيقات المقروء؛",
    "سجل التصفح المقروء؛",
    "سجل الموقع الدقيق المقروء؛",
    "تسجيلات الميكروفون؛",
    "لقطات الشاشة أو تسجيلات الشاشة في الخلفية؛",
    "كلمات المرور أو بيانات الاعتماد."
  ],

  // لماذا نرفض الشعارات المطلقة.
  "privacy.honesty.title": "لماذا نتجنب الشعارات المطلقة عن الخصوصية؟",
  "privacy.honesty.body": "تحتاج أي خدمة تعتمد على حسابات على الإنترنت إلى قدر من المعلومات التقنية ومعلومات الحساب حتى تعمل، وأي شعار يوحي بعكس ذلك قد يكون مضللًا. والوعد الأهم هو ألا يحوّل النظام النشاط الحساس للطفل إلى قاعدة بيانات مركزية مقروءة.",

  // F و G و H و I و J — إجابة قصيرة لكل نوع من المعلومات الحساسة.
  "privacy.topics.title": "ماذا يعني ذلك لكل نوع من المعلومات؟",
  "privacy.topics.items": [
    {
      "title": "الصور والفيديوهات والملفات",
      "body": "لا تحتاج الحماية المعتادة إلى الوصول إلى مكتبة صور الطفل أو مقاطع الفيديو أو الملفات الأخرى على الجهاز، ويجب ألا تُجمع هذه المحتويات في قاعدة بيانات مركزية مقروءة لدى النظام."
    },
    {
      "title": "الرسائل",
      "body": "لم تُصمم وظائف الحماية المعتادة في النظام لالتقاط الرسائل الشخصية أو قراءتها مركزيًا."
    },
    {
      "title": "استخدام التطبيقات ووقت الشاشة",
      "body": "يجب ألا يتحول سجل استخدام التطبيقات القابل للقراءة إلى بيانات مركزية مقروءة لدى النظام. وقد تتم معالجة استخدام التطبيقات محليًا عند الحاجة إلى ذلك للحماية."
    },
    {
      "title": "الحماية أثناء التصفح",
      "body": "قاعدة الخصوصية في النظام هي عدم حفظ سجل التصفح المقروء مركزيًا. وقد تحتاج وظائف السلامة على الويب إلى معالجة محلية لاتخاذ قرارات الحماية."
    },
    {
      "claimId": "CLM-036",
      "title": "الموقع",
      "body": "الموقع معلومات حساسة. يجب أن تكون أي ميزة موقع معتمدة تحت تحكم الوالدين، وألا يتحول سجل الموقع الدقيق المقروء إلى بيانات مركزية لدى النظام."
    },
    {
      "claimId": "CLM-037",
      "title": "الكاميرا والمسافة عن الشاشة",
      "body": "ميزة حماية المسافة بين العين والشاشة باستخدام الكاميرا مخطط لها في إصدار لاحق. وهي غير متاحة حاليًا، وسنوضح هنا كيفية تعامل أي إصدار مستقبلي مع صور الكاميرا بعد التحقق من ذلك."
    }
  ],

  // K — الاحتفاظ والحذف. CLM-043 غير معتمد، فلا وعد بأي أداة حذف ولا حالة ظاهرة.
  "privacy.retention.title": "الاحتفاظ بالمعلومات وحذفها",
  "privacy.retention.body": [
    "يُعدّ تحكّم الوالدين في الحساب ومعلومات الحماية جزءًا من توجه تصميم النظام، لكن أدوات التحكم هذه لم تُبنَ بعد.",
    "ينبغي عدم الاحتفاظ بالمعلومات المركزية إلا للمدة اللازمة لتشغيل الخدمة والحفاظ على أمانها والوفاء بالالتزامات القانونية. وسيتم توثيق السلوك الدقيق للاحتفاظ والحذف بعد التحقق منه."
  ],

  // L — مبادئ سلامة الطفل.
  "privacy.principles.title": "احمِ الطفل واحترم طفولته",
  "privacy.principles.lead": "يجب أن تساعد الحماية الرقمية الأسرة على تقليل المخاطر دون أن يتعلم الطفل أن المراقبة الدائمة أمر طبيعي.",
  "privacy.principles.items": [
    {
      "title": "الحماية دون مراقبة",
      "body": "استخدم الحد الأدنى من المعلومات المطلوبة لتحقيق حماية مفيدة."
    },
    {
      "title": "الخصوصية من أساس التصميم",
      "body": "أبقِ النشاط الحساس للطفل ضمن الأنظمة الموثوقة لدى الأسرة قدر الإمكان."
    },
    {
      "title": "الشفافية",
      "body": "يجب أن يفهم الوالدان ما الذي تفعله الميزة وما المعلومات التي تحتاج إليها."
    },
    {
      "title": "كرامة الطفل",
      "body": "يجب ألا تُهين الحماية الطفل أو تتعامل معه كمتهم."
    },
    {
      "title": "حماية مناسبة للعمر",
      "body": "الأعمار والظروف الأسرية المختلفة تحتاج حدودًا مختلفة."
    },
    {
      "title": "مسؤولية الوالدين",
      "body": "النظام أداة مساعدة، وليس بديلًا عن الحوار والحكم السليم والرعاية."
    },
    {
      "title": "لا مراقبة خفية",
      "body": "لا ينبغي أن يعتمد النظام على التقاط الرسائل أو كلمات المرور أو تسجيل الشاشة سرًا أو جمع صور الطفل في الخلفية."
    },
    {
      "title": "حماية متاحة لأسر أكثر",
      "body": "ينبغي تصميم وسائل حماية مفيدة لتكون متاحة لعدد أكبر من الأسر."
    },
    {
      "title": "لا ادعاءات غير صحيحة",
      "body": "الثقة تحتاج إلى الصراحة بشأن ما هو متاح وما هو محدود وما سيأتي لاحقًا."
    }
  ],

  // M — أكثر أسئلة الخصوصية أهمية.
  "privacy.faq.title": "أسئلة شائعة عن الخصوصية",
  "privacy.faq.items": [
    {
      "q": "هل يجمع نظام الحماية الأبوية معلومات عن طفلي؟",
      "a": "يحتاج نظام الحماية الأبوية إلى معالجة بعض المعلومات حتى تعمل وظائف الحماية. والهدف هو إبقاء النشاط الحساس على الأجهزة الموثوقة لدى الأسرة، أو مزامنة المعلومات ذات الصلة بتشفير من طرف إلى طرف عند الحاجة، بدلًا من إنشاء ملف مركزي مقروء لدى النظام. وفي الوقت نفسه تحتاج الخدمات المركزية إلى الحد الأدنى من معلومات الحساب والمعلومات التقنية لتشغيل الخدمة."
    },
    {
      "q": "كيف أبلغ عن مشكلة تتعلق بالخصوصية أو الأمان؟",
      "a": "إذا كنت تعتقد أنك وجدت مشكلة أمنية، فيُرجى الانتظار حتى تنشر المنصة قنوات الإبلاغ — راجع صفحة التواصل. لا ترسل معلومات حساسة عن الطفل إلا إذا طُلبت منك معلومة محددة وضرورية بطريقة آمنة."
    }
  ],

  // قسم متقدم واضح العنوان — المكان الوحيد الذي تُستخدم فيه المصطلحات التقنية.
  "privacy.advanced.title": "تفاصيل تقنية إضافية",
  "privacy.advanced.lead": "هذا القسم لمن يرغب في التفاصيل التقنية، ولا تحتاج إليه لاستخدام النظام.",
  "privacy.advanced.items": [
    {
      "claimId": "CLM-046",
      "title": "الفصل بين تطبيق الوالدين ومنصة الإدارة",
      "body": "يعمل تطبيق الوالدين ومنصة الإدارة في بيئتين منفصلتين من ناحية الأمان والجلسات والأدوار والصلاحيات. ولا يجوز أن تصبح لوحة الإدارة الداخلية طريقًا مختصرًا للوصول إلى تجربة الوالدين المحمية."
    },
    {
      "title": "لم يُصمَّم النظام للمراقبة الخفية",
      "body": "لم يُصمَّم النظام لالتقاط كلمات المرور أو الرسائل، أو اعتراض اتصالات TLS بشكل خفي، أو فحص معرض الصور في الخلفية، أو تسجيل الشاشة سرًا."
    }
  ],

  "privacy.cta.policy": "اقرأ سياسة الخصوصية التفصيلية"
};
