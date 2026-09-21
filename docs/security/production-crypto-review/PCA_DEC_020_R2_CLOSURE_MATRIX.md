# PCA-DEC-020-R2 Closure Matrix

| Gate | Source evidence | Status | Production state |
| --- | --- | --- | --- |
| C-001 dedicated genesis step-up | Exact session binding, fresh password re-auth, one-time mailbox code, atomic consumption; R2 tests | PASS | Not activated |
| H-002 temporal policy | Shared server-time skew/freshness/TTL policy and R2 tests | PASS | Not activated |
| M-003 ACTIVE-only authority | Resolver rejects every non-`ACTIVE` device state; R2 tests | PASS | Rejecting verifier remains active |
| M-004 canonical P256 | Fixed-width P1363, scalar bounds, low-S verifier and browser canonicalizer | PASS | Not activated |
| M-005 canonical base64url | Shared strict validator and trailing-bit regression | PASS | Not activated |
| M-006 bootstrap boundary | Main composition test and boundary document | PASS | Legacy path unreachable in production composition |
| L-007 membership FKs | Migration/schema source and regenerated disposable artifacts | PASS | Migration 0043 not executed |
| L-008 browser key lifecycle | Non-extractable in-memory policy documented | ACCEPTED RESIDUAL | Re-pair after reload |
| R2-9 native interop | Android/iOS fail-closed adapters are explicitly pending | BLOCKED | Physical/native proof required |
| R2-10 adversary model | Threat model document | PASS | Review pending |
| R2-11 disposable migrations | 8/8 artifact tests and no generator drift | PASS | No production DB mutation |
| R2-12 regression | Backend 2391/2391; Parent Web 143/1031; targeted R1/R2 suites | PASS | No deployment |
| R2-13 production composition | 2/2 composition tests; Rejecting verifier still wired | PASS | Fail-closed |
| R2-14 evidence package | R2 manifest, closure matrix, canonical vector, native status | PASS | Independent review pending |
| R2-15 publication | Source commit `54680a0d8ffaef1eaf425b5ba727e64fb987e328` | PENDING PUSH | No production effect |

## Explicit non-goals

- No Azure resource, App Service, DNS, TLS, or production configuration was
  changed.
- No production migration 0043, 0044, or 0045 was executed.
- No account was remediated and no real family genesis was performed.
- No P256 verifier was activated in production.
