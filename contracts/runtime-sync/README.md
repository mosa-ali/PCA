# Offline-first runtime sync — logical contract

This directory defines the **logical**, representation-neutral contract
catalogue for the PCA-16 offline-first runtime sync layer described in
[architecture document 40](../../docs/architecture/40_OFFLINE_FIRST_RUNTIME_SYNC.md).
It is not an API specification, a wire format, or a cryptographic
implementation, and it follows the same conventions as the
[wellbeing-control contract](../wellbeing-control/README.md).

`catalogue.json` records: the five honest connection states and the rule
that `LIVE` requires both a connected transport and a recent successful
sync (never transport alone); the bounded reconnect-batch/backoff/retry
envelope every runtime (backend, Android, parent-sdk) independently
implements against; the message-priority tiers and their mapping from
existing `FamilyEnvelope.messageType` values (no new wire field); the
runtime-sync HTTP route surface and which routes require a device session;
and the E2EE boundary this layer must never cross (server decryption
forbidden, crypto suite pending human security review).

Run the self-contained validation suite with:

```powershell
node --test contracts/runtime-sync/test/*.test.cjs
```
