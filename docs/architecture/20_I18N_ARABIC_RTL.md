# 20 — Arabic/English Internationalization and RTL

## 1. Supported launch languages

- English (`en`) — LTR
- Arabic (`ar`) — RTL

Both are release-blocking quality targets.

## 2. Language selection

- follow system language by default;
- manual per-device override;
- parent and child devices may use different languages;
- language change takes effect without losing policy state.

## 3. RTL requirements

Arabic is not “translated LTR”. The following must mirror correctly:
- navigation/back direction;
- drawers/tabs;
- card alignment;
- lists/timelines;
- charts where semantic direction should mirror;
- icons with directional meaning;
- margins/padding;
- mixed Arabic/Latin/number text.

## 4. Translation keys

All user-facing strings use stable centralized keys. No hardcoded English/Arabic UI text outside localization resources except controlled content fixtures/tests.

## 5. Dhikr/prayer content

Arabic source text is stored as curated content with optional English meaning/translation. Religious text changes require content review; UI developers do not invent translations ad hoc.

## 6. Dates, time and numbers

- device locale controls presentation;
- canonical timestamps remain unambiguous internally;
- 12/24-hour preference follows locale/user setting;
- Arabic UI supports appropriate digits without breaking technical identifiers.

## 7. QA

Every release includes Arabic RTL screenshot/UI tests on parent and child critical flows.
