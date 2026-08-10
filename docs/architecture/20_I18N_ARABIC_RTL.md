# 20 — Arabic/English Internationalization and RTL

## 1. Release requirement and language model

English (`en`, LTR) and Arabic (`ar`, RTL) are equal launch-quality languages, not a translated afterthought. This document designs `PCA-FR-110`–`PCA-FR-113`. Parent and child devices select language independently: a parent may use English while a child uses Arabic, with no policy/data migration and no inference of the other person’s preference.

**PCA-FR-110.** Provide full English LTR.
**PCA-FR-111.** Provide full Arabic RTL.
**PCA-FR-112.** Permit parent and child devices to use different languages simultaneously.
**PCA-FR-113.** Localise all system-generated notices, reports, parental-control explanations, and deletion confirmations.

## 2. Content architecture

All user-visible text uses stable semantic message IDs with typed placeholders, translation context, plural/select rules, maximum/expansion guidance, and translator notes. No concatenated translated fragments; grammar is assembled as a complete localised message. IDs and machine fields remain ASCII/locale-neutral internally; labels localise at the presentation boundary. Fallback is English only with a conspicuous localisation-quality defect record; missing Arabic must not silently ship.

Religious content is curated/versioned: Arabic source, reviewed transliteration if offered, and labelled English meaning. PCA does not have developers invent Arabic or religious translations at runtime. User-entered names, domains, URLs, codes, emails, device IDs, and numbers remain data, are escaped, and are directionally isolated when embedded in text.

## 3. True RTL and bidi contract

Set base direction on every Arabic screen/container, use logical start/end layout properties, and let the platform’s Unicode bidi engine resolve normal text. Mirror structure—not meaning blindly. Directional elements mirror: navigation drawer origin, back/forward affordances, chevrons used for navigation, tab progression, list disclosure, progress direction where completion semantics warrant it, timelines, page/caret alignment, swipe affordance, and start/end margins. Do not mirror universally recognised/non-directional icons (play, pause, phone keypad, map compass, brand marks) or an icon whose semantic direction would become false.

For mixed content, use bidi isolates/appropriate platform equivalent around every LTR identifier, URL, email, code, version, time-zone ID, number range, and technical error token in an Arabic sentence; never use bidirectional overrides. Preserve logical storage order and copy/paste values. Test examples such as `تم حظر example.com في 2026-08-10، الساعة 18:30 (UTC+03:00)` and Arabic/Latin child names. Unicode UAX #9 governs rendering; explicit isolate controls are only a last-mile rendering mechanism, not stored business data.

## 4. Dates, time, numbers, charts, and reports

Store UTC instants, durations, monetary/technical quantities, and canonical IDs independent of locale. Present date/calendar, 12/24-hour time, week start, timezone, number grouping, decimal separator, and Arabic-Indic versus Latin digits using the device locale/preference where supported. A number-shape preference must not change parsed values, policy calculations, expiry, retention, cryptographic IDs, or audit ordering. Prayer views identify local civil date/timezone and calculation method; reports preserve unambiguous export fields while localising readable headings.

Charts must localise axis labels, legends, tooltip placement, truncated-value accessibility text, number/date formats, reading order, and colour-independent encodings. A time series remains chronological left-to-right unless a tested product design deliberately reverses the temporal axis with equally clear labels; layout RTL alone must not make time appear to run backwards. Timelines order events by time, label UTC-derived local time, and use start/end logical placement. Maps preserve geographic convention and explicitly label direction rather than mirroring geography.

## 5. Critical surface inventory

The following all require English and Arabic visual, spoken, and functional acceptance:

| Surface | Required behaviour |
|---|---|
| Enrollment, permissions, errors, recovery | Localised rationale/error/action; OS text is acknowledged as OS-controlled; technical codes isolated. |
| Parent dashboard, activity, location, reports | RTL cards/lists/charts/timelines; stale/offline, accuracy, retention, and export warnings unambiguous. |
| Child transparency, break screen, Dhikr, prayer | Child’s language only; Arabic prayer names/Dhikr reviewed; accessible counter/action labels; emergency wording never hidden. |
| Notifications and email | Rendered in recipient device/account locale with generic privacy-preserving payloads; no parent detail in a child notification. |
| Controls/icons/gestures | Logical start/end alignment and semantic directional icon selection; touch target and focus order match visual order. |

## 6. Accessibility

Use the platform accessibility tree in reading order for the selected direction, not visual-position order. Each control has a localised accessible name, state, value, hint, and error; icon-only controls have text alternatives. Screen readers must announce dates, Arabic/Latin numbers, chart summaries, progress, policy state, and `stale/offline` distinctly. Respect dynamic type/font scaling, Arabic font legibility, contrast, reduced motion, keyboard/switch navigation, and focus traversal. Do not encode status only by colour or direction.

## 7. Quality gate

- Pseudo-localisation catches truncation/hard-coded strings; Arabic and English snapshot plus manual physical-device tests cover every critical surface in Section 5.
- Bidi tests cover Arabic with URLs, emails, codes, numerals, dates, ranges, brackets, LTR names, copy/paste, search, and error messages; test hostile bidi control characters as input and neutralise them for display/logging.
- Assistive-technology tests check order, labels, values, RTL focus traversal, dynamic text, and chart/table alternative summaries.
- Translation review tests ensure policy meaning, consent, emergency access, retention/deletion, and recovery warnings do not change between languages.

## 8. Official-source handoff for doc 33 (verified 2026-08-10)

| Proposed source ID | Official source | Claim/capability label | Affected requirements |
|---|---|---|---|
| SRC-E-I18N-001 | [Unicode UAX #9: Bidirectional Algorithm](https://www.unicode.org/reports/tr9/) | Unicode specifies bidi display and encourages isolates over embeddings/overrides for modern use. | PCA-FR-110–113 |
