# 23 — AI Architecture and Model Governance

Owning agent: **PCA-DOC-F**. AI is a constrained assistive component, never the source of parent authority, cryptographic trust, retention decisions, or a claim of complete protection.

## 1. Decision hierarchy and permitted use

PCA-AI-001: deterministic platform and parent decisions take precedence in this order: (1) legal/platform and explicit parent policy, (2) signed allow/deny/block rules, (3) deterministic safety heuristics, (4) local model output for an explicitly supported ambiguous input, then (5) an optional separately approved remote service. A model MUST NOT silently override an explicit parent allowlist for ordinary content; it may raise a review signal where product policy permits.

Initial permitted local use cases are limited to category/risk scoring inside PCA-controlled surfaces (Safe Browser text/page signals, phishing/scam supplementary signal), and eye-distance calibration from transient face landmarks where doc 13 allows it. Face identity recognition, biometric template creation, emotion/personality inference, child profiling, background capture, and inference from content PCA does not control are prohibited.

## 2. Data boundary and runtime architecture

Android uses a reviewed LiteRT-compatible/ML Kit capability; iOS uses reviewed Core ML/Vision capability where platform support permits. Input stays in the originating process/device. Frames and landmarks used for eye-distance are transient, are not serialized into family envelopes, and are discarded after the local computation. Inference result sent to another family device, if any, is treated as family activity content: it is encrypted using doc 09 and retention-scoped by doc 11. PCA infrastructure receives neither raw input nor readable result.

Cloud inference is `REQUIRES_FURTHER_OWNER_DECISION` and is not part of initial release. It needs a separate owner-approved privacy impact assessment, data-flow diagram, age/guardian consent review, data-processing terms, opt-in that is not bundled with family enrollment, a no-training-by-default guarantee, retention/deletion contract, and an independently testable local-only fallback. It cannot be enabled simply because a model performs poorly locally.

## 3. Model package contract

Every model, ruleset, or threshold bundle is a signed release artifact with:

- immutable `modelId`, version, format/runtime compatibility and supported locales;
- purpose, in-scope input surface and explicit prohibited uses;
- source/license and training/evaluation provenance; dataset rights and child-data exclusion statement;
- target labels, calibration/threshold version, expected latency/memory limits;
- disaggregated false-positive/false-negative evidence appropriate to supported languages and relevant age context, including Arabic where claimed;
- privacy impact, bias/safety review, red-team findings and residual-risk acceptance;
- hash/signature, signing key ID, release channel/percentage, expiry, rollback target, and kill-switch behavior.

PCA-AI-002: model updates are verified before activation, staged, reversible, and must not make a network call to function. A signature/hash failure, unsupported runtime, or failed self-test retains the previous known-good artifact or deterministic-only behavior; it is never silently replaced from an unverified origin.

## 4. Human and policy governance

| Decision | Required owner | Evidence |
|---|---|---|
| New AI use case or new data class | Product, privacy, security and child-safety approval | Purpose/necessity, data-flow, threat/abuse assessment. |
| Threshold or label change | Safety owner plus product owner | Evaluation delta, false-positive/negative impact and rollout plan. |
| Remote inference | Explicit owner decision after privacy review | Consent UX, processor boundary, deletion/opt-out and fallback proof. |
| Emergency disable/rollback | Incident/release owner | Signed rollback, incident record, regression test before re-enable. |

Model outputs are explainable at the level appropriate for a parent/child: e.g. “PCA Safe Browser blocked this page under the parent’s category rule” rather than asserting a psychological conclusion. A child can request review through the documented child-request path; an AI score itself is not an irreversible punishment.

## 5. Evaluation and monitoring

Pre-release evaluation uses lawfully sourced, non-production test data and documented annotation rules. Production family activity is never default training/evaluation data. Telemetry is opt-in where it could identify a family, must satisfy doc 09’s server-knowledge boundary, and reports only minimum aggregate operational measures. No raw image, page text, URL, face-frame, or child identity is sent for routine model tuning.

Release gates: evaluate adversarial/ambiguous inputs; test English and Arabic assertions when those are supported; measure false blocks and misses; test all policy precedence cases; inspect package provenance; and test rollback. A model may be withdrawn if harm, unacceptable disparity, security compromise, or platform-policy conflict is discovered; deterministic controls remain available.

## 6. Tests and prohibited claims

- [ ] Explicit allow/deny and platform policy prevail over AI output in every precedence permutation.
- [ ] Airplane-mode inference works for every promised local feature; no raw input leaves device in network capture/log inspection.
- [ ] Frame/landmark lifecycle test proves no persistence, envelope serialization, backup, screenshot diagnostic, or telemetry path.
- [ ] Tampered, expired, incompatible, and rollback model packages fail closed to prior known-good/deterministic mode.
- [ ] Evaluation includes adversarial prompts/pages, low-confidence boundaries, Arabic/RTL inputs where supported, and no identity/emotion/profile output.
- [ ] Cloud capability remains unavailable unless all Section 2 decision artifacts are approved and tested.

PCA does not claim that an AI classifier understands intent, detects every harmful item, supplies medical advice, identifies a child, or replaces parent judgment.

## 7. Source handoff and dependencies

`SRC-H-F-026`: Google [LiteRT](https://ai.google.dev/edge/litert), verified 2026-08-10; `SRC-H-F-027`: Google [ML Kit face detection](https://developers.google.com/ml-kit/vision/face-detection), verified 2026-08-10; `SRC-H-F-028`: Apple [Core ML](https://developer.apple.com/documentation/CoreML), verified 2026-08-10. These primary-source handoffs establish on-device framework availability, not permission to perform identity recognition or remote collection; doc 33 should register them.

Docs 09/10/11 govern encryption, local data and retention; docs 13/14 govern the feature inputs; doc 24 governs abuse cases; docs 28/29 govern validation and release/rollback. Development-agent model selection is outside PCA runtime architecture and does not authorize any production data flow.
