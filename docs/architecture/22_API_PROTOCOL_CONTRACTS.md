# 22 — Logical API and Protocol Contracts

These are architecture-level contracts, not endpoint implementation.

## 1. Central service API groups

### Enrollment
- create/redeem short-lived invite;
- register device public key;
- confirm pairing;
- revoke device.

### License
- subscription status;
- device allowance;
- entitlement/version metadata.

### Software/rules
- signed release metadata;
- signed filtering/model package metadata;
- rollout/rollback channel.

### Relay
- register routing presence;
- submit encrypted envelope;
- retrieve/ack encrypted envelope;
- expire undelivered envelope.

No central history/report API returns readable child activity.

## 2. E2EE family message types

- `POLICY_UPDATE`
- `POLICY_RECEIPT`
- `STATUS_SNAPSHOT`
- `ACTIVITY_SUMMARY`
- `LOCATION_RESPONSE`
- `CHILD_REQUEST`
- `PARENT_DECISION`
- `TAMPER_ALERT`
- `RETENTION_RECEIPT`
- `DEVICE_REVOKE`
- `KEY_ROTATION`

## 3. Versioning

Protocol messages include major/minor schema version. Child device rejects incompatible major versions and reports upgrade-required state.

## 4. Idempotency

Policy/update operations use unique message IDs and monotonic policy versions so retries do not duplicate actions.

## 5. Authorization

Central enrollment authorization and family-message authorization are separate. Possessing a service account token never grants ability to forge a family policy without authorized family cryptographic material.
