# 00 — Document Control and Governance

**Package version:** v1.0; **lifecycle state:** `DRAFT_RECONCILIATION` — architecture documentation is under reconciliation and evidence review; it is not accepted, implementation-ready, or implementation-authorized.

## 1. Purpose

This document defines how the PCA architecture package is governed, versioned, and kept internally consistent before and during implementation. It is the entry point that establishes authority order, freeze rules, and change-control discipline for the entire `docs/architecture/` package (documents 00–34).

## 2. Scope

Applies to every document in `docs/architecture/`, all requirement IDs (`PCA-FR-*`, `PCA-NFR-*`, and any topic-specific series introduced by owning documents such as `PCA-SEC-*`, `PCA-PRIV-*`, `PCA-AND-*`, `PCA-IOS-*`, `PCA-AI-*`, `PCA-I18N-*`, `PCA-DATA-*`, `PCA-TEST-*`), and to the package manifest (`MANIFEST.md`) and package README.

Out of scope: source code version control (governed by normal repository practice), individual sprint/ticket tracking (governed by the implementation programme, doc 30), and legal/contract documents outside `docs/architecture/`.

## 3. Package structure and ownership

The architecture package is split into 35 numbered documents (00–34) plus a manifest and README. Each document has a named owning agent/role responsible for its content and internal consistency. Cross-document consistency (ID collisions, contradictory claims, orphaned references) is the responsibility of whichever agent last edits a document that touches shared ground; conflicts must be flagged in this document's change log (Section 9) rather than silently resolved by one side.

| Doc # | Title | Primary subject |
|---|---|---|
| 00 | Document Control | Governance of the package itself |
| 01 | Product Vision & Scope | Vision, in/out of scope, product modes |
| 02 | Stakeholders/Personas/Roles | Family roles, PCA operator/support roles |
| 03 | Functional Requirements | PCA-FR-* requirement set |
| 04 | Non-Functional Requirements | PCA-NFR-* requirement set |
| 05 | System Context Architecture | End-to-end system diagram |
| 06 | Android Architecture | Android-specific design |
| 07 | iOS Architecture | iOS-specific design |
| 08 | Enrollment/Device Lifecycle | Pairing, binding, removal |
| 09 | Security/Privacy/E2EE | Cryptographic design |
| 10 | Data Model/Local Storage | Schemas as documentation |
| 11 | Data Retention/Deletion | Retention windows, deletion semantics |
| 12 | Screen Time/Break Engine | Continuous-use and break logic |
| 13 | Eye-Distance Protection | Proximity-based eye-rest feature |
| 14 | Web Content Filtering | Domain/category filtering |
| 15 | App Usage/YouTube Visibility | App usage tracking, YouTube modes |
| 16 | Location/Last Seen | Location and connectivity status |
| 17 | Prayer Times | Local prayer-time calculation |
| 18 | Parent Control Panel/RBAC | Dashboard and role-based access |
| 19 | Notifications/Email | Alerting channels |
| 20 | I18N/Arabic RTL | Localization |
| 21 | Tamper Protection/Recovery | Anti-uninstall, recovery flows |
| 22 | API/Protocol Contracts | Wire-level contracts |
| 23 | AI Architecture | On-device/edge classification |
| 24 | Threat Model/Abuse Cases | Adversarial analysis |
| 25 | Compliance/Store Policy | App-store and legal compliance |
| 26 | Accessibility/Child UX | Accessibility requirements |
| 27 | Observability/Support | Logging/telemetry boundaries |
| 28 | Test/QA/Security Validation | Verification strategy |
| 29 | Release/Deployment/Rollback | Release engineering |
| 30 | Implementation Programme | Delivery phasing |
| 31 | Risk/Decision Register | Cross-cutting risk log |
| 32 | Traceability/Acceptance Matrix | Requirement-to-test mapping |
| 33 | Reference Sources | External citations |
| 34 | Architecture Completion Gate | `A-100` acceptance criteria |

This document (00) is owned by agent **PCA-DOC-A** together with 01–04.

## 4. Authority order

1. Owner-approved product decisions (explicit sign-off by the product owner, recorded in Section 8 of doc 31 or in this document's decision log).
2. This architecture package (docs 00–34), internally ranked by document number when two documents appear to conflict — the more specific document (e.g. 12_SCREEN_TIME_BREAK_ENGINE) governs its own subject over a general document (e.g. 01_PRODUCT_VISION_SCOPE), but neither may contradict 00, 03, or 04 without a recorded change.
3. Official Android/Apple/store/API documentation (see doc 33 for the citation register).
4. Approved implementation specifications derived from this package.
5. Source code and tests.

If source code later conflicts with an approved requirement, the conflict must be resolved explicitly — either the code is corrected, or a change request is raised against the requirement following Section 7. Code never silently redefines the architecture.

## 5. Architecture-first freeze

Until the milestone **`A-100 DOCUMENTATION ACCEPTED`** is declared (see doc 34, Architecture Completion Gate), the following are prohibited:

- production Android/iOS project initialization (beyond throwaway feasibility spikes explicitly marked as such and deleted afterward);
- backend implementation;
- production schemas/migrations;
- provisioning of cloud resources;
- AI model binary integration;
- release pipelines;
- app-store submissions.

Permitted during freeze: documentation, diagrams, architecture decision records (ADRs), and read-only feasibility research (e.g. reading Apple/Android developer documentation, running non-persistent local experiments that are discarded and not merged).

**PCA-FR-000** The repository MUST NOT contain merged production application source (Kotlin/Swift/Compose/SwiftUI/Gradle/Xcode/Node service code implementing family-activity handling) before `A-100` is declared, except read-only feasibility spikes explicitly excluded from the freeze and deleted before merge.

### 5.1 Freeze status note (added by `PCA-DOC-REALIGN-1`, 2026-08-14)

`docs/architecture/34_ARCHITECTURE_COMPLETION_GATE.md` records `A_100 = OWNER_ACCEPTED`, and this repository now contains substantial production application/backend source (Android, backend, Parent Web, and iOS scaffolding — see `docs/architecture/30_IMPLEMENTATION_PROGRAMME.md` for the current per-phase status). This freeze section is therefore satisfied/lifted in the sense doc 34 describes: it was a pre-A-100 gate, and A-100 has been declared. This note does not alter this document's own `DRAFT_RECONCILIATION` lifecycle declaration in the header above, which concerns ongoing architecture-documentation reconciliation and is a separate question from implementation authorization; a full reconciliation of that apparent tension between this document's self-declared lifecycle state and doc 34's `OWNER_ACCEPTED` record is out of scope for this realignment pass and is flagged here rather than silently resolved, per this section's own change-control discipline (Section 9).

## 6. Versioning

- **Architecture major version**: breaking product/security/privacy decisions (e.g. changing the E2EE trust boundary, removing a privacy commitment, changing default retention).
- **Minor version**: additive requirements or clarified designs that do not break prior commitments (e.g. adding a new PCA-FR item, adding a diagram).
- **Patch version**: editorial or source-reference updates with no requirement change (e.g. fixing a typo, refreshing a citation URL).

Current package: **v1.0**, lifecycle `DRAFT_RECONCILIATION`. Reconciliation edits improve the v1.0 draft but do not assert package completion, owner acceptance, or implementation authorization. A version increment may be proposed only after the completion gate is evidenced and the owner approves it.

### 6.1 Version history

| Version | Date | Change | Docs affected |
|---|---|---|---|
| v1.0 | 2026-08-10 | Draft architecture package created and undergoing reconciliation; content depth varies by document and remains subject to source verification, traceability evidence, and owner review | All |

## 7. Change control after approval

Every material architecture change after `A-100` must include, recorded as an entry in this document's change log (Section 9) or in doc 31 (Risk/Decision Register) if it originates from an unresolved decision being closed:

- change identifier (e.g. `CHG-2026-08-10-01`);
- reason;
- affected requirement IDs;
- privacy/security impact;
- Android/iOS capability impact;
- migration impact if implementation already exists;
- owner approval state (`PROPOSED` / `APPROVED` / `REJECTED`).

## 8. Documentation quality rule

No `TBD`, unresolved placeholder, fabricated platform capability, or unsupported claim may be accepted as complete. External approval dependencies (for example, Apple entitlement approval for Family Controls / Screen Time API access) may remain external dependencies, but the architecture must define exactly what happens if approval is unavailable (fallback mode, degraded feature set, user-facing disclosure — see doc 01 Section 5 for product-mode fallbacks).

Any claim of platform capability must be labeled with one of:

- `VERIFIED` — confirmed against current official documentation, cited in doc 33.
- `VERIFIED_WITH_LIMITATION` — capability exists but with a materially narrower scope than a naive reading would suggest.
- `UNSUPPORTED` — platform does not provide this capability; the product must not claim it.
- `REQUIRES_ENTITLEMENT` — capability exists only behind a store/vendor-granted entitlement not automatically available to every developer.
- `REQUIRES_MANAGED_DEVICE` — capability requires device-owner/MDM-style provisioning, not available to a normal consumer install.
- `REQUIRES_USER_PERMISSION` — capability requires a runtime permission grant the user/parent/child can deny or revoke.
- `REQUIRES_FURTHER_OWNER_DECISION` — claim is currently unverified/uncertain pending a live documentation check (LOOP-2) or a product-owner decision; must not be asserted as fact until resolved.

## 8A. Implementation completion definitions (added by `PCA-DOC-REALIGN-1`, 2026-08-14)

Every status report anywhere in this package, in `docs/implementation/**`, and in any implementation addendum (e.g. `docs/implementation/addenda/PCA_ADDENDUM_002_PLATFORM_ADMINISTRATION_BILLING.md`) MUST use exactly three distinct completion tiers and MUST NOT collapse them into one ambiguous "100% complete" claim:

- **`SOURCE_COMPLETE`** — code exists in the repository implementing the requirement. This is a statement about presence, not correctness: source can be `SOURCE_COMPLETE` while still buggy, untested, or incomplete in edge cases.
- **`VALIDATED_COMPLETE`** — the implementation has been tested and verified against its acceptance criteria (doc 28's test layers, or an addendum's equivalent test plan) with recorded, reproducible evidence (traced per doc 32). A requirement can be `SOURCE_COMPLETE` without being `VALIDATED_COMPLETE`.
- **`PRODUCTION_READY`** — the requirement has cleared every applicable external gate (doc 31's preserved gates — `CRYPTO_SECURITY_REVIEW`, `ANDROID_REAL_DEVICE_UAT`, `IOS_MAC_XCODE`, `IOS_FAMILY_CONTROLS_ENTITLEMENT`, `IOS_PHYSICAL_DEVICE`, `YOUTUBE_MODE_B_POLICY_REVIEW`, `CLOUD_AI_OWNER_DECISION`, plus any addendum-specific gates such as Addendum 002's `PAYMENT_PROVIDER_SELECTION` family) and every applicable release criterion (doc 25 evidence pack, doc 28 release gates, doc 29 go/no-go), in addition to being `VALIDATED_COMPLETE`. A requirement can be `VALIDATED_COMPLETE` in a test/sandbox environment without being `PRODUCTION_READY`.

This three-tier framework replaces any prior practice of reporting a single, ambiguous "implementation complete" status. It does not retroactively change what any historical acceptance record (e.g. `A-100` in doc 34) meant at the time it was recorded — `A-100` was, and remains, a `CONTENT_STATE = VERIFIED_COMPLETE` acceptance of the **architecture documentation itself**, not a claim about any implementation tier defined here.

## 9. Change log for this document (00)

| Date | Change | Author (agent) |
|---|---|---|
| initial draft | Created 00_DOCUMENT_CONTROL.md skeleton | (pre-existing) |
| 2026-08-10 | Expanded to implementation-grade depth: added package structure/ownership table, capability-label rubric, version history table, this change log | PCA-DOC-A |
| 2026-08-10 | Added dated official-source handoffs for Apple Family Controls, Android DPC authority, and the YouTube watch-history-source discrepancy; assigned canonical-register reconciliation to doc 33's owner | PCA-DOC-A |
| 2026-08-10 | Corrected lifecycle/version wording: package remains v1.0 in `DRAFT_RECONCILIATION`; converted owned-document acceptance lists into explicit future-evidence gates | PCA-DOC-A |
| 2026-08-10 | Closed R1-001: retired the provisional generic YouTube sample-request handoff; delegated current watch-history accessibility determination exclusively to doc 33's canonical method-specific and revision-tracked sources | PCA-DOC-A |
| 2026-08-14 | Documentation realignment (`PCA-DOC-REALIGN-1`): added Section 5.1 freeze-status note (A-100 declared, substantial implementation source now exists) and Section 8A completion-definitions framework (`SOURCE_COMPLETE`/`VALIDATED_COMPLETE`/`PRODUCTION_READY`); no change to this document's own `DRAFT_RECONCILIATION` lifecycle field or to any historical acceptance date | PCA-DOC-REALIGN-1 |

## 10. Source freshness

Platform-dependent sources (Android/Apple/Google/YouTube developer documentation cited anywhere in the package, primarily registered in doc 33) are revalidated:

- before implementation of the relevant phase;
- before public beta;
- before store submission;
- after major Android/iOS policy changes (e.g. Play Store Families Policy updates, Apple Screen Time API changes).

**PCA-NFR-000** Every citation in doc 33 MUST carry a "last verified" date; a citation older than 180 days at the start of a new implementation phase MUST be revalidated before that phase begins.

### 10.1 Source-register handoff (owned by document 33)

This document does not edit the canonical source register. The following verified-source handoff items are supplied to the owner of doc 33 so the register can record the URL, verification date, claim status, and architectural consequence without another author silently changing the register.

| Handoff ID | Official source and verification date | Claim status | Architecture consequence for this package |
|---|---|---|---|
| `SRC-H-A-001` | Apple, [Family Controls overview](https://developer.apple.com/documentation/familycontrols?language=swift), verified 2026-08-10 | `REQUIRES_ENTITLEMENT`; `VERIFIED_WITH_LIMITATION` | A parent/guardian-approved child authorization prevents the child from deleting the authorized parental-controls app through ordinary means. It is not a universal anti-removal claim; iOS wording and recovery must remain scoped to the authorization state. |
| `SRC-H-A-002` | Android, [DevicePolicyManager API](https://developer.android.com/reference/android/app/admin/DevicePolicyManager), verified 2026-08-10 | `REQUIRES_MANAGED_DEVICE` | `setUninstallBlocked` and package suspension are device/profile-owner powers. They cannot underpin an Android Standard Mode promise. |
| `SRC-H-A-003` | Retired provisional handoff: Google, [YouTube Data API sample requests](https://developers.google.com/youtube/v3/sample_requests), reviewed 2026-08-10 | `RETIRED_RESOLVED` (R1-001) | This generic sample is not a canonical determination of current watch-history accessibility and MUST NOT supersede or amend doc 33. It is retained only as an audit record of the earlier reconciliation question. |

Current YouTube watch-history accessibility, scope, and restrictions are determined only by doc 33's canonical, method-specific documentation and revision-history sources. Product and architecture claims MUST defer to that register; `SRC-H-A-003` supplies no active source instruction.

## 11. Dependencies

- Doc 34 (Architecture Completion Gate) depends on this document's freeze/versioning rules being satisfied for every other document.
- Doc 31 (Risk/Decision Register) is the canonical location for open owner decisions that originate in any document; documents 00–04 reference it rather than duplicating a separate decision log, except where a decision is local to a single document's numbering (see each document's own "Unresolved owner decisions" table).

## 12. Future acceptance evidence for this document

All items below are future evidence gates. Their unchecked state is intentional in `DRAFT_RECONCILIATION`; no checkbox is evidence of completion until independently reviewed and recorded in docs 32 and 34.

- [ ] Every other document in the package declares an owning agent/role, either in its own header or in the table in Section 3.
- [ ] No document in the package contains an unlabeled platform-capability claim.
- [ ] The version number in Section 6 matches the version declared in `MANIFEST.md` and `README.md`.
- [ ] Every unresolved decision referenced from another document resolves to an entry in doc 31 or to a local "Unresolved owner decisions" table.
