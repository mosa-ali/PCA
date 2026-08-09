# 00 — Document Control and Governance

## 1. Purpose

This document defines how PCA architecture is controlled before and during implementation.

## 2. Authority order

1. Owner-approved product decisions.
2. This architecture package.
3. Official Android/Apple/store/API documentation.
4. Approved implementation specifications derived from this package.
5. Source code and tests.

If source code later conflicts with an approved requirement, the conflict must be resolved explicitly; code does not silently redefine the architecture.

## 3. Architecture-first freeze

Until `A-100 DOCUMENTATION ACCEPTED`:

- no production Android/iOS project initialization;
- no backend implementation;
- no production schemas/migrations;
- no cloud resources;
- no AI model binary integration;
- no release pipelines;
- no app-store submissions.

Documentation, diagrams, decision records and read-only feasibility research are allowed.

## 4. Versioning

- Architecture major version: breaking product/security/privacy decisions.
- Minor version: additive requirements or clarified designs.
- Patch version: editorial or source-reference updates with no requirement change.

Current package: **v1.0**.

## 5. Change control after approval

Every material architecture change must include:

- change identifier;
- reason;
- affected requirement IDs;
- privacy/security impact;
- Android/iOS capability impact;
- migration impact if implementation already exists;
- owner approval state.

## 6. Documentation quality rule

No `TBD`, unresolved placeholder, fabricated platform capability or unsupported claim may be accepted as complete. External approval dependencies (for example Apple entitlement approval) may remain external dependencies, but the architecture must define exactly what happens if approval is unavailable.

## 7. Source freshness

Platform-dependent sources are revalidated:

- before implementation of the relevant phase;
- before public beta;
- before store submission;
- after major Android/iOS policy changes.
