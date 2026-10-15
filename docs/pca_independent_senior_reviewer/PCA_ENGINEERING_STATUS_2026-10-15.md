# PCA Engineering Status - 2026-10-15

## Certified source checkpoint

Wave 01 source checkpoint `7338331f0db38cea80bb7c0efd57664e44c1d2b0` is published on `pca-dev`. Exact-head Quality Gates run `38660927037` completed **27/27 SUCCESS** on that exact SHA. The run includes Android, iOS, Backend, full disposable MySQL, browser E2E, contract, repository-quality, and security jobs. Every job was inspected and succeeded. The one-time ledger update is a later docs-only commit and requires its own exact-head run before Wave 01 exits.

## Git and preservation

At the source checkpoint, `LOCAL_HEAD = ORIGIN_HEAD = SERVER_HEAD = 7338331f0db38cea80bb7c0efd57664e44c1d2b0`, `AHEAD = 0`, `BEHIND = 0`. The tracked tree is clean. Owner/local untracked material remains preserved: `.Snapshot`, `.tmp/`, `.vscode/`, root `0`, `tmp/`, the Parent Trust Set protocol review, and the mobile swarm work matrix.

The 23 commits formerly ahead of fetched origin at the handover SHA are all in published history; no previous commit was lost or excluded. Pre-alignment tracked edits are retained on local-only branch `codex/wave01-primary-preservation-20261015` at `9957812c`; exact byte copies of the seven superseded file versions, the identical ownership matrix, and original report drafts are retained under `%TEMP%\pca-wave01-local-preservation-20261015`. That branch is not part of `pca-dev` and was not pushed. Five owner-only tracked edits were excluded from the published source checkpoint and preserved there.

## Engineering and validation

- **Backend:** build passed; full registered unit suite passed **3504/3504** locally and in CI. Focused Trust Set/device/policy tests passed **92/92**. Duplicate top-level JSON field rejection is covered before service invocation. Previous Backend actor-fixture failure is resolved in the published batch.
- **MySQL:** full disposable MySQL 8.4.11 certification, first-owner bootstrap certification, and auth/migration DB certification passed in CI. CI stopped/removed its DB containers and network. Local Docker Desktop returned API 500 before creating a container. No retained owner-UAT or live DB was touched.
- **Android:** exact-head CI ran `lint test assembleDebug assembleRelease` successfully. This resolves the stale source-reachability assertion failure; the final regression now matches the production runtime-outcome helper. Release artifact is unsigned because release signing is not configured. Host Gradle could not complete locally because of memory/process constraints; no physical-device evidence is claimed.
- **iOS:** exact-head XCTest passed **760 tests, 7 skipped, 0 failures**. Skips were environment/keychain/Secure Enclave dependent. Local Swift parsing and release integration declaration validation passed. The final test asserts that a committed-root identity mismatch remains recoverable and cannot write a mirror identity, authorize orphan cleanup, or delete aliases. No physical-device evidence is claimed.
- **Policy/security:** peer and coordinator reviews accepted the changed Android/iOS test corrections. Backend contract/security jobs and real-backend E2E passed. Production receiving-policy acceptance, encrypted Web Rules delivery, and server-authoritative ACTIVE remain gated by approved contracts.
- **Generated artifacts:** `.gitignore` and `.dockerignore` narrowly cover `tmp/ci-diagnostics-*` and `tmp/ios-diagnostics-*`; no diagnostic path is tracked or staged. Root `tmp/` remains preserved and is not broadly ignored.

## TODO and external gates

TODO-12/14/15 remain **IN_PROGRESS**; TODO-14 aggregate remains `NOT_YET_PROVEN`. TODO-19 source publication and exact-head CI passed at `7338331f`; the ledger-only final commit has its own Wave 01 exact-head CI gate. TODO-20 remains **PASS** as recorded through migration 0065; this wave made no database change. TODO-18 owner localhost acceptance and TODO-21/22/23 Azure, production acceptance, and mission closure remain TODO. Platform stays `HOLD_PARENT_DEPENDENCY`.

Physical Android/iOS evidence, owner acceptance, approved production crypto and policy-receipt contracts, live DB checks, Azure deployment, and production acceptance remain open external gates. Wave 02 has not started and requires owner authorization after the final documentation-head CI is green.