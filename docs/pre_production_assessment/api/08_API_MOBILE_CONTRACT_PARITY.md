# 08 — API ↔ Mobile Contract Parity

Evidence: route inventory + client source scan; full machine-readable matrix in
`api_mobile_contract_matrix.json`; live probes in report 09.

## 1. The 16-call matrix (zero drift)

`SERVER_ROUTE_EXISTS = YES` and field-shape checks passed for every row:

| Platform | Client call | Method | Path | Server route |
|---|---|---|---|---|
| ANDROID | bootstrap | POST | `/v1/enrollment/bootstrap` | `bootstrapRoutes.ts:53` |
| ANDROID | bootstrap recover | POST | `/v1/enrollment/bootstrap/recover` | `bootstrapRoutes.ts:115` |
| ANDROID | device challenge | POST | `/v1/runtime-sync/devices/*/challenge` | `runtimeSyncRoutes.ts:207` |
| ANDROID | device session | POST | `/v1/runtime-sync/devices/*/session` | `runtimeSyncRoutes.ts:222` |
| ANDROID | outbound push | POST | `/v1/runtime-sync/outbound` | `runtimeSyncRoutes.ts:240` |
| ANDROID | inbound pull | GET | `/v1/runtime-sync/inbound` | `runtimeSyncRoutes.ts:266` |
| ANDROID | inbound ack | POST | `/v1/runtime-sync/inbound/*/ack` | `runtimeSyncRoutes.ts:301` |
| ANDROID | runtime status | GET | `/v1/runtime-sync/status` | `runtimeSyncRoutes.ts:324` |
| ANDROID | protection status | POST | `/v1/runtime-sync/protection-status` | `runtimeSyncRoutes.ts:341` |
| IOS | bootstrap | POST | `/v1/enrollment/bootstrap` | `bootstrapRoutes.ts:53` |
| IOS | bootstrap recover | POST | `/v1/enrollment/bootstrap/recover` | `bootstrapRoutes.ts:115` |
| IOS | device challenge | POST | `/v1/runtime-sync/devices/*/challenge` | `runtimeSyncRoutes.ts:207` |
| IOS | device session | POST | `/v1/runtime-sync/devices/*/session` | `runtimeSyncRoutes.ts:222` |
| IOS | inbound pull | GET | `/v1/runtime-sync/inbound` | `runtimeSyncRoutes.ts:266` |
| IOS | inbound ack | POST | `/v1/runtime-sync/inbound/*/ack` | `runtimeSyncRoutes.ts:301` |
| IOS | protection status | POST | `/v1/runtime-sync/protection-status` | `runtimeSyncRoutes.ts:341` |

Input/output field names, auth schemes and error surfaces were cross-checked
(deep-dive reports); **drift rows: none**. iOS does not call
`outbound`/`status`; Android does not compose its transport (composition gaps,
not contract gaps). Neither client calls the invitation transition routes or
pairing routes (server exposes them; unused by clients today).

## 2. Per-platform dependency verdicts (mission §13/§14 keys)

Android:

| Capability | Server implemented | Server reachable | Client contract match |
|---|---|---|---|
| enrollment bootstrap/recover | YES | YES (gated by client crypto gate) | PASS |
| device identity/registration | YES | YES | PASS |
| device challenge/session | YES | **NO — rejecting verifier (by design)** | PASS |
| runtime sync (out/in/ack/status) | YES | via session (gated) | PASS |
| policy retrieval/ack on device | YES (relay drain + ack) | via session (gated) | PASS |
| device status / protection-status | YES | via session (gated) | PASS |
| web-rule delivery | **NO (503 by composition)** | NO | N/A (client path unwired) |
| de-enrollment (device-initiated) | **NO** | NO | N/A (no client call exists either) |
| recovery/re-enrollment | YES (recover + re-invite) | YES | PASS |
| version/capability reporting | **NO** | NO | N/A |

iOS: same as Android except (a) iOS invitation **minting is refused by
decision** (`PLATFORM_ENROLLMENT_UNAVAILABLE`, report 04 §2) — so the iOS
bootstrap path is unreachable *by construction* as well as by client gates;
(b) iOS does not implement outbound/status.

## 3. Error-contract inventory (mobile-facing)

| Failure | HTTP | Body | Retryable | Client handling (mobile assessment + source) |
|---|---|---|---|---|
| malformed bootstrap/recover | 400 | `{error:'invalid_request'}` | no | mapped to InvalidRequest |
| bad/reused/expired invitation | 404 | `{error:'invitation_unavailable'}` | no | mapped to InvitationUnavailable |
| rate limited | 429 | `{error:'rate_limited'}` | yes (backoff) | generic retryable |
| no/invalid device session | 401 | `{error:'unauthorized'}` | after re-challenge | distinct |
| invalid session body | 400 | `{error:'invalid_request'}` | no | — |
| ack unknown/foreign/expired | 404 | `{error:'not_found'}`-equivalent | no | indistinguishable by design |
| remote/relay internal | 5xx | `{error:'internal_error'}` | yes | generic |
| unknown route | 404 | Fastify `{message,error,statusCode}` | no | — |

**No client branches on an error code the server never emits; no server 4xx
shape found that the clients cannot classify.** The only asymmetry is the 404
envelope style (Fastify default vs `{error:...}` route patterns) — cosmetic,
both JSON.

## 4. Verdict

```text
API_MOBILE_CONTRACT_READY = YES     (zero drift across all 16 calls)
ANDROID_API_DEPENDENCY_READY = CONDITIONAL  (server ready; crypto gate + composition pending)
IOS_API_DEPENDENCY_READY     = CONDITIONAL  (server ready but iOS minting refused by decision; client entry path separate)
```
