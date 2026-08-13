# Release Evidence (PCA-18/19)

## How to (re-)collect

```
pwsh tooling/release/Invoke-ReleaseEvidenceCollection.ps1 [-RunDbTests] [-RunAndroid]
```

Writes a timestamped JSON evidence pack to
`docs/release_readiness/evidence/evidence-<UTC timestamp>.json` and updates
`docs/release_readiness/evidence/latest.json`. Every field is captured from
an actual command run in this environment at collection time — nothing in
the pack is a placeholder or an estimate. Where a step could not run (no
Android SDK, no reachable MySQL, no macOS for iOS), the pack records that
explicitly instead of omitting the field or guessing a number.

- `-RunDbTests` additionally runs backend DB clean-room tests against
  `PCA_DATABASE_URL` (destructively resets that database — point it only at
  a disposable test MySQL instance, e.g. via `backend/compose.yaml`).
- `-RunAndroid` additionally runs Android **JVM unit tests**
  (`gradlew testDebugUnitTest`) via `ANDROID_HOME`/`ANDROID_SDK_ROOT`. This
  is not instrumented (`androidTest`) coverage and is not real-device UAT —
  see the scope note the script embeds in the pack.

## What this captures vs. what it does not

| Captured by the script | NOT captured by the script (see other docs) |
|---|---|
| Git SHA / branch / dirty state | Real-device UAT (`UAT_TEST_PLAN.md`) |
| `npm audit` for backend, parent-web, each parent-sdk package | iOS build/test (`EXTERNAL_GATE_MATRIX.md` — no macOS/Xcode here) |
| Backend unit test counts (`npm test`) | Android instrumented/`androidTest` coverage (needs emulator/device) |
| Backend DB clean-room test counts (`npm run test:db`), if requested | Crypto security review sign-off (source-derived gate state only, not a review) |
| Android JVM unit test counts (`testDebugUnitTest`), if requested | Privacy-absence/telemetry-sink tests beyond what `tooling/security/Invoke-SecurityChecks.ps1` already checks |
| `PRODUCTION_CRYPTO_SUITE` / `REAL_UAT` / external gate state, via the release gate script | Store submission artifacts, signing identities |

## Latest real run captured by this lane (PCA-33)

Recorded from an actual clean full run in this worktree
(`docs/release_readiness/evidence/latest.json` has the full machine-readable
version — this table is a human-readable snapshot, not a separate source of
truth). This is the corrected run after the two bugs below were found and
fixed; an earlier run under concurrent system load hit transient Vitest
timeouts, which disappeared on a clean re-run (see flake note below).

| Item | Result | Notes |
|---|---|---|
| Git SHA | `fcf80e6d0ce0451ee4351122ebb5003dc50d2df7` | Detached HEAD, this worktree |
| Backend `npm audit` | 0 vulnerabilities | |
| Parent Web `npm audit` | 0 vulnerabilities | |
| `parent-sdk/browser-runtime` `npm audit` | 0 vulnerabilities | |
| `parent-sdk/runtime-sync` `npm audit` | 0 vulnerabilities | |
| `parent-sdk/wellbeing-control` `npm audit` | 0 vulnerabilities | |
| Backend unit tests | 956/956 pass (3 TAP blocks summed) | `npm test` in `backend/` |
| Backend DB clean-room tests | 159/159 pass | Run against a local disposable MySQL 8.4 Docker container (`backend/compose.yaml` default, port 33061) |
| Android JVM unit tests | 802 tests, 0 failures, 0 errors, 1 skipped (131 suite files) | `gradlew testDebugUnitTest` — **JVM unit tests only, not instrumented/androidTest, not real-device** |
| Parent Web tests | 259/259 pass, 35/35 files pass | Process exit code was still 1 in this run — see note below, this is not a test failure |
| `PRODUCTION_CRYPTO_SUITE` | `PENDING_HUMAN_SECURITY_REVIEW` | Confirmed by source inspection of `backend/src/main.ts` |
| `REAL_UAT` | `NOT_EXECUTED` | `uat_execution_log.json`, 0/50 cases logged |
| External gates | All 7 `BLOCKED`/`EXTERNAL` | See `EXTERNAL_GATE_MATRIX.md` |

### Known flake note (parent-web)

Running the full evidence script once under concurrent system load (Android
Gradle build + backend DB tests running around the same time) produced 3
parent-web test timeouts (`Test timed out in 5000ms`, default Vitest
timeout, during `AuthContext`/route-matrix async work). A clean re-run with
less concurrent load passed 259/259, 35/35 files. This is recorded honestly
as an environment-load flake, not silently dropped — a release decision
should not rely on a single run made under heavy concurrent load.

Separately, in the clean 259/259-passing run, the parent-web `npm test`
process still exited with code 1. The cause is a pre-existing unhandled
`ReferenceError: window is not defined` thrown asynchronously by
`src/state/AuthContext.tsx`'s `refresh()` callback, surfacing **after** a
test's environment (jsdom `window`) has already been torn down —
Vitest reports it as an "Unhandled Rejection" attributed to whichever test
file happened to be running when the async callback resolved
(`tests/route/routeMatrix.test.tsx` / `tests/responsive/mobileSidebar.test.tsx`
in the runs observed here), not as a failed test. All reported test counts
were 0 failed in every observed run. This is source code under
`parent-web/src/**` (a sibling lane's ownership per this lane's scope
boundary), so it was documented here rather than modified. A release
decision should treat parent-web's test-count evidence (259/259) as the
signal, and separately track this exit-code/unhandled-rejection issue as a
cleanup item for the owning lane.

### Known evidence-script bug found and fixed during this lane

The backend `npm test` script chains multiple separate `node:test`
invocations (a couple of plain scripts, then one large `node --test ...`),
each printing its **own** TAP summary block. The evidence collector
initially read only the first block (8 tests, from
`test/schema-privacy.test.mjs`) instead of the true total. Fixed in
`Invoke-ReleaseEvidenceCollection.ps1` to sum every TAP block found in the
combined output (`Get-SummedTapCounts`). Anyone consuming an evidence pack
from before this fix should treat its `backendUnit` count as unreliable.
