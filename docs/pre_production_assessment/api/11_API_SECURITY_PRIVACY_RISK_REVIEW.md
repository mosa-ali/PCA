# 11 — API Security, Privacy & Risk Review

Evidence: `[READ]` source + deep-dives; live probes (report 09). This report
covers API-specific security posture only (no web-UI reassessment).

## 1. Validation (mission §27) — PASS

- Bootstrap: strict shapes + canonical re-encode of token and public keys;
  platform enum; DSK≠DEK; 4 KiB body limit (`bootstrapRoutes.ts:6-13,61-79`;
  `EnrollmentCoordinator.ts:96-107`).
- Runtime-sync: session body `challengeId ≤128`, `signature ≤4096`
  (`runtimeSyncRoutes.ts:227`); outbound batch bound with explicit overflow
  rejection (`:248`); inbound list bound 100 with `droppedForListBound`.
- Oversized bodies → 413 collapsed to `invalid_request` (global handler); no
  enum/ID bypass found; malformed proof/key fail closed.

## 2. Authorization & isolation — PASS

Server-derived authority everywhere (report 03 §2–3); step-up grants for
sensitive parent ops; 54 test files prove cross-family denial.

## 3. Crypto boundary — FAIL-CLOSED (positive)

All six gates fail closed; no unsigned acceptance; no fail-open; no env
bypass; no fake production crypto; policy decrypt not composed at all
(report 05).

## 4. Observability / auditability (mission §35) — PARTIAL

- **`logger: false`** (buildServer.ts:359) → no request/error logging;
  5xx collapse to `{error:'internal_error'}` with the error discarded
  (buildServer.ts:431-438).
- **Family audit is an in-memory reference store** (main.ts: `FamilyAuditService(new InMemoryFamilyAuditRepository())`;
  comment: "deliberately never a durable PCA server audit log").
- **Device-auth emits no audit at all** (challenge issue/verify/replay:
  grep in `backend/src/deviceauth/**` → 0 matches); failed enrollments emit
  nothing; enrollment success emits a family-audit event into the in-memory store.
- Durable where it matters for money/platform: `platform_admin_audit_events`,
  delete-now ledger, alert ledgers, relay state, idempotency ledger.
- Log hygiene: no token/key/password values were found being logged in the
  paths reviewed, but with logging off that is trivially true; absence of
  leak-by-log is not evidence of adequate audit.

## 5. Rate limiting (mission §29) — PARTIAL

- Implementation: in-process fixed window; key = `bucket:clientAddressKey(IP)`;
  IPv4/IPv6 `:port` stripped (S8 fix); proxy trust only via
  `PCA_TRUSTED_PROXY_CIDRS`, else `false` (`rateLimit.ts:35-75`;
  `clientAddress.ts`; `trustProxyConfig.ts`).
- Per-route: runtime-sync challenge 30 / session 30 / outbound 60 / inbound 60;
  bootstrap 30 / recover 30; invitation create 20 / transition 30; pairing
  60/30; retention 20/10/10/60; parent-runtime status 60; health 60/min each.
- Global `authAttemptLimiter` 60/min over `/api/parent/*` + `/api/families/*`
  (`buildServer.ts:364-424`). **No route-level limiters** on childPolicy /
  webRule / childRequest / familyMember (global hook only).
- Identity is **IP-only** even on device-session routes (rationale documented
  `rateLimit.ts:28-31`); limiter state is per-process (scales with instances).

## 6. Privacy (mission §36)

- Sensitive synchronized payloads are **opaque ciphertext** (relay envelopes);
  the server cannot read policy/alerts/audit content; envelope decrypt is not
  composed; alert/audit composers are rejecting (nothing centralized).
- The only readable-protection store (`webRuleRoutes` scaffold, PCA-SEC-023)
  is **not composed in production** (503) — good, but it must not be wired
  without encrypted storage.
- API responses avoid secrets (health bodies, 401/404 envelopes inspected).
- No browsing/messages/photos/app-usage payloads traverse the API in the
  mobile paths assessed.

```text
API_DATA_MINIMIZATION = PASS
API_SENSITIVE_PAYLOAD_READABILITY = EXPECTED (opaque; server has no decrypt path)
```

## 7. Headers / edge (observation)

Live probes showed no HSTS / `X-Content-Type-Options` / `X-Frame-Options` on
API responses — for a JSON API that is an edge/platform policy item; recorded
as risk R-07, not an API defect.

## 8. Summary verdicts

```text
API_SECURITY (source)   = PASS with PARTIAL auditability and rate-limit hardening (API-F05/F09)
API_AUDITABILITY        = PARTIAL
API_PRIVACY             = PASS / EXPECTED readability
```
