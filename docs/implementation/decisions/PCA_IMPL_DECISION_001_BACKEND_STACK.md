# PCA implementation decision 001 — backend foundation stack

| Field | Decision |
|---|---|
| Status | ACCEPTED FOR PCA-1 FOUNDATION |
| Date | 2026-08-10 |
| Scope | `backend/` only; no client, protocol, invitation, policy, or cryptographic implementation |
| Runtime | Node.js 22 LTS, TypeScript in strict mode |
| HTTP framework | Fastify 5 |
| Persistence | PostgreSQL 17, explicit ordered SQL migrations |
| Local persistence test | Disposable Docker Compose PostgreSQL only |

## Decision

PCA starts its backend with Node.js LTS, TypeScript, Fastify, PostgreSQL, explicit SQL migrations, and Docker Compose. This is the smallest typed, locally testable foundation compatible with the accepted architecture. The initial service has one health endpoint only. It is intentionally not an API implementation for family data, enrollment, invitations, policy delivery, relay, recovery, or parent administration.

## Privacy boundary

The foundation schema allows only opaque account/family/device references, device public keys, license state, signed release metadata, and bounded security-audit metadata. It rejects readable activity and sensitive material by deterministic migration inspection. Specifically it contains no readable URLs, page titles, search queries, YouTube history, app usage, location history, policy plaintext, Dhikr activity, camera frames, face data, private keys, FDEK plaintext, recovery secrets, or Administration PIN data.

`PCA-FR-136`, `PCA-FR-137`, `PCA-SEC-010`, `PCA-SEC-014`, `PCA-SEC-015`, `PCA-SEC-023`, `PCA-ADD-ENR-011`, and `PCA-ADD-ENR-013` remain implementation-authority references. This foundation supplies only the server/data boundary prerequisite; it does not mark their user-facing, cryptographic, or authorization behavior implemented.

## Consequences and gates

- Every migration must be tested against a fresh disposable PostgreSQL database and must extend privacy absence tests.
- The test database URL is restricted to the local Compose service. Developer and production databases are prohibited.
- Future invitation, relay, recovery, policy, cryptographic, and authorization flows require separately owned migrations, protocol review, negative security tests, and traceability evidence.
- Docker daemon access was unavailable on the originating workstation; deterministic TypeScript and schema privacy tests remain required before a commit, while the live Compose gate remains `WAITING_EXTERNAL_DEPENDENCY` until daemon access is restored.
