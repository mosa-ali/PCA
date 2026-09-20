# PCA Public Content Accuracy Audit — 2026-09-21

Scope: `public-web/` only. Parent Web, backend, database, migrations and
cryptographic verification were not changed.

## Product capability matrix

| Capability | Status | Evidence / boundary |
|---|---|---|
| Parent registration | LIVE | Owner-verified production evidence for `https://parent.pcasafe.com/register/`. |
| Parent email verification | LIVE | Owner-verified production evidence. |
| Parent login | LIVE | Owner-verified production evidence for `https://parent.pcasafe.com/login/`. |
| Parent Console access | LIVE_WITH_LIMITATIONS | Owner verified access; family genesis, membership/role resolution, some authenticated pages and device/trust flows remain known P0 limitations. |
| Parent account settings | UNKNOWN_REQUIRES_OWNER_CONFIRMATION | No separate owner production acceptance supplied. |
| Parent children | UNKNOWN_REQUIRES_OWNER_CONFIRMATION | Repository implementation is not production acceptance. |
| Parent device management | LIVE_WITH_LIMITATIONS | Parent Console is reachable, but device/trust flows remain limited by known P0 defects. |
| Parent protection management | LIVE_WITH_LIMITATIONS | Available settings may be accessed online; complete device protection is not claimed. |
| Trusted browser/device | UNKNOWN_REQUIRES_OWNER_CONFIRMATION | Known device/trust limitations prevent a stronger public status. |
| Subscription/billing | UNKNOWN_REQUIRES_OWNER_CONFIRMATION | No current production acceptance supplied. |
| Downloadable Parent native app | NOT_RELEASED | Current delivery is browser-based; no native artifact or store evidence. |
| PCA Child Android | NOT_RELEASED | Release register remains `COMING_LATER`; no public store/download artifact. |
| PCA Child iPhone/iPad | NOT_RELEASED | Release register remains `COMING_LATER`; no public store/download artifact. |
| Public sign-in page | LIVE | `/sign-in/` and `/ar/sign-in/` are emitted source routes. |
| Parent login public destination | LIVE | Central handoff source emits the owner-verified Parent login URL. |
| Parent registration public destination | LIVE | Central handoff source emits the owner-verified Parent register URL. |
| Platform Admin public customer navigation | NOT_RELEASED / NOT_PRESENT | No Platform Admin link is emitted by the public navigation. |

## Public route inventory

The route table emits 9 routes in each locale, 18 pages total:

`/`, `/how-it-works/`, `/privacy/`, `/download/`, `/contact/`,
`/accessibility/`, `/privacy-policy/`, `/terms/`, `/sign-in/` and the matching
`/ar/` routes. Legal routes remain `noindex, nofollow`.

## Stale-content report

The live browser tab and checked-out public-web source both contained the old
release-state wording before this correction. Each row below represents one
semantic statement in both EN and AR unless noted otherwise.

| File | Key / component | Old text / status | New text / current status | Evidence |
|---|---|---|---|---|
| `src/content/global.{en,ar}.mjs` | `release.journeyNotice` | Parent accounts, email verification and PCA Child were described as unavailable or later. | Parent account creation and sign-in are available online; some child-device features remain in completion before Child release. | Owner-verified Parent registration, verification and login; Child claims remain `COMING_LATER`. |
| `src/content/pages/download.{en,ar}.mjs` | `download.platforms.items[0]` | Parent account access was “not open yet.” | Parent is `AVAILABLE ONLINE` with real login and registration CTAs. | Owner-verified Parent URLs and `src/config/handoffs.mjs`. |
| `src/content/pages/download.{en,ar}.mjs` | `download.child.lead` | “There is nothing to download yet” implied that PCA as a whole was unavailable. | Parent Web is available online; Child mobile apps remain unreleased and have no fake links. | Current browser delivery plus Child release register. |
| `src/content/pages/download.{en,ar}.mjs` | `download.hero.body` | Page said apps “will be available” and only described what could not be obtained. | Browser Parent access is available today; Child apps appear only after release. | Current product delivery split. |
| `src/content/global.{en,ar}.mjs` | `release.contactNotice` | Contact channels would be published before PCA opened to families. | Parent is online; contact channels themselves are still not open. | Parent online evidence; no contact-channel acceptance supplied. |
| `src/content/global.{en,ar}.mjs` | `release.reportingPending` | Reporting channels were gated on PCA opening to families. | Reporting channels remain unopened and will be published when available. | No reporting-channel acceptance supplied. |
| `src/content/pages/contact.{en,ar}.mjs` | SEO title/description | Contact page said channels were opening before launch. | Contact page describes support and safety topics while channels remain unopened. | Same contact-channel boundary. |
| `src/content/pages/accessibility.{en,ar}.mjs` | `accessibility.barrier.body` | Reporting channels would appear before PCA opened to families. | Reporting channels will be published when available. | Same contact-channel boundary. |

`STALE_STATUS_STATEMENTS_FOUND = 16 locale occurrences across 8 paired
statements`; `STALE_STATUS_STATEMENTS_FIXED = 16`.

The remaining `Coming later` labels are correct: unreleased Child platforms,
the optional Parent install mode, planned AI/YouTube functionality, camera
eye-distance protection, and unrecorded public videos. No outdated
`Coming later` label was removed.

## Validation evidence

- Public build/check: PASS; EN/AR content keys `204/204`; 18 pages emitted;
  zero duplicate-content findings; zero unapproved Arabic-Latin findings;
  all 30 contrast pairs pass.
- Public tests: PASS, 17/17.
- Adversarial pass: PASS; 0 critical findings and 0 high findings.
- Real Chromium UAT: PASS, 72/72 route × viewport checks at 375, 390, 430
  and 1280px, including Arabic RTL, links, touch targets, images and console
  errors.
- Artifact reproducibility: PASS; two consecutive builds matched at
  `986664926998ee5be6ac5d17c36c75ff76eeee0c4e246184f5a6a6c0f1957ca4`.
- Arabic native owner sign-off: PENDING; the existing OD-12 gate remains
  separate from automated Arabic parity and RTL UAT.
- Live public deployment after this source correction: NOT VERIFIED; the
  current live tab was inspected before the source change and deployment was
  not executed in this audit.

## Boundaries and next owner action

`PARENT_WEB_CHANGED = NO`; `BACKEND_CHANGED = NO`; `DATABASE_CHANGED = NO`;
`MIGRATION_0043_EXECUTED = NO`; `CRYPTO_VERIFIER_CHANGED = NO`.

The next owner action is to review/approve the public copy and Arabic native
sign-off, then authorize the existing public-web deployment path separately.
No new Azure resource is required by this source change.
