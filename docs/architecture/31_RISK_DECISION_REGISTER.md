# 31 — Architecture Decision and Risk Register

## Accepted architecture decisions

| ID | Decision | Status |
|---|---|---|
| ADR-001 | Native Kotlin Android + Swift iOS for OS-deep parental controls | ACCEPTED BASELINE |
| ADR-002 | Separate Parent and Child responsibilities/targets, shared contracts as appropriate | ACCEPTED BASELINE |
| ADR-003 | Zero-readable-activity central service | ACCEPTED BASELINE |
| ADR-004 | E2EE parent-child payloads | ACCEPTED BASELINE |
| ADR-005 | Android Standard + Protected capability modes | ACCEPTED BASELINE |
| ADR-006 | iOS Family Controls/Managed Settings/Device Activity | ACCEPTED BASELINE |
| ADR-007 | Deterministic filtering before AI | ACCEPTED BASELINE |
| ADR-008 | No covert TLS interception | ACCEPTED BASELINE |
| ADR-009 | Arabic/English and full RTL at launch | ACCEPTED BASELINE |
| ADR-010 | Retention choices 14d/1m/3m/6m/9m | ACCEPTED BASELINE |
| ADR-011 | Location retention may only be shorter/equal to general retention | ACCEPTED BASELINE |
| ADR-012 | No face-image/template storage for eye-distance feature | ACCEPTED BASELINE |
| ADR-013 | No claim of YouTube Data API watch-history access | ACCEPTED BASELINE |
| ADR-014 | No hidden/spyware mode | ACCEPTED BASELINE |

## Residual risks and mitigations

| Risk | Impact | Mitigation / Gate |
|---|---|---|
| Android device-owner mode may not be appropriate for every consumer Play deployment | High | Protected Mode is a separate capability; validate provisioning/distribution before implementation |
| iOS Family Controls entitlement approval required | High | Apply early; keep feature matrix honest; fallback release scope defined |
| OEM battery management may interrupt background processes | High | device matrix, foreground/VPN rules, health checks, user guidance |
| Full browser URL history unavailable outside controlled browser in many cases | Medium | PCA Safe Browser for strict mode; source-confidence labels |
| Eye-distance exact centimeters unreliable on non-depth sensors | Medium | near/far model; calibrate; label approximation |
| AI false positives | Medium | deterministic rules, confidence thresholds, parent overrides, rollback |
| E2EE complicates support/recovery | Medium | recovery key, second-parent approval, clear UX |
| Offline device cannot immediately receive new rule | Medium | last-known policy continues; parent sees offline/pending state |
| Public platform policies change | High | source revalidation before phase/store submission |
