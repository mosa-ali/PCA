# PCA Arabic Public Website Language Audit — 2026-09

Status: final source-language corrections implemented; native Arabic sign-off, mobile visual QA, and live deployment verification remain open.

## Scope and route inventory

The live Arabic site was reviewed through its primary navigation and footer. Eight Arabic routes were observed and reviewed at desktop browser width; the same source route set emits Arabic HTML with `lang="ar"` and `dir="rtl"`.

| Route | Source | Reviewed | Main findings | Corrected |
| --- | --- | --- | --- | --- |
| `/ar/` | `public-web/src/content/pages/home.ar.mjs` | Yes | repeated PCA in prose; product wording; FAQ/video content | Yes |
| `/ar/how-it-works/` | `public-web/src/content/pages/howItWorks.ar.mjs` | Yes | PCA Parent/Child repetition; literal setup wording; FAQ phrasing | Yes |
| `/ar/privacy/` | `public-web/src/content/pages/privacy.ar.mjs` | Yes | PCA as sentence subject; technical product labels; privacy wording | Yes |
| `/ar/download/` | `public-web/src/content/pages/download.ar.mjs` | Yes | mixed product names; platform labels; awkward availability copy | Yes |
| `/ar/contact/` | `public-web/src/content/pages/contact.ar.mjs` | Yes | PCA repetition; contact wording | Yes |
| `/ar/accessibility/` | `public-web/src/content/pages/accessibility.ar.mjs` | Yes | PCA repetition; product description | Yes |
| `/ar/privacy-policy/` | `public-web/src/content/pages/privacyPolicy.ar.mjs` | Yes | legal prose and technical nouns; PCA repetition | Yes, pending legal review |
| `/ar/terms/` | `public-web/src/content/pages/terms.ar.mjs` | Yes | legal prose and PCA repetition | Yes, pending legal review |

The source also emits `/ar/sign-in/` as a linked utility route from the shared header. Its Arabic source and neutral realm chooser are present in `public-web/src/content/pages/signIn.ar.mjs`; the live host previously returned a not-found page for direct navigation, so this is a deployment-alignment defect rather than a source-routing gap. No authentication behavior was invented or changed.

## Final internal acceptance pass

- All 203 Arabic keys were read against the English key set and the current source. Thirty-one string/subitem language defects were corrected across the nine Arabic page modules reviewed in this final pass.
- The final pass covered natural Arabic grammar, technical terminology, privacy wording, safety wording, claim strength, and punctuation. It did not change business logic, privacy behavior, security behavior, route policy, or design.
- All 29 retained `PCA` references were re-reviewed. They remain because they identify the brand, an official product/app/platform name, an approved technical identifier, or a necessary first-reference locator. No additional PCA reference was removed or changed in this pass.
- `AR_SIGN_IN_EXPECTED = YES`; source route generation and header linkage are present. `AR_SIGN_IN_404_STATUS = DEFECT` on the live host until the corrected build is published.

## Terminology decisions

| Concept | Arabic choice | English retained when |
| --- | --- | --- |
| PCA as the overall system | `نظام الحماية الأبوية` / `النظام` | brand, SEO identity, or first identification |
| PCA Parent | `تطبيق الوالدين (PCA Parent)` on identification; `تطبيق الوالدين` afterward | the official app must be found or distinguished |
| PCA Child | `تطبيق الطفل (PCA Child)` on identification; `تطبيق الطفل` afterward | the official app must be found or distinguished |
| PCA Platform Admin | `منصة الإدارة (Platform Admin)` on identification; `منصة الإدارة` afterward | technical product identification |
| Trusted Browser | `المتصفح الموثوق` | not a brand name; Arabic is clearer |
| Screen time | `وقت الشاشة` | never needed |
| Protection rules | `قواعد الحماية` / `إعدادات الحماية` | never needed |
| Pairing/enrollment | `الربط` / `الإعداد` | never needed |
| iPhone, iPad, YouTube, TLS | official technical or trademark identifiers | identification and technical accuracy |
| LTR, RTL | Arabic direction wording followed by the abbreviations | explaining the technical direction values |

## Representative corrections

1. `PCA — حماية الأطفال في المساحات الرقمية` → `نظام الحماية الأبوية PCA — حماية الأطفال في المساحات الرقمية`
2. `تساعد PCA الوالدين` → `يساعد نظام الحماية الأبوية الوالدين`
3. `صُممت PCA بحيث لا تنشئ` → `صُمم نظام الحماية الأبوية بحيث لا ينشئ`
4. `لماذا وُجدت PCA؟` → `لماذا وُجد نظام الحماية الأبوية؟`
5. `لماذا PCA مختلفة؟` → `ما الذي يميز نظام الحماية الأبوية؟`
6. `خطوات التسجيل في PCA` → `خطوات إعداد نظام الحماية الأبوية`
7. `أنشئ حساب PCA Parent` → `أنشئ حساب الوالدين`
8. `أكّد بريدك الإلكتروني لتفعيل الوصول إلى PCA Parent` → `أكّد بريدك الإلكتروني لتفعيل الوصول إلى تطبيق الوالدين`
9. `إعداد الطفل داخل PCA Parent` → `إعداد الطفل في تطبيق الوالدين`
10. `أضف طفلك داخل PCA Parent` → `أضف طفلك في تطبيق الوالدين`
11. `تثبيت PCA Child` → `تثبيت تطبيق الطفل (PCA Child)`
12. `PCA Parent وPCA Child` → `تطبيق الوالدين (PCA Parent) وتطبيق الطفل (PCA Child)`
13. `ما الذي تحميه PCA؟` → `ما الذي يحميه نظام الحماية الأبوية؟`
14. `هل تجمع PCA معلومات طفلي؟` → `هل يجمع نظام الحماية الأبوية معلومات عن طفلي؟`
15. `لم تُصمم PCA حول المراقبة الخفية` → `لم يُصمَّم النظام للمراقبة الخفية`
16. `فصل PCA Parent عن PCA Platform Admin` → `الفصل بين تطبيق الوالدين ومنصة الإدارة`
17. `PCA Parent وPCA Platform Admin بيئتان منفصلتان` → `يعمل تطبيق الوالدين ومنصة الإدارة في بيئتين منفصلتين`
18. `تحتاج PCA إلى معالجة بعض المعلومات` → `يحتاج نظام الحماية الأبوية إلى معالجة بعض المعلومات`
19. `قد تستخدم PCA معرفات غير مقروءة` → `قد يستخدم النظام معرّفات مبهمة`
20. `الملفات العشوائية` → `الملفات الأخرى`
21. `لقطات/تسجيلات الشاشة في الخلفية` → `لقطات الشاشة أو تسجيلاتها في الخلفية`
22. `الحماية المتقدمة لـYouTube` retained with the product identifier; surrounding Arabic remains natural.
23. `Platform Admin` → `منصة الإدارة (Platform Admin)` when first identified, then `منصة الإدارة`.
24. `الإنجليزية LTR والعربية RTL` → `الإنجليزية من اليسار إلى اليمين (LTR) والعربية من اليمين إلى اليسار (RTL)`.

## RTL, privacy, and security review

- Arabic output retains `lang="ar"` and `dir="rtl"`; the build check verifies this for every emitted Arabic page.
- No bidirectional override characters or layout redesign were introduced.
- Remaining Latin tokens are official names or technical identifiers and were not translated in a way that would make them harder to locate.
- The final Arabic corpus contains 29 intentional `PCA` occurrences, including 10 `PCA Parent` and 8 `PCA Child` identifications; no remaining occurrence is an accidental product-name repetition in ordinary Arabic prose.
- Privacy and security meaning was preserved. No claim status, availability status, encryption limitation, or legal caveat was strengthened.
- Legal pages remain explicitly provisional and still require legal approval.

## Validation and unresolved items

- `npm run check`: PASS.
- `node build.mjs`: PASS; 18 pages emitted, EN/AR keys 203/203, zero parity failures.
- `npm test`: PASS; 9/9 tests passed. The run required elevated execution because the normal sandbox hit Windows `spawn EPERM`; the sign-off drift message printed during the intentional negative-control test and the fixture was restored.
- Local desktop browser review: PASS for the corrected Arabic home, how-it-works, and privacy routes; `lang="ar"`, `dir="rtl"`, terminology, FAQ wording, and the corrected `تثبيته` agreement were observed in the rendered accessibility tree.
- Automated mobile UAT: NOT EXECUTED because this checkout has no resolvable `playwright-core` dependency for `scripts/uat.mjs`; no mobile pass is claimed.
- Native Arabic reviewer sign-off: OPEN; the repository build intentionally reports all 203 Arabic keys pending OD-12 sign-off.
- Source publication alignment: final commit and exact `origin/pca-dev` equality are recorded in the release handoff after this audit update; no deployment was performed.
- Live deployment alignment: OPEN; the public host was not redeployed by this audit, so the corrected source is not claimed live.
- Live `/ar/sign-in/` publication: DEFECT; the source emits and links the route, but direct live navigation observed a not-found page. Deployment alignment is required.

## Post-deployment 18-route checklist

Check each English and Arabic route at desktop and 375/390/430px: HTTP 200, trailing-slash/index artifact, `lang`/`dir`, title/meta, no horizontal overflow, navigation/language switcher/footer/CTA links, mixed-direction text, FAQ behavior, console/network errors, CSP and security headers.

`/`, `/how-it-works/`, `/privacy/`, `/download/`, `/contact/`, `/accessibility/`, `/privacy-policy/`, `/terms/`, `/sign-in/`

`/ar/`, `/ar/how-it-works/`, `/ar/privacy/`, `/ar/download/`, `/ar/contact/`, `/ar/accessibility/`, `/ar/privacy-policy/`, `/ar/terms/`, `/ar/sign-in/`

For `/ar/sign-in/`, verify the neutral chooser and only the approved external handoffs to `/parent/login/` and `/platform-admin/login/`; do not add an auth form to the public site. Legal pages remain provisional and noindex expectations must remain intact.
