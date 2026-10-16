# PCA Achievements and Pending Work - 2026-10-15

| Area | Achieved in Wave 01 | Still pending | Evidence / next acceptance |
|---|---|---|---|
| Git checkpoint | Source SHA `7338331f` published; local/origin/server matched 0/0 | Exact CI for the one-time ledger commit | Quality Gates run `38660927037` passed 27/27 on source SHA |
| Previous local work | All 23 previously ahead commits are in published history; dirty paths classified and preserved | Local-only preservation branch remains as an archival copy | Branch `codex/wave01-primary-preservation-20261015`; recovery files under task temp |
| Android transport | HTTPS/origin and redirect safety; first-device endpoint handling; reachability test synchronized to production helper | Physical-device evidence | Exact CI lint, unit, debug and release tasks passed; release artifact unsigned |
| iOS transport and root authority | HTTPS/session checks; committed-root mismatch stays fail-closed; test checks no mirror write, orphan cleanup, or direct key deletion | Physical-device evidence | XCTest 760 executed, 7 environment skips, 0 failures; Swift parse and release validator passed |
| Backend and Trust Set | Actor/lifecycle authority checks; bounded request handling and duplicate top-level JSON rejection | Approved production signer/root and recipient policy receipt | Backend build and 3504/3504 unit tests; focused suites 92/92; CI contract/security jobs passed |
| Disposable MySQL | Full DB, first-owner, and auth/migration certification | No live/retained DB work in this wave | Disposable MySQL 8.4.11 CI jobs passed and cleaned their containers |
| Policy delivery | Existing fail-closed boundaries preserved and reviewed | Encrypted Web Rules delivery, policy application receipt, server-authoritative ACTIVE | Requires approved contracts and receiver acceptance tests |
| TODO-12/14/15 | Source checkpoint certified | All three remain IN_PROGRESS; TODO-14 aggregate unproven | Continue only under approved authority and crypto contracts |
| TODO-18 | None | Owner Parent localhost acceptance | Owner-run acceptance record |
| TODO-19 | Source publication and exact-head CI at `7338331f` passed | Final documentation-head exact CI is the Wave 01 exit gate | Run `38660927037` passed 27/27 on source SHA |
| TODO-20 | Existing recorded PASS retained; no database mutation | Live DB evidence remains separate | Existing board evidence through migration 0065 |
| TODO-21/22/23 | No release or production action | Azure, production acceptance, and mission closure remain TODO | Owner authorization and real-environment evidence |
| Platform | No Platform source or activation changes | `HOLD_PARENT_DEPENDENCY` remains | Parent projection and policy dependency acceptance |

## Wave 02B checkpoint — 2026-10-16

| Area | Completed evidence | Pending / boundary |
|---|---|---|
| Migration 0066 | Additive schema and generated canonical/bootstrap artifacts; 64 migrations and 7/7 proof DB tests on owned disposable MySQL | Retained/local UAT and live databases untouched |
| Backend proof | Build, 3517/3517 full unit suite, 68/68 focused checks, 20/20 runtime grant policy; 14-day pruning and atomic transaction | Production receiver readiness is hard-disabled |
| Android/iOS | Cross-platform vector sources and fail-closed proof gates implemented/reviewed | Android Gradle current-source run, iOS XCTest and physical-device evidence unavailable; no APPLIED |
| Security | Final review: 1 blocker, 0 majors, 0 minors | Approved envelope verify/decrypt/schema/enforcement suite is not composed; no ACTIVE |
| Publication | No live/Azure/production mutation | Source is uncommitted at 535bdfe; exact-head 27/27 CI and remote equality pending |

TODO-12/14/15 remain IN_PROGRESS; Schedule Policy and Safe Zone production application is not claimed. FamilyAudit and Web Rules remain separate gaps. Wave 03 is not started; next dependency is bounded Wave 02C production crypto-security qualification.
