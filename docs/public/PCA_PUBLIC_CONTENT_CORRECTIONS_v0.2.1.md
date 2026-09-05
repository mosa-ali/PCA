# PCA Public Content Corrections — v0.2.1

**Status:** Owner-authorised correction addendum to `PCA_Public_Programme_Documentation_Package_v0.2`
**Authority:** Owner ruling, 2026-09-05, section 12 — *"Internal implementation directives must not be public copy … Update the source public content documents if necessary so code and docs remain aligned."*
**Supersedes:** the specific strings listed below, and nothing else
**Applies to:** `PCA_PUBLIC_CONTENT_EN.md` and `PCA_PUBLIC_CONTENT_AR.md` v0.2

---

## Why this is an addendum rather than an edit

The v0.2 package ships `SHA256SUMS.txt`, and all 13 files verified OK at load (see `reports/PUBLIC_DOCS_LOADED_REPORT.md`). Editing the content documents in place would invalidate that manifest and destroy the integrity evidence for the accepted baseline.

So v0.2 stays byte-intact and checksum-verifiable as the accepted baseline, and this document carries the corrections. `public-web` implements the corrected strings; the mapping below is what keeps code and docs aligned and auditable.

If the owner later reissues a full v0.3 package, these corrections should be folded into it and this addendum retired.

---

## The defect (DEF-1)

Several sections of the approved v0.2 content documents supply **instructions to the implementer** as the section body copy — sentences addressed to whoever builds the site, not to a parent reading it. Transcribed faithfully, as PUBLIC-3 did, they render as public marketing text.

This was found by reading the built `/features` page in a real browser. The transcription was correct; the source was wrong.

Verified against `PCA_PUBLIC_CONTENT_EN.md` lines 269-302.

---

## Corrections

### C-1 · AI

| | |
|---|---|
| Location | `PCA_PUBLIC_CONTENT_EN.md` §4, "AI" |
| Superseded | "Production AI must not be advertised until formally activated, security/privacy reviewed and included in the claim register as verified." |
| Replacement (EN) | **"AI-supported features are planned for a later release."** |
| Replacement (AR) | Natural Arabic equivalent — not a literal rendering of the English sentence structure |
| Claim | **CLM-057** (new, `COMING_LATER`) |
| Rationale | The superseded sentence is an instruction to the implementer and exposes internal review workflow. The replacement is the owner-approved status language and asserts nothing about AI being active — CLM-038 ("PCA has production AI protection enabled") remains `NOT_APPROVED_FOR_PUBLIC_CLAIM` and is in the forbidden-claim scan. |

### C-2 · Camera / Proximity

| | |
|---|---|
| Location | `PCA_PUBLIC_CONTENT_EN.md` §4, "Camera/Proximity" |
| Superseded | "Potential eye-distance/proximity protection is not an active public feature until runtime evidence confirms on-device ephemeral processing with no retained/uploaded frames." |
| Replacement (EN) | A short parent-facing sentence stating the feature is planned for a later release, and that if it ships, frames would be processed on the device. |
| Claim | **CLM-037** (`COMING_LATER`) |
| Rationale | "…is not an active public feature until runtime evidence confirms…" describes the programme's own gating process. A parent needs the status, not the gate. The strong on-device/no-upload wording in `PCA_PUBLIC_PRIVACY_MESSAGING.md` §18 stays gated until runtime proof. |

### C-3 · Location

| | |
|---|---|
| Location | `PCA_PUBLIC_CONTENT_EN.md` §4, "Location" |
| Superseded | "Availability remains evidence-gated." (trailing sentence only) |
| Replacement | Drop the sentence. The registered status label (**CLM-036**, `REQUIRES_PLATFORM_SUPPORT`) already communicates availability to the reader, visibly and in both languages. |
| Rationale | "Evidence-gated" is internal vocabulary. The preceding sentences of the approved Location copy are parent-facing and are retained unchanged. |

### C-4 · iOS Child

| | |
|---|---|
| Location | `PCA_PUBLIC_CONTENT_EN.md` §4, "iOS Child" |
| Superseded | "**Coming Later.** Do not show App Store badges or download links before real publication." |
| Replacement (EN) | **"iPhone and iPad child protection is planned for a later release."** |
| Claim | **CLM-026** (`COMING_LATER`) |
| Rationale | The "Do not show…" half is a build instruction. It is honoured structurally — the build's forbidden-claim scan fails on `App Store`, `apps.apple.com` and any store badge, and the real-browser UAT re-checks the rendered text — so it does not need to be printed to be enforced. |

### C-5 · Screen Time

| | |
|---|---|
| Location | `PCA_PUBLIC_CONTENT_EN.md` §1 (Homepage, "How PCA helps") |
| Superseded | "**Availability must be verified by platform before publication.**" (trailing sentence only) |
| Replacement | Drop the sentence. **CLM-028** (`REQUIRES_PLATFORM_SUPPORT`) renders a visible status label on the card. |
| Rationale | Same class as C-3: a verification instruction, already honoured by the claim gate. |

### C-6 · Advanced YouTube protection

| | |
|---|---|
| Location | Not present as a section in v0.2; arises wherever YouTube capability is described |
| Approved wording (EN) | **"Advanced YouTube protection is planned for a later release."** |
| Claim | **CLM-058** (new, `COMING_LATER`) |
| Rationale | Registers the owner-approved status language ahead of need. CLM-039 ("PCA advanced YouTube Mode B is production-ready") remains `NOT_APPROVED_FOR_PUBLIC_CLAIM`, and the string `Mode B` remains in the forbidden-claim scan. |

---

## New claim-register rows required

These are **proposed** and require owner approval in `PCA_PUBLIC_CLAIM_REGISTER.csv`. They are mirrored in `public-web/src/content/claims.mjs`, which the build enforces.

| ID | Claim | Type | Status | Risk | Evidence required |
|---|---|---|---|---|---|
| CLM-057 | AI-supported features are planned for a later release. | FEATURE | `COMING_LATER` | MEDIUM | Owner product direction. Asserts no capability. |
| CLM-058 | Advanced YouTube protection is planned for a later release. | FEATURE | `COMING_LATER` | MEDIUM | Owner product direction. Asserts no capability. |
| CLM-059 | Public introduction and enrollment videos. | AVAILABILITY | `COMING_LATER` | LOW | Scripts, storyboards and transcripts exist; recordings do not. Flip only when files and caption files ship. |

Two further proposals from earlier phases remain open: **CLM-054** (accessibility conformance, `NOT_APPROVED` per owner ruling) and **CLM-055** (no analytics/trackers, `REQUIRES_PLATFORM_SUPPORT`).

### CLM-056 — proposed, not used

| ID | Claim | Type | Status | Evidence |
|---|---|---|---|---|
| CLM-056 | Basic child-device enrollment does not require a paid license. | COMMERCIAL | `LIMITED` | PPR-2 Part M (published, `pca-dev` 74e5ad5) + its M3 verification |

PPR-2 Part M rules that `CREATE_INVITATION.requiresLicense = false`, proven end to end against real MySQL on a genuinely fresh family. It also scopes itself explicitly: *"this is not a statement that every future PCA feature is free, only that the BASIC V1 protection tier must let a parent enroll a child device before any paid/premium entitlement exists."*

So Part M supports CLM-056 and **does not** support CLM-041 (permanent free plan) or CLM-042 (pricing finalized), both of which remain `NOT_APPROVED_FOR_PUBLIC_CLAIM` on the evidence.

`LIMITED` rather than `VERIFIED_AVAILABLE` because no parent can reach the behaviour yet: Release B is blocked with no transactional email provider, so account creation does not complete. **CLM-056 is not rendered anywhere in Release A**, and per the owner ruling it may be used in video or page copy only once the register approves exact wording.

---

## What did *not* change

The privacy doctrine, the nine locked invariants, CLM-053, the prohibited-phrase list and every `EXTERNAL_SECURITY_REVIEW` gate are untouched. This addendum removes implementer directives from parent-facing copy; it does not weaken, strengthen or re-scope a single product or privacy claim.

```
DEF_1 = RESOLVED
V0_2_PACKAGE_INTEGRITY = INTACT (13/13 SHA256 OK, unmodified)
NEW_CLAIMS_PROPOSED = CLM-056, CLM-057, CLM-058, CLM-059
CLAIM_STATUS_CHANGES = 0 (no existing claim promoted or demoted by this addendum)
```
