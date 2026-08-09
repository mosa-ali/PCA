# 32 — Requirements Traceability and Acceptance Matrix

This matrix defines the minimum acceptance evidence expected later. “Architecture complete” means the acceptance route is defined; it does not claim implementation has passed.

| Requirement group | Architecture owner doc | Future acceptance evidence |
|---|---|---|
| FR-001..006 Enrollment | 08, 09, 22 | E2E pairing/revoke/recovery tests |
| FR-010..017 Screen time | 12 | state-machine unit tests + real-device enforcement tests |
| FR-020..023 Eye distance | 13 | sensor matrix + no-frame-retention privacy test |
| FR-030..036 Filtering | 14, 23 | DNS/VPN/browser tests + classifier evaluation |
| FR-040..044 App usage | 06, 07, 15 | Android/iOS capability tests |
| FR-050..053 YouTube | 15 | API compliance + controlled-player tests if implemented |
| FR-060..065 Location | 16 | permission/offline/staleness/retention tests |
| FR-070..074 Prayer | 17 | calculation fixtures across cities/time zones |
| FR-080..084 Tamper | 21 | revoke/uninstall/auth-degrade device tests |
| FR-090..094 Parent panel | 18 | role authorization and UX tests |
| FR-100..105 Retention | 11 | all 5 retention windows + delete-now + queued-copy tests |
| FR-110..113 Language | 20 | English + Arabic RTL screenshot/accessibility suite |
| FR-120..124 Transparency/privacy | 09, 25, 26, 27 | privacy audit + central log assertions |
| NFR Security | 09, 24, 28 | threat-model review + pen test |
| NFR Reliability | 04, 28, 29 | offline/reboot/update/rollback tests |
| NFR Accessibility | 20, 26, 28 | screen reader/large text/RTL audits |

## Architecture acceptance rules

- Every FR/NFR has a design owner document.
- Every platform-limited requirement has an explicit limitation/fallback.
- Every sensitive data class has owner, storage and retention rules.
- Every privileged OS capability has an official-source reference.
- No implementation begins until owner accepts Gate A-100.
