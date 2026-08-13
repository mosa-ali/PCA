# PCA Architecture Master v1.0

**Package:** v1.0 · **ARCHITECTURE_BASELINE:** `VERIFIED_COMPLETE` / `HISTORICAL_ACCEPTED` (the v1.0 document set itself; unchanged since acceptance) · **CURRENT_IMPLEMENTATION:** `ACTIVE` / `ADVANCED` (substantial, in-progress build-out against this baseline is now underway across backend, Android, Parent Web, and — to a lesser extent — iOS; see `docs/architecture/30_IMPLEMENTATION_PROGRAMME.md` for the phase-by-phase `SOURCE_COMPLETE` / `VALIDATED_COMPLETE` / `PRODUCTION_READY` status).

This "Implementation" field previously read `NOT_STARTED; PCA-0 only is authorized`. That is now out of date and has been corrected as part of a controlled documentation-realignment pass (`PCA-DOC-REALIGN-1`, 2026-08-14): implementation has progressed well past PCA-0 in several domains. Correcting this field is a status-accuracy fix, not a re-acceptance of the architecture baseline and not a new implementation authorization — see the unchanged acceptance record in Section "Assurance and next gate" below, which is preserved verbatim.

This is the executive navigation summary. The controlled detail is the 35-document set in [docs/architecture/README.md](docs/architecture/README.md); it must be read before implementation or product commitments.

## System boundaries and platform reality

PCA is an Arabic/English parental-control platform. Family activity is encrypted and controlled by family devices; PCA services provide enrollment, licensing, opaque rendezvous/relay, and minimal operational metadata only. Android Standard Mode is deliberately capability-limited; stronger controls require the documented managed/Device Owner path. iOS relies on entitled Family Controls, Managed Settings, and Device Activity, which expose opaque selections and do not make PCA a universal system controller.

## Trust, data, and lifecycle

The design separates device signing, device key-agreement/encryption, random family data encryption keys, and recovery material. A signed Family Trust Set and key epochs define enrollment, revocation, offline convergence, replacement-parent recovery, and the non-retroactive limit for compromised offline devices. PCA has no support or administrator decryption bypass. Local monitoring retention is 14 exact days or 1/3/6/9 calendar months, with delete-now, synchronization tombstones, export/backup disclosures, and no forensic-erasure promise.

## Protection and family experience

The package specifies screen-time breaks with an immutable emergency floor; sensor-first eye-distance protection with foreground/capability-gated camera use; layered deterministic web controls before optional on-device AI; bounded YouTube visibility; location/last-seen disclosure; offline prayer calculation; family RBAC; transparent notifications; and independently selectable English/Arabic interfaces with true RTL, bidi, accessibility, charts, and child-facing transparency.

## Assurance and next gate

Threat modeling, policy/store compliance, zero-plaintext observability, test planning, future implementation phases, exact-ID traceability, and first-party source references are documented. The owner accepted `A-100` against `fda523caacebec4ccc89df3073365d749946ae19`; the acceptance does not authorize PCA-1 or later implementation phases.
