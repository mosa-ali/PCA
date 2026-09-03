# PCA PPR-2 — BROWSER UAT REPORT

**Method:** Claude Chrome extension driving a real Chromium tab against a real, isolated runtime stack.
**Date:** 2026-09-03
**Baseline:** working tree at `cc5ae10` + PPR-2 in-flight writer changes (see §6 caveat).

## 0. THE STACK THIS RAN AGAINST — AND THE PROOF IT WAS REAL

| Layer | Value |
|---|---|
| MySQL | disposable Docker container `pca-a17b-mysql` (8.0.46), created empty |
| Migrations | **33/33 applied from zero** (`information_schema` table count verified `0` beforehand) |
| Seed | `scripts/seed-local.mjs` — 20 families · 21 parent accounts · 25 platform admins · 8 invoices · 4 payment attempts · 1 refund · 1 dispute · 1 settlement batch |
| Backend | `http://localhost:4211` |
| Parent Web | `http://localhost:4212`, **real-backend mode** |
| Platform Admin | `http://localhost:4312`, **real-backend mode, same-origin proxy** |

**Demo mode was OFF, proven two independent ways** — this matters because a
`development preview — synthetic data` run would invalidate the entire report:

1. The module Vite actually served the browser reports
   `"VITE_PCA_DEMO_MODE": "false"`.
2. Unauthenticated `GET /privacy/permissions` **redirected to `/login`**. In demo mode
   `DevServiceAuthClient.getSession()` never returns null, so that gate is a no-op — its firing is
   positive proof fixtures were not in play.

**MFA was not weakened or bypassed.** Platform-admin sign-in used the real TOTP path, driven from a
deterministic LOCAL seeded secret through the same `computeTotp` module the auth service verifies
against.

All identities were **QA / LOCAL / DISPOSABLE**, seeded into a throwaway container. No production
credential was used, and none is recorded in a tracked file.

---

## 1. VERIFIED PASSES — real data, real session, real browser

| # | What was proven | Evidence observed in the browser |
|---|---|---|
| P1 | Parent login through the real CORS boundary | `set-cookie: pca_family_session=…; SameSite=Strict; HttpOnly` + `pca_family_csrf`; landed on `/dashboard` |
| P2 | Real seeded rows render in the UI | `/subscription/invoices` → **"Showing 2 of 2 invoices"**, `Open $29.99` + `Paid $29.99` — both ids match the seed manifest |
| P3 | Session gate is genuinely enforced | `/privacy/permissions` unauthenticated → `/login` |
| P4 | Arabic / RTL | Full correct mirror: sidebar right, text right-aligned, breadcrumbs reversed, controls mirrored, translations present throughout |
| P5 | Platform-admin real MFA login | Two roles signed in with live TOTP codes; no bypass, no stub |
| P6 | **RBAC negative control** | `SUPPORT_ADMIN` (billing DENIED) dashboard **renders clean, no crash**; billing sections **entirely absent**; sidebar BILLING shows only *Custom Quotes* |
| P7 | **RBAC positive control** | `FINANCE_ADMIN` (billing ALLOWED) sees `Open disputes 1`, `Invoices by status and currency: PAID (USD) 4 / OPEN (USD) 4`, `net $1,000.00 · received $975.00 · difference -$25.00`, settlement account `****4242 UNDER_INVESTIGATION` |

**P6 + P7 together are the load-bearing result of this UAT.** They verify, end to end in a real
browser against a real database, the two PPR-2 fixes that had to land together:

- the backend now **omits** billing fields for roles that `VIEW_BILLING_RECORDS` denies (key absent,
  not null — following the existing `/quotes/pending` precedent), and
- the console no longer reads them unguarded.

Before the client fix, this exact `SUPPORT_ADMIN` page threw
`TypeError: Cannot read properties of undefined (reading 'byKey')`.

The discriminator that proves the design is right rather than merely non-crashing: for
`FINANCE_ADMIN` the *Subscriptions by status* and *Quotes by status* **sections render with an empty
state**; for `SUPPORT_ADMIN` those sections **do not exist at all**.

---

## 2. DEFECTS FOUND IN THE BROWSER

| ID | Severity | Finding |
|---|---|---|
| **UAT-01** | **HIGH (trust)** | A **designed, expected fail-closed state is titled "Something went wrong."** On `/dashboard` and `/family/devices`, `BROWSER_NOT_TRUSTED` renders under that generic error headline. The body copy is honest and specific — *"This browser is not trusted with your family's data yet. Pair it from an already-trusted device, then try again."* — but the H1 tells a parent the product is broken. This is the same generic-headline failure already recorded when a misconfigured API base URL produced *"Something went wrong"* with no hint of the real cause. **The correct behaviour is right; only its presentation is wrong.** |
| **UAT-02** | MEDIUM | **Mixed-language date under Arabic.** The free-access banner renders `ينتهي بتاريخ October 3, 2026.` — an English month name inside an Arabic sentence. `PCA-FR-113` requires full localisation with no mixed-language fallback. The date is not passed through the locale formatter. |
| **UAT-03** | MEDIUM | **A field labelled "Email" renders an opaque UUID.** Platform-admin *Your session* card shows `Email: 70789017-1968-41a5-813f-f0aed914c290` (same for both roles tested); the header repeats it as *"Signed in as 70789017-…"*. This is probably correct-by-privacy — `PCA-ADD-IDENT-003` forbids storing a queryable plaintext email, so there may be no address to show — but then **the label is wrong**, not the value. Either way the surface is misleading. |
| **UAT-04** | MEDIUM | **Child-device enrollment is a dead end for a new family.** The *Child profile* dropdown reads **"No child profiles available"**, and the page offers no path to create one. A brand-new family therefore cannot create an invitation at all from this screen. |
| **UAT-05** | LOW | **Language selector is present but nearly invisible.** It *is* in the main header (top-right in LTR, top-left in RTL), but in EN it renders as a pale, very low-contrast control that reads as an empty box at a glance. It is not missing — it is unreadable. |

**Console:** the only errors observed were the four `EndpointNotTrustedError` entries backing UAT-01 —
i.e. the fail-closed path reporting itself. **Zero unexpected console errors, and zero failed network
calls, on the platform-admin console across both roles.**

---

## 3. OWNER UX FEEDBACK — CONFIRMED AGAINST THE RUNNING APP

Recorded only. **No visual work was started.** All six owner points are confirmed:

| Owner point | Status in the running app |
|---|---|
| Black/dark background not accepted | **CONFIRMED.** Both consoles are dark navy end to end; there is no light theme. |
| Dashboard needs a modern dynamic BI-style redesign | **CONFIRMED.** The admin dashboard is flat label/value tables — no chart, gauge, trend or visual hierarchy. The parent dashboard renders no content at all in this state (UAT-01). |
| Language selector should be in the main header | **Already there — but see UAT-05.** The real defect is contrast, not placement. |
| Child-device enrollment must become a guided link/code workflow | **CONFIRMED.** It is a raw form with five technical dropdowns (*Age UX tier*, *Initial policy profile*, *Protection mode* …) and no guided flow — and currently a dead end (UAT-04). |
| "Download App" belongs in the main header | **CONFIRMED ABSENT.** The header contains only a hamburger, the product title, and the language selector. |
| Enrollment/pairing/PIN/removal should not be one long technical page | **CONFIRMED, and worse than described.** `/family/devices` stacks **six** distinct workflows on one page: create invitation · invitations list · confirm device pairing (fingerprint matching) · administration-PIN setup · request a parent decision · pending/decided requests — plus a trailing error block. Copy is engineer-facing throughout (*"Pairing adds the device keys to the family trust set"*, *"a salted, deliberately slow verifier"*). |

---

## 4. WHAT WAS NOT EXERCISED, AND WHY — *not* "missing features"

41 of 74 tables are empty. **None is empty because the feature is unbuilt**; each lacks an actor:

- **Needs a real enrolled child device** (physical/emulated Android completing enrollment, pairing and
  Ed25519 device-key registration — unreachable from a web-only seed): `devices`,
  `device_public_keys`, `device_protection_status`, `licenses`, `protection_alerts`,
  `eye_protection_settings`, and the enrollment bookkeeping tables.
- **Needs real device E2EE sync traffic:** `relay_envelopes`, `recovery_envelopes`, and the four
  envelope ledgers.
- **Empty because the seed builds invoices directly** rather than through plan → subscription → quote:
  `billing_plans`, `billing_subscriptions`, `billing_quotes`.

This last point is why `Subscriptions by status` and `Quotes by status` render **"Nothing to show
yet"** for `FINANCE_ADMIN`. **That is "no data to exercise it", not a missing feature** — a probe
without the data-availability map would report it as a gap.

Every family-plane read is additionally gated behind an actor-device Bearer session, so the parent
console's child/policy/safe-zone/audit surfaces cannot be exercised without a real device. Those
surfaces are **NOT_EVIDENCED by this run**, not "broken".

**Not covered by this pass:** responsive/mobile breakpoints, and the parent-side authenticated
family-data surfaces (blocked by the above).

---

## 5. SECURITY POSTURE OBSERVED

- CORS is a real, strict allowlist: preflight from `http://localhost:4212` → `204` with the exact
  origin echoed; from `http://evil.example:4212` → **403**.
- Session cookies carry `SameSite=Strict`, `HttpOnly` on the session cookie, host-only scope, no
  `Domain=` attribute.
- Platform-admin session is bearer-only and in-memory; realm separation held throughout.
- The fail-closed family-data gate refused every read without a trusted device endpoint — including
  for a fully authenticated parent. **This is correct.**

---

## 6. CAVEAT ON THE BASELINE

The backend binary under test was compiled from the **current working tree**, which contains PPR-2's
in-flight writer changes (platform-admin auth, billing refund routes, the platform-admin route
modules, the invitation repository). This UAT therefore validates **that uncommitted state**, not
`cc5ae10`. That is deliberate — P6/P7 exist specifically to verify those changes — but the report
must not be read as evidence about the published commit.

---

## 7. LIVE SEEDED-STACK PARENT WEB SWEEP (post-UX implementation)

Run through the **Claude Chrome extension** against the real seeded stack on `http://localhost:4212`
(demo mode off, real MySQL, migrations from zero). Signed in as `owner-a@pca-seed.test`.

### Confirmed in the real browser, on real data

| # | Observed | Owner item |
|---|---|---|
| L1 | **Light theme is live.** Sign-in and every page render on a light surface with dark text. No dark remnant. | UX-1 |
| L2 | **Six KPIs, and every unavailable one renders `—`, never `0`**, each labelled *"We can't verify this right now"*. | UX-2 |
| L3 | **The fail-closed state is no longer an error.** The dashboard renders *"Finish setting up this browser"* with a **"Set up this browser"** action and *"Nothing was lost, and nothing was shown from an unverified source."* — replacing the previous *"Something went wrong"* headline. | UX-2 / UAT-01 |
| L4 | **`/family/devices` is six tabs:** Overview · Add device · Pending setup · Devices · Protection & removal · Advanced & security. One workflow at a time, replacing the six stacked on one page. | UX-6 |
| L5 | **The enrollment dead end is gone.** Add device now renders *"We can't read your family profiles on this browser yet"* plus the honest explanation and a next step — replacing the silent disabled *"No child profiles available"* dropdown. | UX-4 |
| L6 | **Header carries the language switch (EN / العربية), Notifications, and "Your account"** — the raw account UUID is no longer surfaced as identity text. | UX-3 / UX-9 |

### Not confirmed, and why

- **`Download App` is ABSENT from the header on this stack**, because no download URL is configured
  and the control was built to be *absent rather than broken* when unset. That satisfies "do not
  fabricate a store link" but **does not yet satisfy "must remain global and visible"**, and there is
  no surface distinguishing *Android: available / instructions* from *iOS: unavailable / coming
  later*. Recorded as **PARTIAL** with the exact remediation in the decisions ledger.
- **The Arabic switch did not take effect through the extension.** Two clicks on `العربية` left the UI
  in English while preserving the route. **This is not attributable to the product:** the control
  writes only to the local i18next cache and deliberately never touches the backend
  (`LanguageSwitch.tsx` header comment), and Playwright in real Chromium passes
  *"switching to Arabic flips document direction and renders Arabic UI text"* and *"switching language
  preserves the current route"*. The extension was demonstrably unstable in this session — screenshot
  timeouts, `document_idle` never firing, a page reload observed at click time. **Neither a pass nor a
  defect is claimed.**

### Console and network

The only errors are the two expected fail-closed reads (`EndpointNotTrustedError` on `getDashboard`
and `listDeviceStatuses`). **No JavaScript crash, no failed network call, no unexpected error.**

### Evidence status

```
CHROME_PARENT_UAT        = PARTIAL   (reached the real seeded stack; L1-L6 confirmed.
                                      Arabic switch and the responsive sweep were not
                                      completed - extension instability, not product state.)
PLAYWRIGHT_REAL_BROWSER  = PASS      (33/33 e2e in real Chromium: no horizontal overflow at
                                      320/375/laptop/desktop in BOTH ltr and rtl, header
                                      controls on-screen at 320px, every first-level sidebar
                                      row reaching a real page, target sizes, RTL sidebar on
                                      the logical end.)
```
