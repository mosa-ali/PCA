# PCA Real-Device UAT Test Plan (PCA-18)

Status: **PLAN ONLY — NOT YET EXECUTED.** Nothing in this document, and no
automated test run referenced from it, may ever be cited as evidence that
real-device UAT has occurred. Real UAT is a physical-device activity
performed by a human tester against a signed build and recorded in
[`uat_execution_log.json`](./uat_execution_log.json); this file only defines
what that activity must cover and how it must be recorded.

This plan implements the "Device/E2E" and related rows of
`docs/architecture/28_TEST_QA_SECURITY_VALIDATION.md` §2–§6 as concrete,
executable test cases for PCA-18 (Family beta/UAT) and the go/no-go input to
PCA-19 (Production release).

## 1. Why this cannot be automated away

Unit/integration/db-clean-room automated tests (see
`RELEASE_EVIDENCE.md` / the evidence collector) verify policy and protocol
logic in isolation. They do **not** verify: OEM battery-optimization killing
the app, real notification/Doze/App-Standby behavior, real permission
dialogs, real reboot/process-death timing, real network handovers, real
screen-reader/TalkBack behavior, or a human's actual comprehension of
child-facing/parent-facing UI. Those require a physical device, a human
tester, and a recorded outcome. No CI job, emulator run, or unit test may be
labeled "real device UAT" in this repository.

## 2. Preconditions before any test case in this plan may be executed

- [ ] A signed, versioned release-candidate build exists (see
      `RELEASE_GATE.md`) with recorded git SHA, artifact hash, and signing
      identity per `docs/architecture/29_RELEASE_DEPLOYMENT_ROLLBACK.md` §2.
- [ ] `PRODUCTION_CRYPTO_SUITE` has passed human security review (device
      session issuance and inbound envelope acceptance are functional, not
      fail-closed stubs). Running UAT against the current
      `RejectingDeviceSignatureVerifier` / `RejectingEnvelopeSignatureVerifier`
      build will fail enrollment/sync test cases by design — that is a gate
      state, not a UAT bug, and should not be logged as one.
- [ ] Only synthetic/non-production family, child, and account data is used.
      No real child's activity, location, or identity is used at any test
      stage.
- [ ] Tester(s), device inventory, and OS/OEM versions are recorded before
      the session starts (§5 Device Matrix).

## 3. Device matrix (to be filled in with actual hardware before execution)

| # | Platform | Manufacturer/model | OS version | Role | Status |
|---|---|---|---|---|---|
| D1 | Android | *(TBD)* | *(TBD, min supported — see doc 02)* | Child device | **NOT PROVISIONED** |
| D2 | Android | *(TBD)* | *(TBD, current)* | Child device | **NOT PROVISIONED** |
| D3 | Android | *(TBD, OEM with aggressive battery mgmt e.g. Xiaomi/Huawei/Samsung)* | *(TBD)* | Child device | **NOT PROVISIONED** |
| D4 | Any | *(TBD)* | n/a | Parent device (web/browser) | Available (Parent Web runs in any modern browser) |
| D5 | iOS | *(TBD)* | *(TBD)* | Child device | **BLOCKED — see `EXTERNAL_GATE_MATRIX.md` (IOS_PHYSICAL_DEVICE, IOS_FAMILY_CONTROLS_ENTITLEMENT)** |

This lane (release-readiness authoring) has no physical Android or iOS
device and cannot provision D1–D5. Populating this table with real hardware
and executing the cases below is Android/iOS device-owner work, tracked
externally (see `EXTERNAL_GATE_MATRIX.md`).

## 4. Test case catalogue

Each case must be logged in `uat_execution_log.json` with: case ID, device
ID (from §3), tester, timestamp, pass/fail, and evidence (screenshot/video
reference or written observation). A case is not "passed" until logged.

### 4.1 Enrollment
- UAT-ENR-01: QR-code pairing completes end-to-end on a fresh device, family/device keys generated on-device.
- UAT-ENR-02: Enrollment invitation expiry is enforced (attempt after expiry is rejected).
- UAT-ENR-03: Enrollment during airplane mode/offline shows accurate blocked/pending state, then completes on reconnect.
- UAT-ENR-04: Re-enrollment of a previously-revoked device is rejected.

### 4.2 Process death / reboot / lifecycle
- UAT-LIFE-01: Force-kill the PCA child process mid-session; screen-time counter resumes correctly on relaunch (no double-count, no reset bypass).
- UAT-LIFE-02: Full device reboot mid-active-session; emergency floor and protections restore automatically without parent action.
- UAT-LIFE-03: OEM aggressive battery optimization (D3) does not silently disable monitoring/blocking without an accurate "limited/unavailable" UI state.
- UAT-LIFE-04: Wall-clock rollback (user sets clock backward) does not grant bonus screen time.
- UAT-LIFE-05: Time-zone change mid-session is handled per doc 12 (screen-time) and doc's retention UTC rules.

### 4.3 Screen-time 60/30 invariant
- UAT-ST-01: 60-minute active-use budget decrements only while screen is actually on and app is foregrounded/counted per policy; verify via stopwatch cross-check.
- UAT-ST-02: 30-minute break is enforced (child cannot bypass by force-closing/reopening).
- UAT-ST-03: Break Shield UI is genuinely unavoidable (not dismissible via back/recent-apps/split-screen/PiP).
- UAT-ST-04: Incoming/outgoing call and emergency-call flows do not pause or corrupt the invariant.
- UAT-ST-05: Parent override/bonus-time grant applies correctly and is visible to child.

### 4.4 Break Shield
- UAT-BRK-01: Break Shield appears at the correct threshold and blocks other app usage.
- UAT-BRK-02: Emergency floor (calling) remains available during Break Shield.
- UAT-BRK-03: Break Shield survives process death/reboot (does not silently clear).

### 4.5 Schedules
- UAT-SCH-01: Scheduled block window activates/deactivates at the correct local wall-clock time.
- UAT-SCH-02: DST transition does not shift a schedule window incorrectly.
- UAT-SCH-03: Schedule edited by parent while child device is offline applies correctly once child device reconnects.

### 4.6 App usage controls
- UAT-APP-01: Per-app time limit/block is enforced for a real installed third-party app.
- UAT-APP-02: Newly-installed app appears in parent dashboard within the documented sync bound.
- UAT-APP-03: Uninstall/reinstall does not reset an app-specific limit inappropriately.

### 4.7 Location
- UAT-LOC-01: Location updates appear on parent dashboard within expected interval, online.
- UAT-LOC-02: Location gracefully degrades (accurate "unavailable" state, not stale-silent) when GPS/network is off.
- UAT-LOC-03: Geofence/safe-zone entry/exit notification fires correctly.

### 4.8 Safe Browser / web filtering
- UAT-WEB-01: Blocked category site is blocked in PCA Safe Browser.
- UAT-WEB-02: "Ask Parent" flow: child request reaches parent, parent approve/deny reflects back to child device correctly, including offline/reconnect timing.
- UAT-WEB-03: Review-queue flow for borderline content works end-to-end.
- UAT-WEB-04: Attempting to use a non-PCA browser to bypass filtering is handled per documented policy (blocked or logged per design, not silently ignored).

### 4.9 Eye protection / prayer / wellbeing
- UAT-EYE-01: Eye-distance/proximity protection prompt fires under real device camera conditions (if enabled) without storing frame data (cross-check against privacy absence tests in `docs/architecture/28...md` §4, not just UI).
- UAT-PRAY-01: Prayer-time calculation matches expected local times for the test device's location/timezone.
- UAT-WELL-01: Wellbeing nudges display correctly and are dismissible per design.

### 4.10 Offline / reconnect / network matrix
See `NETWORK_MATRIX.md` for the full cross-product; execute at minimum:
- UAT-NET-01: Full offline — protections continue enforcing locally.
- UAT-NET-02: Reconnect after extended offline — queued state reconciles without data loss or duplicate application.
- UAT-NET-03: Backend unavailable (5xx/timeout) — child/parent apps show accurate degraded state, not a false "all synced" indicator.
- UAT-NET-04: Wi-Fi → mobile data handover mid-sync does not corrupt session state.

### 4.11 Parent dashboard
- UAT-PDASH-01: Dashboard reflects real child device state within documented sync latency.
- UAT-PDASH-02: RBAC — a second parent/guardian role sees only permitted actions.
- UAT-PDASH-03: Child request center (Ask Parent, app requests) updates in real time / on reconnect.

### 4.12 Delete / export / retention
- UAT-DEL-01: Parent-initiated "delete now" removes data per doc 12/28 retention rules; verify absence, not just UI confirmation.
- UAT-DEL-02: Export produces a real encrypted export file the parent can retrieve.
- UAT-DEL-03: Retention boundary (14-day / 1/3/6/9-month) expiry is honored at just-before/at/after boundary on a real device clock.

### 4.13 Recovery
- UAT-REC-01: Recovery-secret-based device replacement/recovery flow works end-to-end on a real device.
- UAT-REC-02: Loss of recovery secret is handled per documented policy (no silent support-master bypass).

### 4.14 Tamper detection
- UAT-TMP-01: Attempting to uninstall/disable the device-admin or accessibility permission underlying protection triggers the documented tamper response.
- UAT-TMP-02: Tamper alert reaches the parent dashboard.

### 4.15 Arabic / RTL
- UAT-I18N-01: Full Arabic UI on child device: true RTL layout, correct mixed-direction rendering of emails/codes/app names, correct date/time/number formatting.
- UAT-I18N-02: Full Arabic UI on Parent Web, independently of child device language (mixed-language household case).
- UAT-I18N-03: Screen reader / TalkBack in Arabic reads all interactive elements including dropdown option labels (see project note: display-only translation is insufficient — verify via actual TalkBack pass, not visual inspection only).

## 5. Sign-off

A test cycle is complete only when every case in §4 has a logged
pass/fail/blocked entry in `uat_execution_log.json`, the device matrix in
§3 is fully populated with real hardware, and an authorized owner records a
go/no-go decision referencing this file's git SHA. Partial execution must
be reported as partial, never rounded up.
