# PCA-16 Translation Review Notes

Doc 20 Section 2: "PCA does not have developers invent Arabic or religious translations at
runtime... Missing Arabic is a release defect." This file is the conspicuous, out-of-band
record that closes the gap between "an engineer wrote Arabic text" and "Arabic text has been
reviewed" — required before any of the strings below ship to production.

## Status: PENDING NATIVE / RELIGIOUS REVIEWER SIGN-OFF

All Arabic strings added in this PCA-16 pass were authored engineering-side (standard Modern
Standard Arabic, cross-checked against already-accepted Arabic text already present in this
codebase — see below) and are **structurally complete** (every English message ID has a non-empty
Arabic counterpart, enforced by both the TypeScript type system in `backend/src/i18n/` and a
runtime completeness test on both platforms), but **not yet linguistically/religiously reviewed
by a qualified native speaker or Islamic content reviewer**. Do not treat this pass as translation
completion for release purposes.

## Files touched

- `android/app/src/main/res/values-ar/strings.xml`
- `backend/src/i18n/messages/ar.ts`

## What was reused vs. newly authored

- **Reused, not re-authored**: the six prayer names (`prayer_name_*`) are copied verbatim from
  `android/app/src/main/java/org/pca/app/feature/prayer/model/PrayerName.kt`'s existing
  `arabicName` field (already in the codebase from the PCA-3/9 lane), not retranslated.
- **Newly authored, non-religious UI strings**: Break Shield screen title/labels/hints
  (`break_shield_*`, `ask_parent_*`, `emergency_*`), backend web-filter reason codes, and AI
  explanation labels. These are ordinary product UI text — lower review risk, but still pending
  sign-off per the blanket policy above.
- **Newly authored, religious-adjacent terminology**: `dhikr_button_label` ("الذكر"), the
  `dhikr_interaction_count` plural set, and their hints. "الذكر" (dhikr/remembrance) is the
  correct, standard Arabic term — not invented — but the six-way Arabic plural grammar
  (zero/one/two/few/many/other) for "تفاعل" (interaction) in this specific phrasing was
  constructed engineering-side and should receive the highest review priority of everything in
  this file.
- **No new religious phrase/prayer content was authored.** The Break Shield screen only ever
  displays a dhikr *interaction count*, never an actual dhikr phrase — so this pass did not need
  to (and did not) invent any Quranic, hadith, or tasbih text.

## Required before release

1. A qualified native Arabic speaker reviews every string in both files above for correctness,
   register, and tone (child-appropriate, non-alarming per doc 26 Section 1).
2. A reviewer with Islamic-content competence specifically confirms `dhikr_button_label`,
   `dhikr_button_hint`, and the `dhikr_interaction_count` plural forms.
3. The six Arabic CLDR plural categories for `dhikr_interaction_count`
   (`android/app/src/main/res/values-ar/strings.xml`) are grammar-checked against real usage
   counts (0, 1, 2, 3–10, 11–99, 100+) on a physical device or native-language reviewer, not just
   unit-tested for presence.
4. Physical-device visual QA in Arabic/RTL per doc 20 Section 7 (this pass's automated tests
   cover completeness/structure/bidi-safety, not visual layout, font legibility, or truncation
   with real text metrics).

## Addendum (PCA-FR-093, WRITER72): parent-web privacy pages

`parent-web/src/i18n/locales/ar.json`'s `retention`/`export`/`deleteNow` sections gained new
keys (`retention.currentDefault`, `retention.chooseWindow`, `retention.windowLabels.*`, updated
`retention.updatedStatus`/`deleteNow.issuedStatus`/`export.generatedStatus`/`export.description`)
when those pages were wired to the real backend retention/delete-now/export-request endpoints.
These are ordinary, non-religious product UI strings (retention-window duration labels and status
sentences), authored engineering-side per the same policy as the rest of this file, and carry the
same **PENDING NATIVE REVIEWER SIGN-OFF** status -- not yet linguistically reviewed, not to be
treated as translation completion for release.

## Addendum (PCA-FR-094, WRITER72): notification-preferences gap note

`parent-web/src/i18n/locales/ar.json`'s `notifications.preferencesNotYetConnected` (and its
English counterpart) is new UI copy explaining that the email/push preference toggles are
read-only pending real backend support (see ICR-PCA-FR-094-NOTIFICATION-PREFS). Same
engineering-authored, non-religious, **PENDING NATIVE REVIEWER SIGN-OFF** status as every other
entry in this file.

## What is NOT pending review

- String **completeness** (every key present in both locales) — enforced automatically, not a
  manual review item.
- **Bidi safety** (isolation of embedded LTR tokens, hostile bidi control character handling) —
  covered by automated tests (`BidiUtilsTest.kt`, `backend/test/i18n/BidiUtils.test.mjs`).
- **Locale-aware digit presentation** (Arabic-Indic vs. Latin digits for durations) — covered by
  automated tests (`BreakShieldFormatDurationTest.kt`).
