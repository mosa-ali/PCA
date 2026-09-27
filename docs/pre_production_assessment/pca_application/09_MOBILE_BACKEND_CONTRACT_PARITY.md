# 09 — Mobile backend contract parity

Evidence: `[READ]` backend routes + both clients at `9496fb19`.

## 1. Backend endpoints relevant to mobile

Registration: `backend/src/http/buildServer.ts:495` (bootstrap), `:513`
(runtime sync), `:525` (parent runtime read), `:638/:645/:656` (child
requests / child policy / web rules).

**Enrollment (no auth header; authority = the secret in the body):**

- `POST /v1/enrollment/bootstrap` — `rawInvitationToken, platform(ANDROID|IOS),
  signingPublicKey, encryptionPublicKey, bootstrapAttemptId,
  attemptRecoveryToken` (`bootstrapRoutes.ts:54,77-87`);
  `201 {deviceId,status,childProfileId,ageUxTier,initialPolicyProfile}`
  (`:104`; DTO `dto.ts:96-118`); `400 invalid_request`;
  `404 invitation_unavailable` (collapsed errors `:100-110`).
- `POST /v1/enrollment/bootstrap/recover` — `{bootstrapAttemptId,
  attemptRecoveryToken}` (`:116,127-135`); `200` same DTO (`:140-147`).
- `POST /v1/enrollment/invitations/install-required | /app-installed |
  /authorization-required` — `{rawInvitationToken}` -> `200 {status}`
  (`invitationRoutes.ts:253-263`, loop `:268-296`).

**Runtime sync (device routes: `Authorization: Bearer <device session token>`,
<=4096 chars, else 401 — `runtimeSyncRoutes.ts:181-190`):**

- `POST /v1/runtime-sync/devices/:deviceId/challenge` (unauthenticated by
  design) -> `{challengeId,nonce,expiresAt}` (`:208-219`).
- `POST /v1/runtime-sync/devices/:deviceId/session` — `{challengeId,
  signature}` -> `{sessionToken,expiresAt}` (`:223-236`).
- `POST /v1/runtime-sync/outbound` — `{items:[{messageId,
  recipientDeviceId,ciphertext,messageType,enqueuedAtEpochMillis?,ttlMs?}]}` ->
  `{results[…]}`; 2,315,536-byte body limit (`:88,:241-263`).
- `GET /v1/runtime-sync/inbound` -> `{applied[{messageId,senderDeviceId,
  messageType,payload}],receipts,unparseableMessageIds,droppedForListBound}`
  (`:267-297`).
- `POST /v1/runtime-sync/inbound/:messageId/ack` -> `{acknowledged:true}` /
  404 (`:302-320`).
- `GET /v1/runtime-sync/status` -> `{connectionState}` (`:325-331`).
- `POST /v1/runtime-sync/protection-status` — `{protectionLevel}` in
  STANDARD|PROTECTED|DEGRADED|AUTHORIZATION_REQUIRED|NOT_SUPPORTED -> `204`
  (`:340-366`).

**Parent-side (session cookie + CSRF + device token):**

- `POST /api/parent/families/:familyId/children/:childProfileId/schedule-policy`
  — opaque encrypted envelope `{recipientDeviceId,ciphertextB64,nonceB64,
  keyEpoch}` -> `202 {status:'PENDING',messageId}`; server never parses the
  policy (`childPolicyRoutes.ts:138-146,196-206`).
- `GET/POST /api/parent/families/:familyId/children/:childProfileId/web-rules`
  + `/web-rules/remove` — `{domain,listType}`; delivery is "stored, pending"
  only; `503 not_configured` without the service
  (`webRuleRoutes.ts:154-238`).
- `GET /v1/families/:familyId/runtime-sync/devices/:deviceId/status`
  (`parentRuntimeSyncRoutes.ts:79-95,126-137`); pairing routes
  (`pairingRoutes.ts:33-76`); child-request routes
  (`childRequestRoutes.ts:223-240,300-320`).

**No device-attestation endpoint exists**: zero matches for
`PlayIntegrity|DeviceCheck|AppAttest` under `backend/src`. Device identity is
a signature over the server nonce.

## 2. Client parity

| Endpoint | Android | iOS |
|---|---|---|
| `POST /v1/enrollment/bootstrap` + `/recover` | yes (`HttpDeviceBootstrapApiClient.kt:292-293`) | yes (`PCADeviceAPI.swift:54,62`) |
| `POST …/challenge`, `POST …/session` | implemented (`HttpUrlConnectionRelayHttpClient.kt:80,86`), not composed | implemented + composed (`PCADeviceAPI.swift:136,144`) |
| `POST /v1/runtime-sync/outbound` | implemented, not composed (:102) | **not called** |
| `GET /v1/runtime-sync/inbound` | implemented (:118) | yes (`PCADeviceRuntimeSyncClient.swift:43`) |
| `POST …/inbound/{id}/ack` | implemented (:136) | defined, **never called** (:50) |
| `GET /v1/runtime-sync/status` | implemented (:140) | **not called** |
| `POST /v1/runtime-sync/protection-status` | implemented (:153) | yes (:61) |
| `/v1/enrollment/invitations/*` transitions | **not called** | not applicable (documented for Android continuation) |
| pairing routes / `/api/parent/*` | interface-only (`PairingApiClient.kt:22-25`), not called | not called |

Field shapes checked: bootstrap request/response names identical on both
clients; `ageUxTier`/`initialPolicyProfile` literals match
(`EnrollmentProfile.kt:7-9` vs `ChildEnrollmentCoordinator.swift:9-16`);
recovery bodies match; protection-level enums match the backend set. iOS's
inbound decoder omits `receipts` (benign).

## 3. Assessment

- Contract shapes are **aligned** everywhere both sides are exercised; no
  field-name drift found.
- The gaps are **composition gaps, not contract gaps**: Android's transport
  exists but is not instantiated; iOS is missing outbound/status and never
  acks inbound messages (a delivery-semantics gap once sync is live).
- Neither client performs the invitation-state transitions the backend
  exposes for the continuation flow — the link-continuation UX and backend
  state machine are not wired together yet on either platform.
## 4. FINAL CROSS-ASSESSMENT UPDATE — API + PARENT/PLATFORM (2026-09-26)

Appended after the completed API assessment (`docs/pre_production_assessment/api/`).
Documentation-only: §1–§3 above are unchanged.

- ORIGINAL_FINDING = "contract shapes aligned everywhere both sides are exercised;
  no field-name drift; the gaps are composition gaps, not contract gaps" (§3).
- NEW_EVIDENCE = the API assessment's independent 16-call mobile↔API matrix
  (`api/08` + `api_mobile_contract_matrix.json`) verifies **zero drift** across Android
  and iOS (server routes, field shapes, auth, error surfaces); `api/14` records
  12 mobile findings CONFIRMED, 0 reclassified, 0 contradicted. The backend side of this
  report is now independently verified: iOS inbound-ack definition-without-call (MOB-009)
  and Android transport-not-composed (MOB-012) are corroborated (routes exist, are
  tested, and nothing contradicts the client-side state); iOS never calls
  outbound/status — matching the API matrix.
- SOURCE_ASSESSMENT = `api/08_MOBILE_CONTRACT_PARITY.md`, `api/14_API_TO_MOBILE_RECONCILIATION.md`.
- REVISED_DEPENDENCY = unchanged (ANDROID_API_DEPENDENCY / IOS_API_DEPENDENCY remain
  CONDITIONAL); the added **backend-side** dependencies are recorded in the findings
  register's cross-assessment block and mirror api findings F02–F08/F12.
- VERDICT_CHANGED = **NO**.