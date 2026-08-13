# PCA — Parental Control App

**Architecture package:** v1.0
**ARCHITECTURE_BASELINE:** `VERIFIED_COMPLETE` / `HISTORICAL_ACCEPTED` (the v1.0 document set; unchanged since acceptance)
**CURRENT_IMPLEMENTATION:** `ACTIVE` / `ADVANCED` — substantial, in-progress implementation now exists (backend, Android, and Parent Web most developed; iOS at an earlier stage). See `docs/architecture/30_IMPLEMENTATION_PROGRAMME.md` for exact per-phase `SOURCE_COMPLETE` / `VALIDATED_COMPLETE` / `PRODUCTION_READY` status, and `docs/architecture/00_DOCUMENT_CONTROL.md` Section 8A for what those three terms mean. (This field previously read `NOT_STARTED — implementation is authorized only for PCA-0`; that had gone stale and was corrected 2026-08-14 by realignment `PCA-DOC-REALIGN-1`. Source-code existing does not by itself mean any requirement is tested or production-ready — see the tiers above and the external gates in `docs/architecture/31_RISK_DECISION_REGISTER.md`.)

PCA is a privacy-first parental-control platform. The child device enforces policies, the parent device owns family activity data, and PCA infrastructure is limited to enrollment, licensing, updates, and privacy-preserving connectivity. PCA does not operate a readable central family-activity store.

## Architecture-first baseline

This repository's `docs/architecture/` package (docs 00–34) is the controlled architecture baseline that all implementation is built against. It defines:

- Android Standard and Protected/managed operating modes;
- iOS Family Controls, Managed Settings, and Device Activity limitations;
- end-to-end encrypted parent/child synchronization and recovery/trust epochs;
- locally controlled retention: 14 days, 1, 3, 6, or 9 calendar months;
- English and Arabic, with true RTL support and independently chosen parent/child languages;
- a new Platform Administration and Billing programme, specified but not yet implemented, in `docs/implementation/addenda/PCA_ADDENDUM_002_PLATFORM_ADMINISTRATION_BILLING.md`.

Implementation against this baseline is now underway (see `CURRENT_IMPLEMENTATION` above); the architecture package itself is not source code and remains the authority documents 00–34 describe. The owner accepted A-100 against technical baseline `fda523caacebec4ccc89df3073365d749946ae19`; that acceptance is a historical fact about the architecture *documentation* and is preserved unchanged. It is not, by itself, a claim that any specific implementation phase has been validated or is production-ready — see `docs/architecture/34_ARCHITECTURE_COMPLETION_GATE.md` for the corrected implementation-authorization state.

## Documentation

- [Architecture index](docs/architecture/README.md)
- [Executive architecture summary](PCA_ARCHITECTURE_MASTER_v1.0.md)
- [Document control](docs/architecture/00_DOCUMENT_CONTROL.md)
- [Security, privacy, and E2EE](docs/architecture/09_SECURITY_PRIVACY_E2EE.md)
- [Data model and retention](docs/architecture/10_DATA_MODEL_LOCAL_STORAGE.md) / [deletion](docs/architecture/11_DATA_RETENTION_DELETION.md)
- [Traceability matrix](docs/architecture/32_TRACEABILITY_ACCEPTANCE_MATRIX.md)
- [Primary-source register](docs/architecture/33_REFERENCE_SOURCES.md)
- [A-100 completion gate](docs/architecture/34_ARCHITECTURE_COMPLETION_GATE.md)

Read the architecture index first, then use the traceability matrix and source register when reviewing a requirement or platform claim.
