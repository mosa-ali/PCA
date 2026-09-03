# PCA Child Protection Terminology Glossary

`ARABIC_NATIVE_REVIEW_REQUIRED = YES` for every Arabic term below unless otherwise noted. This glossary
records current, correct engineering practice and the Owner's Family→Children direction; it does not
certify Arabic linguistic quality. Terms marked with an existing codebase citation are already live and
consistent; terms without one are proposed and need explicit native review before being treated as final.

## Purpose

PCA is a child-protection product. Copy that describes what is being protected, viewed, or exported
should name the **child**, not the household. Copy that describes **account administration** — who can
sign in, hold billing, invite other adults, or change settings for the account as a whole — legitimately
uses **family** vocabulary, because that is genuinely a multi-person administrative concept. Confusing the
two either (a) makes child-specific screens read as broad household surveillance, which is the exact
harm the Owner flagged for the Yemen context, or (b) makes real account-administration concepts
(Family Owner, Family Members, RBAC roles, billing) incorrectly narrow if "family" is mechanically
swapped for "child" there. Every glossary entry below states both directions explicitly.

## Terms

| ENGLISH_TERM | ARABIC_TERM | USE_WHEN | DO_NOT_USE_WHEN | EXAMPLE |
|---|---|---|---|---|
| **Child** | الطفل | Referring to one monitored child, their device, their data, or content addressed to them. | Referring to the account as a whole or to other adult family members. | "جهاز الطفل" (child device); dashboard `deviceEnrollment.childName` → "اسم الطفل". |
| **Children** | الأطفال | Referring to more than one monitored child collectively (e.g. a dashboard section listing all of a parent's children). | Referring to the family account, billing, or roles/permissions. | `dashboard.kpi.children` → "الأطفال" (already live, PPR-2 in-flight). |
| **Parent** | الوالد / الوالدين (plural) / أحد الوالدين ("a parent", already used on Android's Safe Browser and wellbeing-sync screens) | Referring informally to the adult who set a rule, owns a device, or should be asked — especially on **child-facing** screens (block reasons, wellbeing status, removal-protection copy). | Formal consent/authorization language, or the RBAC role name itself (use "Family Owner" / "Administrator" / "Viewer" instead, see below). | Android `safe_browser_safe_limited_mode_banner`: "غير متصل حاليًا بإعدادات والديك" (already live, PPR-2 PCA-FR-112). |
| **Guardian** | ولي الأمر | Formal/legal consent or authorization contexts — parental-consent flows, legal notices, anywhere "parent or legal guardian" is the accurate real-world referent. | Everyday casual copy where "parent" reads more naturally (over-formalizes a simple status line). | iOS `AntiRemovalClaimCopy.swift`: "A parent or guardian can always remove PCA..." (already live). |
| **Child device** | جهاز الطفل | The specific device enrolled/monitored for one child. | The parent's own phone/browser, or the account's full device fleet across multiple children (that's "family devices" / "family's devices" scope — see Family account). | `deviceEnrollment.familyDataUnavailableTitle` should read "…ملفات أطفالك…" not "…ملفات عائلتك…" (flagged as COPY-DEFECT in this audit). |
| **Parent device** | جهاز الوالد *(NATIVE_REVIEW_REQUIRED — proposed, no existing codebase citation found)* | The device a parent uses to administer the account (Parent Web / Platform Admin session, trusted browser). | The child's monitored device. | Trusted-browser pairing copy: "أقرِن هذا المتصفح من جهاز والد موثوق". |
| **Trusted browser** | المتصفح الموثوق | The specific browser-trust/pairing mechanism gating access to child data on a new browser. | General "this device" language unrelated to the browser-trust feature. | Owner-approved example: "أكمل إعداد هذا المتصفح" / "هذا المتصفح غير مفعّل بعد لعرض معلومات الأطفال." |
| **Family account** | الحساب العائلي / حساب العائلة | The billing/administrative entity that can contain multiple parents (roles), multiple children, and multiple devices — genuinely spans more than one child. | A screen or message that is actually only about one child's device or data. | `privacyHub.exportDesc` currently says "بيانات عائلتك" but the export only ever contains children's activity data — flagged as COPY-DEFECT; should read "بيانات أطفالك". |
| **Family member** | فرد العائلة / أفراد العائلة (plural, already live: `nav.familyMembers` → "أفراد العائلة") | The account-administration page/concept for inviting, removing, and assigning roles to other adults on the account. | A child ("family member" never means a monitored child in this product's data model). | Nav group heading "العائلة" bundling Children · Devices · Requests · Family Members · Roles & Permissions (already live, correct). |
| **Family owner** | المالك (short form, already live: `roles.owner` → "المالك") / مالك العائلة (explicit form, already live: `OWNER_ONLY_BILLING` → "...لمالك العائلة فقط...") | The specific RBAC role with full account control (billing, role changes, ownership transfer, recovery-material reveal). | Casual reference to "whoever manages the family" — use the precise role name so permissions text stays exact. | `roleExplanation.OWNER`: "تحكم كامل: يمكنه إدارة كل إعداد في العائلة..." (already live, correct). |
| **Protection** | الحماية | The overall feature area covering screen time, content filtering, device enrollment status, and safety. | — | Nav label "Protection" / "الحماية". |
| **Privacy** | الخصوصية | Data retention, export, deletion, and audit-trail features. | — | "Privacy Hub" / "مركز الخصوصية". |
| **Pairing** | الإقران | The technical act of connecting a child's device (or a new browser) to the account. | — | `deviceEnrollment.pairingPlain`: "يربط توصيلُ هذا الجهاز به بعائلتك" (kept — pairing genuinely joins the family-account trust set, not just one child's record). |
| **Invitation** | الدعوة | A pending offer to enroll a device or add a family member, before it's accepted. | — | "Pending Setup/Invitations" tab. |
| **Setup code** | رمز الإعداد | The short code shown during device enrollment to pair a child's device. | — | Owner-approved enrollment flow: "Copy Code". |
| **Setup link** | رابط الإعداد | The shareable link equivalent of the setup code. | — | Owner-approved enrollment flow: "Copy Link". |

## Notes for writers implementing the remaining gaps (see `PCA_CHILD_FOCUSED_COPY_GAP_REPORT.md`)

1. **"Family" is not a banned word.** 96 of the 134 rows in the audit CSV correctly keep it. The test is
   always: *what does this specific string actually describe — one child, or the multi-person account?*
2. **When the fix is family→parent, not family→child**, use `REWRITE_FOR_CLARITY` in the audit CSV, not
   `REPLACE_WITH_CHILD_TERM` — e.g. the `WebReasonCodes` block-reason strings ("blocked by your family's
   block list") are about a *parent-set rule*, not the child's own data, so the natural fix names the
   parent, matching the codebase's own `PARENT_ALLOWLIST`/`PARENT_DENYLIST` enum and the established
   "أحد الوالدين" convention — not a child term.
3. **Arabic possessive convention already established and should be reused**, not re-invented per string:
   "أطفالك" (your children, idafa possessive) for child-owned data/devices; "والديك" / "ولي أمرك" (your
   parent(s)) for parent-set rules; keep "عائلتك" only for genuine account-wide scope.
4. Every recommended rewrite in the audit CSV is a proposal, not an approved final string — Arabic rewrites
   in particular still need native review before shipping (`NATIVE_REVIEW_REQUIRED`).
