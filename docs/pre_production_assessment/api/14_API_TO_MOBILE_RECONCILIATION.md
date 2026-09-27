# 14 — API-to-Mobile Reconciliation

Baseline of mobile set: `docs/pre_production_assessment/pca_application`
(written 2026-09-26 at `pca-dev` @ `9496fb19`; mobile trees unchanged since
~2026-09-19). This assessment re-verified every API-relevant mobile claim
against current backend source + live probes.

## 1. Boundary table (mission §51)

| Area | Mobile assessment | API assessment | Root-cause layer | Revised verdict | Mobile update required |
|---|---|---|---|---|---|
| Android enrollment | flow sound; blocked at client crypto gate (`CryptoReviewRequired`) | server enrollment contract sound; **server also gates sessions** via rejecting verifier; invitations refuse iOS by decision | SECURITY_GATE (bilateral) + MULTI_LAYER | CONFIRMED (expanded) | No |
| Android device identity | server-assigned id; proof pipeline absent | server generates ids; family from invitation; cross-family blocked; device must still pair | MOBILE_SOURCE (proof) / API fine | CONFIRMED | No |
| Android device proof | challenge client dead code | challenge/session machinery real; verifier rejecting by design; P256 unwired | SECURITY_GATE (server twin) | CONFIRMED (expanded) | No |
| Android runtime sync | transport not composed (OFFLINE placeholder) | server transport ready and tested (116/116 incl. runtimeSyncRoutes) | COMPOSITION_ONLY (mobile) | CONFIRMED; API side READY | No |
| Android policy sync | no composition → no delivery | relay queue/drain/ack ready; no version/read-back (API-F06) | COMPOSITION_ONLY + server observability gap | CONFIRMED | No |
| Android recovery | attempt persistence/recover sound | `/recover` oracle-free; attempts don't expire (API-F11); post-commit 500 (API-F08) | SHARED (minor) | CONFIRMED | No |
| Android de-enrollment | no de-enrollment path (client) | server: revocation parent-only; no session revocation; no device-initiated unenroll | MULTI_LAYER | CONFIRMED + EXPANDED (API-F03/F04) | No |
| iOS enrollment | scheme unregistered + unowned host + empty proof keys | plus: **server refuses iOS invitation minting by decision** — iOS bootstrap unreachable by construction | MULTI_LAYER (client + decision + gate) | CONFIRMED (expanded) | No |
| iOS device identity | deviceId from server → UserDefaults | server-owned; identity contract fine | MOBILE_SOURCE (storage choice) | CONFIRMED | No |
| iOS device proof | empty keys → blocked | same server twin gate as Android | SECURITY_GATE | CONFIRMED | No |
| iOS policy sync | pulls inbound; `applyVerifiedPolicy` dead | relay delivers; ack works; no read-back (API-F06); client never acks | COMPOSITION_ONLY (mobile) | CONFIRMED | No |
| iOS crypto/key material | fail-closed pending review | bilaterally fail-closed; no fail-open server-side | SECURITY_GATE | CONFIRMED | No |
| Physical-device readiness | blocked by zero device evidence + external gates | additional server-side pending: verifier wiring, durable sessions, session revocation (R-02) | EXTERNAL + MULTI_LAYER | CONFIRMED (dependency list extended) | No |

## 2. Per-finding records (mission §4 format)

- **MOB-001** (Android crypto gate) — API_EVIDENCE: `main.ts:363` rejecting
  verifier; `P256DeviceSignatureVerifier.ts:13-16` unwired. Verdict:
  **CONFIRMED** (+ server twin discovered). Update: NO.
- **MOB-002** (iOS empty keys → blocked) — same server evidence. Verdict:
  **CONFIRMED**. Update: NO.
- **MOB-003** (iOS scheme unregistered) — client-side; no API issue. Verdict:
  **NO_API_ISSUE**. Update: NO.
- **MOB-004** (unowned link host) — external domain gate; API unaffected.
  Verdict: **NO_API_ISSUE (external)**. Update: NO.
- **MOB-005** (iOS apply dead) — API: delivery exists; no read-back. Verdict:
  **CONFIRMED**. Update: NO.
- **MOB-006** (no picker) — client UI; no API issue. **NO_API_ISSUE**.
- **MOB-007** (fixed all-day schedule) — client engine; API sends envelopes
  opaquely. **NO_API_ISSUE**.
- **MOB-008** (shield not cleared on revocation) — API: revocation pathway
  exists; no session revocation (cross-ref API-F03). Verdict: **CONFIRMED**
  with **BACKEND_GAP_DISCOVERED** (the F03 session gap). Update: NO.
- **MOB-009** (iOS never acks) — API: ack route works, recipient-scoped,
  tested. Verdict: **MOBILE_GAP_CONFIRMED**. Update: NO.
- **MOB-010/011** (UserDefaults identity; key material never persisted) —
  client-side. **NO_API_ISSUE**.
- **MOB-012** (Android sync not composed) — API side ready. **CONFIRMED**
  (COMPOSITION_ONLY). Update: NO.
- **MOB-014** (web-rule consumer un-fed) — API: production omits the service →
  permanent 503 (API-F07). Verdict: **CONFIRMED + BACKEND_GAP_DISCOVERED**.
  Update: NO.
- **MOB-015** (no de-enrollment) — API: F03/F04 confirm at server layer.
  Verdict: **CONFIRMED + EXPANDED**. Update: NO.
- **MOB-016** (familyId "") — server knows family from invitation; client gap.
  **NO_API_ISSUE**.
- **MOB-019** (invitation transitions unused) — server routes exist; iOS
  minting refused by decision. Verdict: **CONFIRMED**. Update: NO.
- **MOB-020/021/022/023** (attestation absence; physical/UAT/signing gates) —
  external/product gates, unchanged. **NO_API_ISSUE**.
- **MOB-024** (token validation asymmetry) — server validates canonical
  43-char; asymmetry is client-side. **NO_API_ISSUE**.

## 3. New API findings that affect the mobile programme

`MOB-relevant new findings`: API-F02 (in-memory sessions), API-F03 (no session
revocation), API-F04 (no device-initiated unenroll), API-F05 (audit gaps for
mobile security events), API-F06 (no policy version/read-back), API-F07
(web-rules 503 permanent), API-F08 (post-commit 500 recoverable — clients must
call `/recover`), API-F12 (no client-version gating). None contradict a mobile
conclusion; they extend the pre-UAT dependency list (see report 15).

## 4. Conclusion

```text
MOBILE_FINDINGS_CONFIRMED = 12
MOBILE_FINDINGS_RECLASSIFIED = 0
MOBILE_FINDINGS_CONTRADICTED = 0
NEW_API_FINDINGS_AFFECTING_MOBILE = 8
MOBILE_ASSESSMENT_REQUIRES_REVISION = NO
MOBILE_REPORT_UPDATE_REQUIRED = NO   (no mobile conclusion materially changes)
```

Per mission §43, mobile reports are therefore **not modified**; this report
plus `MOBILE_ASSESSMENT_UPDATE_LOG.md` carry the cross-assessment record.
