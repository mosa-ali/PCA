# 04 — Non-Functional Requirements

## Security

- **PCA-NFR-001** Encryption in transit for every service connection.
- **PCA-NFR-002** End-to-end encryption for parent-child family payloads.
- **PCA-NFR-003** Private keys generated/stored in platform secure key stores where supported.
- **PCA-NFR-004** Signed policy messages with anti-replay counters/nonces.
- **PCA-NFR-005** No hardcoded secrets or master decryption key.
- **PCA-NFR-006** Dependency and mobile supply-chain scanning before release.

## Privacy

- **PCA-NFR-010** Data minimization by default.
- **PCA-NFR-011** Central service cannot decrypt child activity payloads.
- **PCA-NFR-012** Telemetry must exclude URLs, location coordinates, app-usage history, face images and child content.
- **PCA-NFR-013** Retention enforcement is deterministic and testable.

## Reliability

- **PCA-NFR-020** Child enforcement continues offline for already-issued policies.
- **PCA-NFR-021** Parent UI distinguishes live, cached and unavailable data.
- **PCA-NFR-022** No silent fail-open for safety rules; degraded states are visible.
- **PCA-NFR-023** Emergency calls/SOS must not depend on PCA cloud availability.

## Performance and battery

- **PCA-NFR-030** Avoid continuous camera processing in the background.
- **PCA-NFR-031** Sensor and usage processing uses event-driven/batched designs.
- **PCA-NFR-032** Local filtering targets negligible user-perceived DNS latency.
- **PCA-NFR-033** Background work obeys Android/iOS platform scheduling constraints.

## Accessibility

- **PCA-NFR-040** Dynamic type/font scaling.
- **PCA-NFR-041** Screen-reader labels in Arabic and English.
- **PCA-NFR-042** Color is not the only status indicator.
- **PCA-NFR-043** RTL layouts pass mirrored-navigation testing.

## Maintainability

- **PCA-NFR-050** Policy/domain logic separated from OS-specific adapters.
- **PCA-NFR-051** Every requirement maps to tests.
- **PCA-NFR-052** Architecture decision records accompany material changes.
- **PCA-NFR-053** Content rules and AI models are versioned, signed and rollbackable.

## Trust

- **PCA-NFR-060** No hidden monitoring mode.
- **PCA-NFR-061** Privacy policy explains each permission and data path.
- **PCA-NFR-062** Parent can delete family monitoring history without contacting support.
- **PCA-NFR-063** Support staff cannot bypass E2EE to read family activity.
