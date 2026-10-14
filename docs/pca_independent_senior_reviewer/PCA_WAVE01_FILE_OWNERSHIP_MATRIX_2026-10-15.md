# PCA Wave 01 File Ownership Matrix

Verified integration base for writer lanes: `9f20ca6925c4b34c17e180b561299441ec1cc9d3`, after review of the 23 commits from fetched `origin/pca-dev` (`c9eca8b8a1655afcc26b326c34a09d4f338164bc`). The server and fetched ref matched. All writer lanes must start from this same base; no writer may change a path outside its assignment.

| Lane | Owner | Assigned paths | Initial status |
|---|---|---|---|
| Coordinator / integration | Agent 0 | `.dockerignore`, `.gitignore`; `backend/package.json`, `backend/scripts/with-disposable-db.mjs`; `docs/PCA_PARENT_AUTHORITY_CONTINUOUS_GOAL.md`; `docs/pca_independent_senior_reviewer/PARENT_CODEX_MASTER_TODO.md`; `docs/pca_independent_senior_reviewer/PLATFORM_CODEX_MASTER_TODO.md`; final engineering status, achievements, and handover reports | Review shared/test-registration and ledger changes; update reports once after source and CI stabilize |
| Android | Agent 1 | `android/app/src/main/java/org/pca/app/enrollment/HttpDeviceBootstrapApiClient.kt`; `android/app/src/main/java/org/pca/app/firstdevice/FirstDeviceBootstrapApiClient.kt`; `android/app/src/test/java/org/pca/app/enrollment/FakeHttpServer.kt`; `android/app/src/test/java/org/pca/app/enrollment/HttpDeviceBootstrapApiClientTest.kt`; `android/app/src/test/java/org/pca/app/firstdevice/FirstDeviceBootstrapApiClientTest.kt`; `android/app/src/test/java/org/pca/app/runtime/trustset/OrdinaryTrustSetRuntimeReachabilityTest.kt` | Pending local Android tests/lint/release validation |
| iOS | Agent 2 | `ios/PCA/Transport/PCADeviceAPI.swift`; `ios/PCA/Transport/PCADeviceRuntimeSyncClient.swift`; `ios/PCATests/ProductionIntegrationTests.swift` | Static checks available locally; XCTest requires Apple CI |
| Backend / device authority | Agent 3 | `backend/src/device/MySqlDeviceRepository.ts`; `backend/src/familytrustset/TrustSetEpochAcceptance.ts`; `backend/src/http/routes/ordinaryTrustSetRoutes.ts`; `backend/test/db/deviceProtectionStatus.mysql.test.mjs`; `backend/test/db/pairing.mysql.test.mjs`; `backend/test/familytrustset/trustSetEpochAcceptance.test.mjs`; `backend/test/http/ordinaryTrustSetRoutes.test.mjs` | Integrated full unit suite passed 3504/3504 after the duplicate-member follow-up; affected disposable MySQL checks remain |
| Policy / cross-platform certification | Agent 4 | No preassigned dirty product paths. May own a correction only after coordinator assigns a concrete reproduced failure and confirms the path is unowned. | Cross-review Android, iOS, and Backend lanes; no Wave 02 ACTIVE-transition scope |

## Excluded local material

Preserve `.Snapshot`, `.tmp/`, `.vscode/`, root `0`, root `tmp/`, `PARENT_FIRST_DEVICE_TRUST_SET_PROTOCOL_REVIEW.md`, and `PCA_MOBILE_SWARM_WORK_MATRIX.md` unchanged unless the coordinator explicitly assigns a report update. Root `tmp/` is mixed content and contains retained owner configuration. Generated CI/iOS diagnostics must remain untracked and unstaged. No blanket ignore rule may be added for root `tmp/`.

## Integration controls

- All 23 commits already in the verified local history were individually classified as valid pending work across the Android, iOS, Backend/device-authority, and Policy/cross-platform lanes; retain each without rewriting history.
- Coordinator-owned shared files are not to be edited by writer lanes.
- Each writer commit receives a peer-specialist review and coordinator review before integration.
- Out-of-scope shared test-wrapper changes must be explicitly accepted or excluded while preserving the original patch; they cannot be silently staged.
- No generated artifacts, owner-excluded paths, or secrets may be staged.
