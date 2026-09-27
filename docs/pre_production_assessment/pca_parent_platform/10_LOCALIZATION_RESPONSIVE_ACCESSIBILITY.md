# 10 — Localization, Responsive and Accessibility (targeted)

## 1. Parent Arabic / RTL (mission §31) [READ + RUN]

- Key parity: `en.json` vs `ar.json` — **1527 keys each, 0 missing, 0 extra** [RUN, exact key-set
  comparison]. Repo also enforces this in CI-class tests (`tests/i18n/arabicParentWebLanguage.test.ts`:
  exact equality; no Latin characters in AR values beyond an explicit allow-list), plus editorial
  gates (banned family-lexicon words, EN and AR).
- RTL wiring: `i18n/index.ts:73-74` sets `document.documentElement.dir` + `lang` on language
  change; `Tabs.tsx:41` reads the attribute for RTL-aware behavior [READ].
- Live shell serves `<html lang="en" dir="ltr">` default with an EN/AR switcher on the auth pages
  and shell (`LanguageSwitch` in `components/shell/`, mounted for auth via `AuthLayout`) [LIVE
  snapshot + READ].
- Auth forms / errors / validation: all copy comes from locale keys; server codes map to
  translated messages (report 06 §1); RTL covered by the language switch on the same pages.
- Dedicated browser specs: `e2e/rtl.spec.ts`, `e2e/contrast.spec.ts`, `e2e/forced-colors.spec.ts`
  (CI-certified set).
- Native-language review: `docs/i18n_arabic_review_notes.md` exists (review notes, not a signoff);
  per mission, native signoff is **EXTERNAL** — unchanged from prior assessments.

```text
PARENT_SOURCE_I18N = PASS
PARENT_NATIVE_REVIEW = EXTERNAL (unchanged; notes doc exists)
```

## 2. Platform localization (mission §32)

- Key parity: **630/630, 0 missing, 0 extra** [RUN].
- RTL wiring: `i18n/index.ts:33-34` (same pattern as parent).
- Auth/MFA messaging: all via keys (`activation.*`, login copy); admin errors mapped to keys;
  `arabicShell.spec.ts` covers the shell in AR (spec present, CI suite).
- No mixed-language UI found in reviewed pages (enum labels centralized in `i18n/enumLabels.ts`).

```text
PLATFORM_LOCALIZATION = PASS
```

## 3. Responsive behavior (mission §33) [evidence-based]

- Parent: dedicated specs `e2e/responsive.spec.ts` (multi-width assertions), `e2e/overflow.ts`
  (document-overflow probes incl. the shell-baseline discipline), forced-colors and contrast gates.
  Mobile drawer keyboard contract implemented (AppLayout focus management, Escape/close/return
  focus) [READ + specs].
- Platform: admin console is desktop-first; the shell specs assert layout integrity at supported
  viewports; no claim of full mobile support (matches product requirements for an operator console).
- Distinction kept: this is parent *responsive web*, not the PCA native mobile app (out of scope).

```text
PARENT_RESPONSIVE = PASS (CI-certified specs; not re-executed in this read-only pass)
```

## 4. Accessibility — targeted (mission §34)

Checked high-risk/pre-production items only:

| Item | Parent | Platform | Evidence |
|---|---|---|---|
| Keyboard navigation / skip link | skip-to-content link is the first focusable element; drawer focus trap + Escape + focus return | same pattern (sidebar/header) | `AppLayout.tsx:80-110` + keyboard spec |
| Form labels | explicit labels (login/register/reset); errors associated as `role="alert"` next to fields | labels + error association on login/MFA | live snapshots + source |
| Modal focus | `useModalFocusTrap` used for step-up dialogs; focus moves to input or Cancel depending on state | `useModalFocusTrap` present (shared pattern) | source |
| Contrast | CI `contrast.spec.ts` + contrast audit table | CI `contrast.spec.ts` + `contrastAudit.ts` | specs |
| ARIA misuse | no obvious role abuse in reviewed surfaces; tabs semantics in DevicesTabs use real tab roles | `AccountsList` etc. use semantic tables/tabs (lane commits reference accessible tabs) | source |
| RTL a11y | dir attribute switch + RTL specs | dir switch + arabicShell | specs |
| Login/MFA usability | auto-focus email; disabled submit states; MFA code format guidance | disabled-until-valid; explicit MFA copy; "cannot be skipped" statement | live snapshots |

No serious accessibility blockers identified beyond existing CI gates. Deeper campaign out of scope
per mission §34.

## 5. Live rendering notes [LIVE]

Both login pages rendered correctly with language controls; no layout defects observed at the
default desktop viewport; console clean apart from the meta-CSP warning (PP-F04).
