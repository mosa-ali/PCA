# PCA Architecture Master v1.0

This file is an index/summary. The controlled source is the complete set under `docs/architecture/`.

## Architecture statement

PCA is a bilingual Arabic/English parental-control platform with local family-owned monitoring data, E2EE parent-child synchronization and minimal central enrollment/licensing/relay infrastructure.

## Core decisions

1. No implementation before architecture acceptance.
2. Native Kotlin Android and Swift iOS.
3. Android has Standard and Protected/managed capability modes.
4. iOS uses Family Controls + Managed Settings + Device Activity and required entitlement.
5. Child activity is not stored readably on PCA central servers.
6. Parent-child payloads are end-to-end encrypted.
7. Data retention choices are 14 days, 1 month, 3 months, 6 months and 9 months; delete-now is mandatory.
8. Arabic RTL and English LTR are both release-blocking.
9. Deterministic web/security controls precede AI; AI runs on-device by default.
10. No hidden surveillance, covert TLS interception, face recognition or unsupported platform bypasses.
11. Emergency access and parent recovery always remain available.
12. Full URL/YouTube-history claims are limited to data legitimately available; YouTube Data API does not expose watch history.

See `docs/architecture/README.md` for the full 35-document controlled architecture set.
