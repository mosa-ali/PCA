# 27 — Observability and Support Without Central Child-Activity Collection

## 1. Operational telemetry allowed

- app version;
- OS/device model class;
- crash signature with redacted context;
- service latency/error code;
- enrollment state transitions;
- rule/model package version;
- aggregate non-sensitive health metrics.

## 2. Telemetry forbidden by default

- URLs/domains tied to a child;
- precise location;
- app-use history;
- child names in logs where avoidable;
- face/camera images;
- content screenshots;
- private encryption keys;
- decrypted E2EE payloads.

## 3. Support bundle

Parent may explicitly generate a redacted diagnostic bundle containing:
- app/OS versions;
- permission/capability states;
- recent non-sensitive error codes;
- policy version hashes;
- connectivity diagnostics.

Before sharing, the UI shows exactly what will be included.

## 4. Audit

Family-sensitive audit records remain encrypted/local/E2EE to family devices. Service operator audit covers administrative access to enrollment/license metadata.
