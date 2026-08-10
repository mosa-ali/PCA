# PCA Architecture Master v1.0

**Package:** v1.0 · **Lifecycle:** `VERIFIED_COMPLETE` · **Implementation:** `NOT_STARTED`; PCA-0 only is authorized.

This is the executive navigation summary. The controlled detail is the 35-document set in [docs/architecture/README.md](docs/architecture/README.md); it must be read before implementation or product commitments.

## System boundaries and platform reality

PCA is an Arabic/English parental-control platform. Family activity is encrypted and controlled by family devices; PCA services provide enrollment, licensing, opaque rendezvous/relay, and minimal operational metadata only. Android Standard Mode is deliberately capability-limited; stronger controls require the documented managed/Device Owner path. iOS relies on entitled Family Controls, Managed Settings, and Device Activity, which expose opaque selections and do not make PCA a universal system controller.

## Trust, data, and lifecycle

The design separates device signing, device key-agreement/encryption, random family data encryption keys, and recovery material. A signed Family Trust Set and key epochs define enrollment, revocation, offline convergence, replacement-parent recovery, and the non-retroactive limit for compromised offline devices. PCA has no support or administrator decryption bypass. Local monitoring retention is 14 exact days or 1/3/6/9 calendar months, with delete-now, synchronization tombstones, export/backup disclosures, and no forensic-erasure promise.

## Protection and family experience

The package specifies screen-time breaks with an immutable emergency floor; sensor-first eye-distance protection with foreground/capability-gated camera use; layered deterministic web controls before optional on-device AI; bounded YouTube visibility; location/last-seen disclosure; offline prayer calculation; family RBAC; transparent notifications; and independently selectable English/Arabic interfaces with true RTL, bidi, accessibility, charts, and child-facing transparency.

## Assurance and next gate

Threat modeling, policy/store compliance, zero-plaintext observability, test planning, future implementation phases, exact-ID traceability, and first-party source references are documented. The owner accepted `A-100` against `fda523caacebec4ccc89df3073365d749946ae19`; the acceptance does not authorize PCA-1 or later implementation phases.
