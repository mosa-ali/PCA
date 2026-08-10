# PCA — Parental Control App

**Architecture package:** v1.0
**Lifecycle:** `VERIFIED_COMPLETE`
**Implementation status:** `NOT_STARTED` — implementation is authorized only for PCA-0 repository and quality foundation.

PCA is a privacy-first parental-control platform. The child device enforces policies, the parent device owns family activity data, and PCA infrastructure is limited to enrollment, licensing, updates, and privacy-preserving connectivity. PCA does not operate a readable central family-activity store.

## Architecture-first baseline

This repository currently contains architecture documentation only. It defines, but does not implement:

- Android Standard and Protected/managed operating modes;
- iOS Family Controls, Managed Settings, and Device Activity limitations;
- end-to-end encrypted parent/child synchronization and recovery/trust epochs;
- locally controlled retention: 14 days, 1, 3, 6, or 9 calendar months;
- English and Arabic, with true RTL support and independently chosen parent/child languages.

The owner accepted A-100 against technical baseline `fda523caacebec4ccc89df3073365d749946ae19`. This does not authorize PCA-1 or later: the only granted source phase is PCA-0 repository and quality foundation.

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
