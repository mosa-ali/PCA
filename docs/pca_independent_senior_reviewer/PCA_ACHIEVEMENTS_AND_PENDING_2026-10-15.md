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

## Final Wave 02B checkpoint — 2026-10-16 (supersedes earlier publication/DB notes)

FINAL_SHA = 0140b133aa5c47ed1cf044e015fafab76a1c0ad4. Push to `origin/pca-dev` was accepted; local and cached origin report 0 ahead / 0 behind. A follow-up `git ls-remote` and GitHub Actions query could not connect through the workstation proxy, so fresh server-head confirmation and exact-head 27/27 CI remain unverified.

Migration 0066 passed disposable MySQL 8.4.11 replay (all 64 migrations) and 7/7 proof DB tests; the random schema was removed. Backend build, full suite (3517/3517), focused suite (68/68), runtime grant policy (20/20), and 98-table bootstrap drift check passed. No retained local/UAT, live pca_pro, Azure, or production DB was touched. Backend production composition hardwires receiver crypto readiness to false.

Android and iOS remain fail-closed at the unavailable approved production receiver crypto gate. No APPLIED proof or ACTIVE transition is possible. Android current-source build, iOS XCTest, physical-device evidence, and cross-platform mobile vector execution remain outstanding. Independent final review: 1 blocker (approved production envelope verification/decryption/enforcement path), 0 majors, 0 minors. Wave 02B is incomplete; Wave 03 is not started. Recommend a separate bounded Wave 02C for production E2EE receiver crypto qualification.

### Exact-head CI follow-up — 2026-10-16

Quality Gates run 38850083156 completed FAILURE on 0140b133 (24/27 jobs passed). Failures: Repository quality rejected the newly added `shared/` vector directory; Android had two ineffective negative-test fixtures; full MySQL schema privacy rejected the exact owner-approved opaque lifecycle metadata and DSK key ID names. Focused local corrections now allow `shared/`, narrowly document those exact privacy exceptions, and make the UUID/high-S tests exercise invalid values. Repository checks pass locally. These corrections are not staged or published because D: has 208 KB free and Git cannot write `.git/index.lock`; no rerun is claimed.

## Final Wave 02B source validation — 2026-10-16

SOURCE_HEAD = `9a6111c5c9dc8a1f7ca31eb1c043d64e95c75164`
EXACT_HEAD_CI = `38851950745`, SUCCESS, 27/27. Android, iOS, backend build/unit, full disposable MySQL certification, real-backend E2E, browser suites, security, repository quality, contracts, and release-control jobs all succeeded. This run supersedes failed predecessor runs `38850083156` and `38850915464`; the latter test-fixture and privacy-allowlist corrections are committed.
GIT = Fresh direct lookup at this source checkpoint confirmed LOCAL = ORIGIN = SERVER and ahead/behind = 0/0. The following documentation-only synchronization changes the head and requires its own exact-head CI.
WAVE_STATUS = Wave 02B remains incomplete because the approved production E2EE envelope verification/decryption/enforcement suite is unavailable. `APPLIED` and server `ACTIVE` remain fail-closed. No live, Azure, production, or retained UAT database was touched. No physical-device evidence or local Windows Android test pass is claimed. Wave 03 has not started. Parent TODO-12/14/15 and external owner/deployment acceptance gates remain open; Platform remains `HOLD_PARENT_DEPENDENCY`.

### Final evidence refresh — 2026-10-16

Published final checkpoint `45c2b1529a894a2f55f995847faf18b8f5085fef`; local, origin, and server heads match (0/0). Exact-head Quality Gates `38856310690` succeeded 27/27. Authorized local development MySQL `pca_test` was migrated from an empty schema to 0066 and passed post-validation; 98 tables, zero application/test rows, fingerprint `sha256:0bc052e9c08d4bc8bc7bf02e1fa18eb9b69604406f8ef7bbbe2eab457fc62cf2`. Backend targeted checks 36/36; Windows full unit command had six nested-process `EPERM` environment failures (305/311), superseded for CI acceptance by passing exact-head backend unit/full DB jobs. Production receiver crypto remains intentionally unavailable; no APPLIED/ACTIVE. Wave 02B incomplete; Wave 03 not started.

## Wave 02B retention-certification checkpoint — 2026-10-16

Checkpoint `a40463e7aa040f2320243cc3b04142069fac1f75` is published and exact-head Quality Gates run `38858810612` passed 27/27. Disposable MySQL proof/lifecycle suite passed 8/8, including the production retention adapter: expired tombstones prune through the bounded procedure, unexpired tombstones remain, and the durable activation timestamp survives. Production-path certification passed 11/11; the backend register now records 28 certified stores and 27 tracked gaps. The Wave 02A indefinite-retention discussion was superseded by the later Wave 02B owner decision: proof tombstones expire after 14 days. Production receiver crypto remains unavailable and fail-closed; no APPLIED proof or ACTIVE transition is enabled. Wave 02B remains incomplete and Wave 03 has not started.

## Wave 02B fail-closed/mobile checkpoint — 2026-10-16

Android current-device DSK proof signing is now wired to the persisted committed root and original AndroidKeyStore key with custody, scope, transcript, and low-S checks. Focused Android proof tests passed. iOS now has a production-entry test proving a missing approved envelope processor returns DEGRADED and stores no proof. Source head `a7dc5c5051e9aff6df11c2fad89ecd6ffa897ba8` passed exact-head run `38861987927` 27/27; iOS test head `6ace80e1813dd763c85481827efcddce4fdbeae4` passed exact-head run `38862851198` 27/27. LOCAL = ORIGIN = SERVER = `6ace80e1813dd763c85481827efcddce4fdbeae4`; ahead/behind = 0/0. Production E2EE receiver crypto remains unapproved; APPLIED and ACTIVE remain unreachable.

Owner's latest 2026-10-16 decision supersedes the earlier PoP-equivalence choice: DSK proof-of-possession is only the authentication ceremony. The backend issues a separate, short-lived, non-refreshable `PAIRED_BOOTSTRAP` session through the existing `DeviceSessionService`, bound to family, device, current DSK, target generation and application challenge. Only activation-target fetch, proof submission and proof status accept it; normal relay/runtime routes require an ACTIVE-purpose session. Every scoped request rechecks PAIRED/non-revoked state, accepted Trust Set, current DSK, target and challenge. It is invalid after activation, revocation, authority/target change or expiry.

## Wave 02B final verification — 2026-10-16

**Completed and verified:** source checkpoint `b305a0b9117f45b3a231aa807a6bb3ddc555806d` is LOCAL = ORIGIN = SERVER; exact-head run `38883775880` passed 27/27. The run includes green Android, iOS, Backend FULL DB certification, backend unit/build, security and repository quality. Guarded local disposable MySQL replay passed 64 migrations and 9/9 proof tests, then removed the owned schema. Current focused local checks: DeviceSessionService 30/30; proof route/protocol/migration/certification 24/24; iOS source parse PASS.

**Still pending:** approved production E2EE envelope verification/decryption/schema/enforcement integration, so APPLIED and ACTIVE remain impossible. No Android physical-device or local release-assembly claim is made. TODO-12/14/15 remain IN_PROGRESS; TODO-18 owner acceptance and external deployment/live DB gates remain open. TODO-19 is PASS for the source checkpoint above; TODO-20 retains local-development migration evidence through 0066. Wave 02B is incomplete; Wave 03 has not started. This docs commit requires its own exact-head CI.

## Wave 02B final evidence — 2026-10-16

**Completed:** Migration 0066, backend target/challenge/proof ledger, DSK verification plumbing, exact retry/conflict handling, 14-day tombstones, atomic lifecycle logic, and a distinct DSK-PoP-created `PAIRED_BOOTSTRAP` session are present in the published source. Android and iOS production entry points reach the receiver gate without bypassing it. Exact-head `38953392776` passed 27/27 on `91922f650866e43082891cf99bd289ffd13e6bb4`; fresh lookup confirms LOCAL = ORIGIN = SERVER. The passing run includes mobile builds/tests, backend tests, and full disposable-MySQL certification.

**Pending:** Production E2EE envelope verification/decryption and enforcement integration remains deliberately unapproved. Therefore no APPLIED proof or ACTIVE transition is possible. No retained local UAT/live/Azure/production DB change or physical-device acceptance is claimed. Wave 02B is incomplete, and Wave 03 has not started.
