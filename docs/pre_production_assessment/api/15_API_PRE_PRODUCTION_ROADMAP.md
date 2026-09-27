# 15 — API Pre-Production Roadmap

Grouped by priority; owners assigned by layer. No fixes were performed in this
mission (diagnostic only).

## P0 — before any affected mobile physical UAT

*None.* No P0 defects were found. The physical-UAT blocker is the external
crypto gate (below), not a defect.

## P1 — before formal pre-production acceptance

| ID | Layer | Issue | Owner | Required change | Dependency | Validation | Mobile impact | Complexity |
|---|---|---|---|---|---|---|---|---|
| API-F01 | WORKTREE | Tree red: 16 unit-test failures (invitation/Safe Zone 500s + meta gates) | Concurrent migration lane + coordinator | Land the in-flight Parent identity/authority migration green | none | `npm test` full green on a frozen revision | Indirect (CI/acceptance) | MEDIUM |
| GATE-1 | SECURITY_GATE (external) | PCA-DEC-020 human crypto review — exit condition for sessions/enrollment E2E | Owner / external reviewer | Complete review; authorize a real verifier | human review | Review record + wiring change | Both platforms unblocked to attempt UAT | EXTERNAL |
| API-F07 | API_SOURCE | web-rules 503 scaffold with readable domains | Backend + product | Remove scaffold or replace with encrypted storage/delivery | product decision | Routes removed/503 gone; privacy classification updated | Android consumer decision | SMALL–MEDIUM |

## P2 — before production

| ID | Layer | Issue | Owner | Required change | Validation | Mobile impact | Complexity |
|---|---|---|---|---|---|---|---|
| API-F02 | API_SOURCE | In-memory device sessions | Backend | MySQL-backed session store (or documented single-instance constraint) | Tests + restart/multi-instance check | Stable sessions across deploys | MEDIUM |
| API-F03 | API_SOURCE | No device-session revocation | Backend | Hook `revokeSession` into device revocation; clear store | New regression test | Immediate revocation | SMALL |
| API-F04 | SHARED_CONTRACT | No device-initiated unenroll / unenrolled state | Product + backend (+mobile) | Define contract; add route or record explicit absence | Route tests + client wiring | De-enrollment journey | MEDIUM–LARGE |
| API-F05 | API_SOURCE | No request logging; in-memory family audit; no device-auth audit | Backend | Redacted logger + durable audit for enrollment/device security events | Log/audit assertions | Forensics for mobile incidents | MEDIUM |
| API-F06 | API_SOURCE | Policy sync lacks version/read-back | Backend | Persist message_type/version; add delivery-state projection | Schema + route tests | "Delivered vs applied" observable | MEDIUM |
| API-F08 | API_SOURCE | Post-commit 500 on enrollment | Backend (+ mobile guidance) | Move side effects into tx or return committed-success | Test for committed-then-failed path | Clients should call `/recover` on 500 | SMALL |
| R-01 | PRODUCTION_CONFIGURATION | Trusted-proxy allowlist unverified | Owner/ops | Confirm `PCA_TRUSTED_PROXY_CIDRS` in App Service; add ops check | Live probe proof | Accurate per-IP limits | SMALL |
| R-02 | MULTI_LAYER | Gate-exit sequencing (verifier swap must ship with F02/F03) | Owner + backend | Bundle as one gated slice | UAT on staged environment | Safe UAT start | MEDIUM |

## P3 — hardening / later

| ID | Issue | Owner | Complexity |
|---|---|---|---|
| API-F09 | Rate-limit hardening (shared store; route-level limits; optional device keying) | Backend | MEDIUM |
| API-F10 | Client-supplied idempotency keys on retryable routes | Backend | SMALL |
| API-F11 | Enrollment attempt expiry policy | Backend | SMALL |
| API-F12 | Client-version header + min-supported gate | Backend + mobile | MEDIUM |
| API-F13 | Replay re-comparison parity | Backend | SMALL |
| R-04 | Relay drop alerting (expired/undelivered policies) | Backend | SMALL |
| R-05 | Document/handle single-instance assumptions | Backend/ops | SMALL |
| R-06 | Version-negotiation rollout plan | Backend + mobile | MEDIUM |
| R-07 | Confirm edge security-header policy | Owner/ops | SMALL |

## Sequencing note

The shortest path to honest physical-device UAT: (1) freeze + green the tree
(API-F01); (2) land the crypto review exit slice — P256 wiring + durable
sessions + session revocation (GATE-1 + F02 + F03); (3) then device UAT can
exercise enrollment → session → relay with real revocation semantics.
