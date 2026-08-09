# 28 — Test, QA and Security Validation Strategy

## 1. Test layers

### Unit
- policy evaluation;
- screen-time state machine;
- retention cut-offs;
- prayer calculations;
- RBAC;
- protocol validation;
- AI threshold mapping.

### Integration
- local database + retention cleanup;
- E2EE message round trips;
- relay offline queue/expiry;
- VPN/filter rule updates;
- Family Controls/Managed Settings adapters;
- Android usage/DPC adapters.

### Device/E2E
- real Android phones across major OEMs;
- iPhone/iPad supported versions;
- reboot/time change/offline cases;
- permissions revoked/regranted;
- app update/rollback;
- Arabic RTL flows.

## 2. Security tests

- key theft resistance within app threat model;
- replay/forged policy attempts;
- TLS/E2EE negative tests;
- lost-parent-device revocation;
- dependency/SBOM scan;
- static/dynamic mobile security review;
- external penetration test before production.

## 3. Privacy tests

Automated assertions that central-service events/logs never contain:
- URLs;
- coordinates;
- app history;
- face images;
- decrypted family payloads.

## 4. Retention tests

For every retention option:
- boundary exactly before/at/after expiry;
- daylight-saving/time-zone changes;
- device offline during expiry;
- queued encrypted replicas;
- delete-now;
- separate location retention.

## 5. AI tests

- curated age-appropriate evaluation sets;
- English/Arabic text cases;
- false-positive/negative measurement;
- threshold regression;
- model rollback;
- no raw evaluation user content collected from production by default.

## 6. Release gate

No release if:
- critical requirement has no test;
- high/critical security issue remains open;
- Arabic/RTL critical flow fails;
- retention deletion fails;
- platform capability is misrepresented;
- child emergency access is blocked.
