# 05 — API Device Proof & Crypto Boundary

Evidence: `[READ]` source + deep-dive (`raw/subagent_enrollment_proof.md`);
directly confirmed wiring in `backend/src/main.ts` (this session).

## 1. Challenge → session mechanics (server)

- `POST /v1/runtime-sync/devices/:deviceId/challenge` — unauthenticated by
  design (`runtimeSyncRoutes.ts:205-221`); unknown/revoked devices receive a
  **synthesized nonce** so the route is not an enumeration oracle
  (`DeviceSessionService.ts:57-86`). Nonce = 32 CSPRNG bytes (43-char base64url,
  `nonce.ts:3-14`), **TTL 60 s** (`deviceauth/policy.ts:7`).
- `POST …/session` — shape `challengeId` ≤128 + `signature` ≤4096
  (`runtimeSyncRoutes.ts:227`); `DeviceAuthService.verifyChallenge` checks:
  exists → not consumed → not expired → device exists/not revoked → **DSK ACTIVE
  only** → signature over the nonce via `signatureVerifier.verify(dsk.publicKey,
  challenge.nonce, signature)` (`:116-135`); failure is a collapsed
  `401 {error:'unauthorized'}` (`DeviceSessionService.ts:90-93`).
  Single-use consume is a conditional UPDATE
  (`MySqlDeviceChallengeRepository.ts:56-63`); replay losers get
  `ALREADY_CONSUMED`/`EXPIRED` (`:77-78`).

## 2. The production verifier — deliberately rejecting

- **Production wires `RejectingDeviceSignatureVerifier`** (unconditionally
  returns `false`) at `main.ts:363`, with an in-source comment:
  `PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW … Device-session
  issuance is correctly, intentionally non-functional until a reviewed
  verifier replaces this.` Confirmed by direct read this session.
- The **real P-256 verifier exists in source**
  (`deviceauth/P256DeviceSignatureVerifier.ts:13-35`) but is **not composed**
  anywhere in `main.ts`/routes (tests only) — gated on PCA-DEC-020.
- Net effect: **no device can obtain a session on api.pcasafe.com today**,
  independent of the mobile clients' own crypto gates. The mobile assessment
  saw only the client half; this server half is new evidence (report 14).

## 3. Crypto gates wired in production (all fail-closed)

| Gate | Wiring | Refuses | Caller-visible result |
|---|---|---|---|
| `RejectingDeviceSignatureVerifier` | `main.ts:363` (session), `:779` (signed remote decisions) | every device signature | 401 `unauthorized` / 403 `INVALID_SIGNATURE` (`removalDecisionRoutes.ts:108-110`) |
| `RejectingEnvelopeSignatureVerifier` | `main.ts:389` | every family envelope signature | receipt reason `INVALID_SIGNATURE` (`FamilyEnvelopeVerifier.ts:255-257`) |
| `rejectingResolveEnvelopeContext` | `main.ts:918` | all envelopes at `STALE_TRUST_SET_EPOCH` | receipt channel |
| `RejectingOpaqueProtectionAlertComposer` / rejecting family-audit composer | `main.ts:720-771` | opaque alert/audit envelope composition | nothing persisted (audit kept honest by absence) |
| `UnavailableTrustSetRoleResolver` | `main.ts` (parent-action matrix) | trust-set-derived role claims | `NO_TRUST_SET` denials |
| `P256DeviceSignatureVerifier` | **not composed** | — | source-only, gated |

## 4. Negative checks (explicit)

- **No unsigned acceptance** where signatures are expected: the session route
  requires a signature before any verification (`runtimeSyncRoutes.ts:227`);
  signed removal requires a signature string and fails closed
  (`removalDecisionRoutes.ts:333`); the PIN path is a separate, deliberate
  `RemovalDecisionAuthority` authority (`:461-483`), not an unsigned backdoor.
- **No fail-open fallback**: rejecting verifiers hard-return false; catches
  collapse/refuse (`DeviceSessionService.ts:90-93`; `bootstrapRoutes.ts:94-99,141-143`).
- **No env bypass** for any verifier
  (grep `process.env.PCA_*(CRYPTO|SIGNATURE|VERIFIER|PROOF)` → 0 matches).
- **No fake/test production crypto**: no verifier "accepts" in production; no
  key material is fabricated.
- **Server-side policy decrypt is not composed at all**
  (`ReceiverPipeline`/`FdekDecryptor`/`decryptPayload` → 0 instantiations);
  decrypt interfaces are documented `WAITING_HUMAN_SECURITY_REVIEW`
  (`ReceiverPipeline.ts:26-56`).

## 5. Verdicts

```text
API_DEVICE_PROOF = DELIBERATELY_GATED   (machinery real + tested; verifier intentionally rejecting)
API_CRYPTO       = FAIL_CLOSED_PENDING_APPROVAL  (no fail-open, no fake success, no unsigned path)
```

This matches the mobile assessment's fail-closed posture and closes the loop:
the gate is *bilateral* (client + server), and the exit is a single external
dependency — the human crypto review — plus the wiring work in API-F02/F03
(report 12).
