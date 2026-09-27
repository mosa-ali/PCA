# 06 — API Policy Sync & Mobile Runtime

Evidence: `[READ]` source + deep-dive (`raw/subagent_policy_lifecycle.md`).

## 1. Policy write → relay → device drain → ack

- **Write path**: `POST /api/parent/families/:familyId/children/:childProfileId/schedule-policy`
  (`childPolicyRoutes.ts:136-139`) accepts an **opaque encrypted envelope**
  `{recipientDeviceId, ciphertextB64, nonceB64, keyEpoch}` (`:71-83`) —
  the server never parses policy content (`:15-27`). Auth: parent session
  cookie with family = path family (`:97-119`), CSRF (`:121-128`), actor device
  from a verified device session (`:121-134`), advisory `EDIT_CHILD_POLICY`
  (`:164-175`). Fails closed 503 if unwired (`:140-141`).
- **Storage**: `relay_envelopes` row, `state='QUEUED'`
  (`RelayService.ts:96`; `MySqlRelayRepository.ts:47-70`; schema
  `migrations/0001:221-240` — PK `message_id`, state CHECK
  `('QUEUED','ACKNOWLEDGED')`, **no message_type/version column**). HTTP answer
  is `202 {status:'PENDING', messageId}` (`childPolicyRoutes.ts:201`).
- **Delivery**: only via the device drain — `GET /v1/runtime-sync/inbound`
  (`runtimeSyncRoutes.ts:267-299`) → `InboundReconnectService.reconnectDrainForRecipient`
  (`:44-52`) → queued rows for the **verified session's deviceId**
  (`RelayService.ts:126-132`). There is **no fetch-by-version/cursor/read-back**
  (grep `cursor` in `backend/src` → unrelated only).
- **Ack**: `POST /v1/runtime-sync/inbound/:messageId/ack` — recipient-scoped
  from the verified session; `QUEUED→ACKNOWLEDGED` only where recipient
  matches and `expires_at > now`; already-ACKed is idempotent; foreign/unknown
  → indistinguishable 404 by design (`runtimeSyncRoutes.ts:301-322`;
  `MySqlRelayRepository.ts:116-138`; `RelayService.ts:18-20`).
- **Bounds**: outbound batch 25 (`OutboundRelayService.ts:61-66`); inbound list
  100 (`runtime-sync/policy.ts:28`) with `droppedForListBound` reported
  (`InboundReconnectService.ts:47`).
- **Isolation**: recipient resolved via family-scoped device lookup; foreign
  recipient → `CROSS_FAMILY_RECIPIENT` → `400 invalid_recipient`
  (`OutboundRelayService.ts:79-84`; `childPolicyRoutes.ts:190-192`).

## 2. Other protected payload surfaces

- **web-rules** (`webRuleRoutes.ts`): all three routes return
  `503 not_configured` in production — `buildServer.ts:657-663` intentionally
  omits `webRuleService`; the scaffold stores **readable domains** and is
  classified test-only under PCA-SEC-023 (`webRuleRoutes.ts:23-30`); no relay
  call exists in the file. (Defect API-F07.)
- **Retention**: delete-now intake returns `DELETE_PENDING_REMOTE_DEVICE`
  (`retentionRoutes.ts:29,283`) — the child-side acknowledgement flow "this
  route intentionally does not implement" (`:16-27`); retention window is
  validated-only, not persisted (`:43,225`).
- **protection-status** (`runtimeSyncRoutes.ts:337-360`): recorded under the
  session identity; drives `RealProtectiveAuthorityResolver`; not registered at
  all when the repository is absent (404, not 401) — verified by its suite.

## 3. Classification of the mobile "policy never applied" findings

The mobile assessment found: Android sync port always OFFLINE (not composed);
iOS pulls envelopes but `applyVerifiedPolicy` has no caller. API evidence:

- the server **does** deliver (queue → drain → ack) and is heavily tested
  (116/116 focused suite pass includes `runtimeSyncRoutes`), but it has
  **no read-back/version surface** to prove application beyond ack;
- ack reports delivery, not application; expiry silently drops rows from the
  inbox list (counted in `droppedForListBound` only).

```text
Root cause: COMPOSITION_ONLY (mobile clients) + server-side observability gap
(no version/read-back; API-F06). Not an API delivery defect.
```

## 4. Verdicts

```text
API_POLICY_SYNC      = PARTIAL
API_PROTECTION_PAYLOAD = PARTIAL  (schedule-policy: PASS-equivalent; web-rules: 503; versioning absent)
```
