# PCA Release A — Independent Native Arabic Public-Content Review

## Review status

- **Authoritative source baseline:** `pca-dev = 2b73808244361c1fb4a2aefd2ac2bed6a081d27b`
- **Authoritative review pack:** `RELEASE_A_ARABIC_REVIEW_PACK.csv`
- **Rows reviewed:** 189 / 189
- **Sampling:** none; every row was reviewed against its exact English source, route, component, claim/status and risk context.
- **OD-12 final sign-off:** **NOT GRANTED**. This report is an independent preliminary linguistic/adversarial review only.

## Exact row classifications

- `TOTAL_ARABIC_KEYS = 189`
- `PASS = 127`
- `REVISE_LOW = 31`
- `REVISE_MEDIUM = 21`
- `REVISE_HIGH = 5`
- `OWNER_DECISION_REQUIRED = 0`
- `LEGAL_REVIEW_REQUIRED = 5`

### Cross-cutting finding counts

- `ENGLISH_LEAKAGE_FINDINGS = 1`
- `PRIVACY_HEDGE_DRIFT_FINDINGS = 3`
- `GENDER_AGREEMENT_FINDINGS = 0`
- `FEATURE_STATUS_DRIFT_FINDINGS = 3`
- `CTA_FINDINGS = 5`
- `LEGAL_REVIEW_FLAGGED_ROWS_IN_SOURCE_PACK = 62`

## Preliminary conclusion

The Arabic corpus is broadly strong and usable, with exact EN/AR key parity already validated by the export. Most strings are natural and preserve PCA's calm, parent-facing tone. The corpus is **not yet ready for OD-12 sign-off** because several corrections affect privacy precision, feature-state precision, legal terminology, accessibility terminology and CTA naturalness.

The five highest-priority linguistic findings are:

1. **`privacyPolicy.notCollected.body` — REVISE_HIGH:** the Arabic currently contains only the list of data types and omits the core prohibition that PCA central systems must not store them in readable form.
2. **`privacy.topics.items` — REVISE_HIGH:** two clauses omit the qualifier **readable** from centrally held app-usage/location data, making Arabic stronger than English; the camera availability wording also needs correction.
3. **`privacyPolicy.childDevice.body` — REVISE_HIGH:** `should remain` became the stronger `must remain`, and the transit/relay encryption context was omitted.
4. **`privacy.principles.items` — REVISE_HIGH:** `Protection without surveillance` became `without excessive surveillance`, which weakens the approved principle.
5. **`status.platform` — REVISE_HIGH:** `Requires platform support` became the weaker `depends on platform support`; the Arabic status should retain the requirement.

## Adversarial second-pass findings

### 1. Arabic stronger or weaker than English

- `privacy.principles.items`: **weaker** — «دون مراقبة مفرطة» permits non-excessive surveillance, while the English says `without surveillance`.
- `privacy.topics.items`: **stronger** — removing `readable` from central app-usage and precise-location clauses can be read as a promise of no central data at all.
- `privacyPolicy.childDevice.body`: **stronger and less precise** — `should remain` became «يجب أن تبقى», while `in transit/relay` disappeared.

### 2. PCA feminine agreement

No material feminine-agreement defect was found. Current strings consistently use forms such as «صُممت PCA»، «تساعد PCA»، «تُعِدّ PCA» and «لم تُفتح PCA» appropriately. `GENDER_AGREEMENT_FINDINGS = 0`.

### 3. Child/family terminology

The corpus generally uses child-focused terms correctly. The main improvements are to avoid literal technical expressions such as «الملفات العشوائية», and to use «لدى الأسرة / أجهزة الأسرة الموثوقة» only when the English genuinely refers to family-side architecture.

### 4. Feature availability

Android and iOS release wording is mostly correctly hedged as planned/coming later. Corrections are required where account access was narrowed to account creation, where camera `active` was rendered as «فعّالة», and where `Requires platform support` was weakened to «يعتمد على دعم المنصة».

### 5. English leakage and mixed-direction text

No internal implementation terms such as claim IDs, runtime proof, external-security-review, PPR or PUBLIC phase names leaked into public Arabic. One user-facing accessibility string should explain `LTR` and `RTL` in Arabic before retaining the abbreviations. Brand/platform names such as PCA, PCA Parent, PCA Child, Android, iPhone/iPad and YouTube are acceptable where used.

### 6. Legal wording

The source pack flags 62 strings for legal review. This review does **not** grant legal approval. Five rows are classified `LEGAL_REVIEW_REQUIRED` because the proposed linguistic correction directly affects legal scope or terminology: legal entity terminology, session-replay/authenticated-surface disclosure, deletion/retention behavior, contractual feature availability, and authorized-use scope.

## Row-by-row classification — all 189 keys

| # | Key | Route | Decision | Severity | Note |
|---:|---|---|---|---|---|
| 1 | `a11y.skipToContent` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 2 | `accessibility.barrier.body` | `/ar/accessibility/` | **REVISE_LOW** | LOW | يحسّن السلاسة ويستبدل التعبير غير الطبيعي «تُفتح PCA للأسر» بـ«إتاحة PCA للأسر» دون تغيير حالة الإطلاق. |
| 3 | `accessibility.barrier.title` | `/ar/accessibility/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 4 | `accessibility.cta.contact` | `/ar/accessibility/` | **REVISE_LOW** | LOW | صياغة أكثر طبيعية وفعلية لزر دعوة إلى الإجراء، وتحافظ على المعنى نفسه. |
| 5 | `accessibility.goals.items` | `/ar/accessibility/` | **REVISE_MEDIUM** | MEDIUM | تُصحَّح مصطلحات إمكانية الوصول غير الطبيعية مثل «حالات تركيز» و«أهداف لمس»، مع شرح LTR/RTL بالعربية بدل ترك اختصارات تقنية غير مفسرة. |
| 6 | `accessibility.goals.lead` | `/ar/accessibility/` | **REVISE_LOW** | LOW | أكثر طبيعية من «نصمم ونختبر من أجل» في العربية. |
| 7 | `accessibility.goals.title` | `/ar/accessibility/` | **REVISE_LOW** | LOW | العنوان الحالي «أهدافنا» عام أكثر من المصدر الإنجليزي ويفقد موضوع إمكانية الوصول. |
| 8 | `accessibility.hero.body` | `/ar/accessibility/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 9 | `accessibility.hero.title` | `/ar/accessibility/` | **REVISE_LOW** | LOW | صياغة عربية طبيعية تتجنب التركيب الحرفي «قابلة للاستخدام من قبل أسر أكثر». |
| 10 | `accessibility.seo.description` | `/ar/accessibility/` | **REVISE_LOW** | LOW | تحسين السلاسة والدقة؛ «الحركة المخففة» تعبير غير طبيعي، كما أن الاستجابة تخص الواجهة على الأجهزة. |
| 11 | `accessibility.seo.title` | `/ar/accessibility/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 12 | `brand.homeLink` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 13 | `contact.categories.items` | `/ar/contact/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 14 | `contact.categories.title` | `/ar/contact/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 15 | `contact.hero.body` | `/ar/contact/` | **REVISE_MEDIUM** | MEDIUM | النص الحالي يضيف «فريق PCA» رغم أن المصدر يقول PCA فقط. المقترح يحافظ على الجهة والشرط كما وردا في الإنجليزية. |
| 16 | `contact.hero.title` | `/ar/contact/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 17 | `contact.privacyNote.body` | `/ar/contact/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 18 | `contact.privacyNote.title` | `/ar/contact/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 19 | `contact.seo.description` | `/ar/contact/` | **REVISE_LOW** | LOW | تحسين الصياغة الطبيعية مع الحفاظ على حالة الإطلاق. |
| 20 | `contact.seo.title` | `/ar/contact/` | **REVISE_MEDIUM** | MEDIUM | العنوان العربي الحالي يحذف المعلومة الأساسية في المصدر: أن القنوات ستفتح قبل الإطلاق. |
| 21 | `cta.access` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **REVISE_LOW** | LOW | «إتاحة PCA» ثقيلة وغير طبيعية كزر؛ المقترح واضح للوالد ولا يخلط مع مصطلح إمكانية الوصول. |
| 22 | `cta.allFaqs` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **REVISE_LOW** | LOW | يحوّل النص إلى دعوة إجراء فعلية بدل اسم قسم فقط. |
| 23 | `cta.childSafety` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 24 | `cta.createAccount` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 25 | `cta.exploreFeatures` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 26 | `cta.getStarted` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 27 | `cta.howPcaWorks` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 28 | `cta.login` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 29 | `cta.pcaParent` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 30 | `cta.privacyHandling` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **REVISE_LOW** | LOW | دعوة إجراء أكثر طبيعية واتساقًا مع المصدر الإنجليزي. |
| 31 | `cta.seeHowPcaWorks` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 32 | `cta.whyPca` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 33 | `footer.group.help` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 34 | `footer.group.legal` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **REVISE_LOW** | LOW | «الشؤون القانونية» يوحي بقسم إداري داخل مؤسسة؛ «المعلومات القانونية» أنسب لمجموعة روابط في التذييل. |
| 35 | `footer.group.pca` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 36 | `footer.group.trust` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **REVISE_LOW** | LOW | المصدر الإنجليزي هو Trust فقط؛ النص الحالي يضيف «والخصوصية» دون حاجة. |
| 37 | `footer.legalNote` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **REVISE_MEDIUM** | MEDIUM | النص الحالي يستبدل مفهوم availability بـ«المزايا»، ما يضيّق المعنى. المقترح يبقى عامًا ويمنع الإيحاء بإتاحة أي عنصر لم يُطرح. |
| 38 | `home.affordability.body` | `/ar/` | **REVISE_LOW** | LOW | «القدرة على تحمل التكلفة» ترجمة حرفية ثقيلة؛ المقترح أوضح للوالدين. |
| 39 | `home.affordability.label` | `/ar/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 40 | `home.affordability.title` | `/ar/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 41 | `home.availability.items` | `/ar/` | **REVISE_MEDIUM** | MEDIUM | المصدر يقول إن الوصول إلى الحساب غير مفتوح بعد، بينما العربية الحالية تحصر ذلك في إنشاء الحساب. كما تُحسَّن صياغة الحالات المخطط لها دون جعلها... |
| 42 | `home.availability.label` | `/ar/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 43 | `home.availability.title` | `/ar/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 44 | `home.different.items` | `/ar/` | **REVISE_LOW** | LOW | تحسينات طبيعية، خصوصًا «صُممت المعلومات الحساسة» و«القدرة على تحمل التكلفة»، مع بقاء المعنى والقيود كما هي. |
| 45 | `home.different.label` | `/ar/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 46 | `home.different.title` | `/ar/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 47 | `home.faq.items` | `/ar/` | **REVISE_MEDIUM** | MEDIUM | «الملفات العشوائية» غير طبيعية وقد تُفهم خطأ، كما تُحسَّن صياغة الميزات المخطط لها وتحافظ صراحةً على حالة «إصدار لاحق». |
| 48 | `home.faq.label` | `/ar/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 49 | `home.faq.title` | `/ar/` | **REVISE_MEDIUM** | MEDIUM | المصدر Quick answers وليس Quick questions؛ «أسئلة سريعة» تغيّر معنى العنوان. |
| 50 | `home.final.body` | `/ar/` | **REVISE_LOW** | LOW | «احتفظ بالتحكم» تركيب مترجم حرفيًا؛ المقترح طبيعي ويحافظ على معنى stay in control. |
| 51 | `home.final.title` | `/ar/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 52 | `home.hero.body` | `/ar/` | **REVISE_LOW** | LOW | «بما في ذلك الإنترنت» أقل طبيعية من «على الإنترنت» للمقصود online. |
| 53 | `home.hero.reassure` | `/ar/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 54 | `home.hero.title` | `/ar/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 55 | `home.protects.items` | `/ar/` | **REVISE_MEDIUM** | MEDIUM | تصحيح فروق معنى في ثلاث نقاط: apply approved decisions ≠ اتخاذ القرارات، active ≠ تعمل بالضرورة، وReceive alerts ≠ إرسال التنبيهات. |
| 56 | `home.protects.label` | `/ar/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 57 | `home.protects.title` | `/ar/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 58 | `home.seo.description` | `/ar/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 59 | `home.seo.title` | `/ar/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 60 | `home.steps.items` | `/ar/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 61 | `home.steps.label` | `/ar/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 62 | `home.steps.title` | `/ar/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 63 | `home.why.body` | `/ar/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 64 | `home.why.label` | `/ar/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 65 | `home.why.title` | `/ar/` | **REVISE_MEDIUM** | MEDIUM | المصدر الحالي يقول parent's concern بينما العربية تحدده بأنه أب. المقترح يتبع المصدر الإنجليزي الحالي دون إضافة جنس الوالد. |
| 66 | `howItWorks.child.items` | `/ar/how-it-works/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 67 | `howItWorks.child.title` | `/ar/how-it-works/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 68 | `howItWorks.hero.body` | `/ar/how-it-works/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 69 | `howItWorks.hero.title` | `/ar/how-it-works/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 70 | `howItWorks.parent.items` | `/ar/how-it-works/` | **REVISE_LOW** | LOW | تحسين «لوصول أقرب للتطبيق» إلى صياغة عربية طبيعية مع الحفاظ على أن التثبيت اختياري. |
| 71 | `howItWorks.parent.title` | `/ar/how-it-works/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 72 | `howItWorks.security.body` | `/ar/how-it-works/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 73 | `howItWorks.security.title` | `/ar/how-it-works/` | **REVISE_LOW** | LOW | أكثر طبيعية ووضوحًا لغير المتخصص من «فرق أمني مهم». |
| 74 | `howItWorks.sensitive.body` | `/ar/how-it-works/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 75 | `howItWorks.sensitive.title` | `/ar/how-it-works/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 76 | `howItWorks.seo.description` | `/ar/how-it-works/` | **REVISE_MEDIUM** | MEDIUM | العربية الحالية تحذف family requests من وصف SEO. |
| 77 | `howItWorks.seo.title` | `/ar/how-it-works/` | **REVISE_LOW** | LOW | أقرب إلى Parent and Child Protection Flow من الصياغة الحالية التي تحصر المعنى في جهاز الطفل. |
| 78 | `howItWorks.steps.items` | `/ar/how-it-works/` | **REVISE_MEDIUM** | MEDIUM | يعيد مفهوم verified platform capabilities الذي اختفى في العربية، ويحافظ على صيغة should في الخطوة الأخيرة، ويحسن صياغة مسار التسجيل والربط. |
| 79 | `howItWorks.steps.label` | `/ar/how-it-works/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 80 | `howItWorks.steps.title` | `/ar/how-it-works/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 81 | `legal.provisionalNotice` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 82 | `nav.about` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 83 | `nav.access` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 84 | `nav.accessibility` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 85 | `nav.childSafety` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 86 | `nav.contact` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 87 | `nav.download` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **REVISE_LOW** | LOW | المصدر هو Download فقط؛ إضافة «والتثبيت» توسع عنوان التنقل دون سند من هذا المفتاح. |
| 88 | `nav.faq` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 89 | `nav.features` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 90 | `nav.home` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 91 | `nav.howItWorks` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 92 | `nav.languageLabel` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 93 | `nav.menu` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 94 | `nav.parents` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 95 | `nav.primaryLabel` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 96 | `nav.privacy` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 97 | `nav.privacyPolicy` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 98 | `nav.security` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 99 | `nav.terms` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 100 | `nav.whyPca` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 101 | `notFound.arabicHomeCta` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 102 | `notFound.arabicNote` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 103 | `notFound.body` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 104 | `notFound.homeCta` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 105 | `notFound.seo.title` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 106 | `notFound.title` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 107 | `privacy.advanced.items` | `/ar/privacy/` | **REVISE_MEDIUM** | MEDIUM | العربية الحالية تحذف بُعد الأمان والأدوار من security/session/RBAC realms. المقترح يشرح المعنى دون عرض مصطلح RBAC الداخلي، ويجعل TLS مفهومًا ض... |
| 108 | `privacy.advanced.lead` | `/ar/privacy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 109 | `privacy.advanced.title` | `/ar/privacy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 110 | `privacy.cta.policy` | `/ar/privacy/` | **REVISE_LOW** | LOW | المصدر دعوة فعلية للقراءة؛ النص الحالي اسم صفحة لا CTA. |
| 111 | `privacy.faq.items` | `/ar/privacy/` | **REVISE_MEDIUM** | MEDIUM | يعيد technical data التي تحولت إلى «معلومات التشغيل»، ويحافظ على where required بصياغة «عند الحاجة» دون تقوية الادعاء. |
| 112 | `privacy.faq.title` | `/ar/privacy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 113 | `privacy.hero.body` | `/ar/privacy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 114 | `privacy.hero.title` | `/ar/privacy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 115 | `privacy.honesty.body` | `/ar/privacy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 116 | `privacy.honesty.title` | `/ar/privacy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 117 | `privacy.notStored.items` | `/ar/privacy/` | **REVISE_MEDIUM** | MEDIUM | «الملفات العشوائية» و«التسجيلات الخلفية للشاشة» تعبيران غير طبيعيين وقد يربكان القارئ؛ المقترح أوضح مع الحفاظ على نطاق الحظر. |
| 118 | `privacy.notStored.title` | `/ar/privacy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 119 | `privacy.principles.items` | `/ar/privacy/` | **REVISE_HIGH** | HIGH | العنوان «الحماية دون مراقبة مفرطة» يضعف المصدر Protection without surveillance لأنه يسمح ضمنيًا بمراقبة غير «مفرطة». هذا انحراف في قوة مبدأ ال... |
| 120 | `privacy.principles.lead` | `/ar/privacy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 121 | `privacy.principles.title` | `/ar/privacy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 122 | `privacy.retention.body` | `/ar/privacy/` | **REVISE_LOW** | LOW | «نية التصميم» ترجمة حرفية؛ «أهداف تصميم PCA» أوضح ولا تغيّر كون الأدوات غير مبنية بعد. |
| 123 | `privacy.retention.title` | `/ar/privacy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 124 | `privacy.seo.description` | `/ar/privacy/` | **REVISE_MEDIUM** | MEDIUM | يعيد local-first وfamily-side data بصورة أوضح؛ النص الحالي يحصر family-side في «الأجهزة الموثوقة» ويضعف معنى أولوية المعالجة المحلية. |
| 125 | `privacy.seo.title` | `/ar/privacy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 126 | `privacy.topics.items` | `/ar/privacy/` | **REVISE_HIGH** | HIGH | في البندين 3 و5 حذفت العربية الحالية قيد «centrally readable»، فأصبحت توحي بعدم وجود أي بيانات مركزية مطلقًا، وهو ادعاء أقوى من الإنجليزية. كم... |
| 127 | `privacy.topics.title` | `/ar/privacy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 128 | `privacy.where.items` | `/ar/privacy/` | **REVISE_MEDIUM** | MEDIUM | تحسين دقة المصطلحات: «opaque identifiers» ليست ببساطة «معرفات مبهمة»، وproduction scope هو نطاق خاضع للتحقق لا «نطاق التشفير النهائي» بالضرورة... |
| 129 | `privacy.where.title` | `/ar/privacy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 130 | `privacyPolicy.account.body` | `/ar/privacy-policy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 131 | `privacyPolicy.account.title` | `/ar/privacy-policy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 132 | `privacyPolicy.childDevice.body` | `/ar/privacy-policy/` | **REVISE_HIGH** | HIGH | العربية الحالية تحوّل should remain إلى «فيجب أن تبقى» الأقوى، وتحذف قيد in transit/relay. كلاهما يغيّر قوة ونطاق ادعاء الخصوصية، لذا يلزم تصح... |
| 133 | `privacyPolicy.childDevice.title` | `/ar/privacy-policy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 134 | `privacyPolicy.contact.body` | `/ar/privacy-policy/` | **LEGAL_REVIEW_REQUIRED** | MEDIUM | «الجهة القانونية» ليست ترجمة دقيقة دائمًا لـlegal entity. المقترح أدق، لكن اعتماد مصطلح الكيان القانوني جزء من النص القانوني النهائي ويجب مراج... |
| 135 | `privacyPolicy.contact.title` | `/ar/privacy-policy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 136 | `privacyPolicy.cookies.body` | `/ar/privacy-policy/` | **LEGAL_REVIEW_REQUIRED** | HIGH | «إعادة تشغيل الجلسات» وحدها قد تُفهم كإعادة تشغيل جلسة تقنية، كما أن العربية الحالية تحذف authenticated. التصحيح يغيّر نطاق إفصاح تتبع/تحليلات... |
| 137 | `privacyPolicy.cookies.title` | `/ar/privacy-policy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 138 | `privacyPolicy.deletion.body` | `/ar/privacy-policy/` | **LEGAL_REVIEW_REQUIRED** | HIGH | التصحيح يوضح pending runtime verification وdelivery queues وmust account for. لأن صياغة الحذف والاحتفاظ ذات أثر قانوني، يجب ألا تعتمد دون مراج... |
| 139 | `privacyPolicy.deletion.title` | `/ar/privacy-policy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 140 | `privacyPolicy.feedback.body` | `/ar/privacy-policy/` | **REVISE_MEDIUM** | MEDIUM | «معلومات الحالة» لا تنقل معنى case metadata بدقة. المقترح يحافظ على الحد الأدنى المعتمد ولا يوسع البيانات المرسلة. |
| 141 | `privacyPolicy.feedback.title` | `/ar/privacy-policy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 142 | `privacyPolicy.hero.title` | `/ar/privacy-policy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 143 | `privacyPolicy.notCollected.body` | `/ar/privacy-policy/` | **REVISE_HIGH** | HIGH | العربية الحالية ليست جملة حظر أصلًا؛ إنها قائمة فقط، وتحذف «PCA central systems must not store readable». هذا أخطر فقد للمعنى في الحزمة لأنه ي... |
| 144 | `privacyPolicy.notCollected.title` | `/ar/privacy-policy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 145 | `privacyPolicy.processing.body` | `/ar/privacy-policy/` | **REVISE_LOW** | LOW | «جهاز الوالدين الموثوق» تركيب غير طبيعي؛ المقترح يحافظ على trusted parent device وعلى may. |
| 146 | `privacyPolicy.processing.title` | `/ar/privacy-policy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 147 | `privacyPolicy.providers.body` | `/ar/privacy-policy/` | **REVISE_LOW** | LOW | صياغة أوضح لـpending deployment/runtime inventory. |
| 148 | `privacyPolicy.providers.title` | `/ar/privacy-policy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 149 | `privacyPolicy.retention.body` | `/ar/privacy-policy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 150 | `privacyPolicy.retention.title` | `/ar/privacy-policy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 151 | `privacyPolicy.seo.description` | `/ar/privacy-policy/` | **REVISE_MEDIUM** | MEDIUM | العربية الحالية تختصر child-protection إلى «معلومات الحماية» وتستبدل runtime بـ«فني» عام. المقترح أدق دون إضافة التزام جديد. |
| 152 | `privacyPolicy.seo.title` | `/ar/privacy-policy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 153 | `privacyPolicy.summary.body` | `/ar/privacy-policy/` | **REVISE_MEDIUM** | MEDIUM | يعيد «technical data needed to operate the service» الذي تحول إلى «معلومات الحساب والتشغيل»، ويجعل الجملة الثانية أكثر مطابقة للمصدر مع الحفاظ... |
| 154 | `privacyPolicy.summary.title` | `/ar/privacy-policy/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 155 | `release.contactNotice` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **REVISE_LOW** | LOW | تحسين طبيعي لـ«تُفتح PCA للأسر» دون تغيير حالة القنوات. |
| 156 | `release.journeyNotice` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **REVISE_LOW** | LOW | تحسين السلاسة وتوحيد email verification إلى «تأكيد البريد الإلكتروني» مع الإبقاء على later release. |
| 157 | `release.reportingPending` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **REVISE_LOW** | LOW | تحسين طبيعي دون تغيير حالة الإطلاق. |
| 158 | `status.available` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **REVISE_LOW** | LOW | «متاح» هو المقابل القياسي لحالة Available في واجهات المنتجات، وأكثر اتساقًا من «متوفر» مع نظام الحالات. |
| 159 | `status.later` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 160 | `status.limited` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 161 | `status.platform` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **REVISE_HIGH** | HIGH | «يعتمد على دعم المنصة» أضعف من Requires platform support وقد يُفهم كاعتماد عادي لا كشرط توفر. هذه حالة ميزة حرجة ويجب الحفاظ على قوة الشرط. |
| 162 | `terms.acceptableUse.body` | `/ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 163 | `terms.acceptableUse.title` | `/ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 164 | `terms.accountSecurity.body` | `/ar/terms/` | **REVISE_MEDIUM** | MEDIUM | العربية الحالية تحذف suspected من unauthorized access وتعمم «ضوابط الأمان» بدل account-security controls. التصحيح مهم لمعنى المسؤولية والأمان. |
| 165 | `terms.accountSecurity.title` | `/ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 166 | `terms.availability.body` | `/ar/terms/` | **LEGAL_REVIEW_REQUIRED** | HIGH | «الصلاحيات» ليست المقابل الدقيق لـentitlement في سياق الإتاحة التجارية/الوظيفية، والجملة الثانية ذات أثر تعاقدي مباشر. المقترح أقرب للمصدر لكن... |
| 167 | `terms.availability.title` | `/ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 168 | `terms.changes.body` | `/ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 169 | `terms.changes.title` | `/ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 170 | `terms.hero.title` | `/ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 171 | `terms.privacy.body` | `/ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 172 | `terms.privacy.title` | `/ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 173 | `terms.responsibility.body` | `/ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 174 | `terms.responsibility.title` | `/ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 175 | `terms.seo.description` | `/ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 176 | `terms.seo.title` | `/ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 177 | `terms.using.body` | `/ar/terms/` | **LEGAL_REVIEW_REQUIRED** | HIGH | النص الحالي قد يُقرأ على أن «الأطفال» هم الموصوفون بالمدعومين بدل وظائف الحماية. التصحيح يمس نطاق الاستخدام المصرح به، لذلك يجب مراجعته قانونيًا. |
| 178 | `terms.using.title` | `/ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 179 | `video.captions.ar` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 180 | `video.captions.en` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 181 | `video.enroll.summary` | `/ar/ /ar/how-it-works/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 182 | `video.enroll.title` | `/ar/ /ar/how-it-works/` | **REVISE_MEDIUM** | MEDIUM | «خطوات التسجيل في PCA» قد يُفهم كتسجيل حساب فقط، بينما الفيديو يغطي الحساب وتسجيل/ربط جهاز الطفل وإعداد الحماية كاملًا. |
| 183 | `video.enroll.transcript` | `/ar/ /ar/how-it-works/` | **REVISE_LOW** | LOW | في الخطوة 4 source يقول platform لا «نوع الجهاز». بقية النص يحافظ جيدًا على حالات Android/iOS والإطلاق اللاحق. |
| 184 | `video.intro.summary` | `/ar/ /ar/how-it-works/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 185 | `video.intro.title` | `/ar/ /ar/how-it-works/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 186 | `video.intro.transcript` | `/ar/ /ar/how-it-works/` | **REVISE_LOW** | LOW | التعديل فقط لتحسين «سعة الإتاحة» إلى «الإتاحة الواسعة»؛ بقية النص طبيعي ويحافظ على قيود الخصوصية وحالة دعم المنصة. |
| 187 | `video.seo.description` | `/ar/ /ar/how-it-works/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |
| 188 | `video.seo.title` | `/ar/ /ar/how-it-works/` | **REVISE_LOW** | LOW | «مقاطع فيديو» أفصح وأكثر اتساقًا مع العربية العامة من «فيديوهات». |
| 189 | `video.transcriptLabel` | `/ar/ /ar/how-it-works/ /ar/privacy/ /ar/contact/ /ar/accessibility/ /ar/privacy-policy/ /ar/terms/` | **PASS** | NONE | النص العربي طبيعي ووفِيّ للمصدر الإنجليزي، ولا يغيّر قوة الادعاء أو حالة الميزة. |

## Required final status

```text
TOTAL_ARABIC_KEYS = 189
PASS = 127
REVISE_LOW = 31
REVISE_MEDIUM = 21
REVISE_HIGH = 5
OWNER_DECISION_REQUIRED = 0
LEGAL_REVIEW_REQUIRED = 5

ENGLISH_LEAKAGE_FINDINGS = 1
PRIVACY_HEDGE_DRIFT_FINDINGS = 3
GENDER_AGREEMENT_FINDINGS = 0
FEATURE_STATUS_DRIFT_FINDINGS = 3
CTA_FINDINGS = 5

SUPPORTER_ARABIC_REVIEW = COMPLETE
NATIVE_ARABIC_PRELIMINARY_STATUS = PASS_WITH_CORRECTIONS
OD_12_FINAL_SIGNOFF = NOT_GRANTED
```
