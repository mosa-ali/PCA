# 23 — AI Architecture and Model Governance

## 1. Principle

AI is a **secondary decision layer**, not the first or only safety control.

Order of precedence:
1. platform/parent policy;
2. deterministic security/content rules;
3. allow/deny overrides;
4. on-device AI for ambiguous supported content;
5. optional cloud AI only with explicit parent opt-in and a separate privacy review.

## 2. On-device inference

### Android
Use LiteRT-compatible models and/or ML Kit for supported vision tasks. Sensitive inference inputs stay on-device.

### iOS
Use Core ML/Vision for on-device inference where appropriate.

## 3. AI use cases

- image/content category classifier inside PCA-controlled content surfaces;
- text/page risk signals inside PCA Safe Browser;
- phishing/scam heuristics as supplementary signal;
- face landmark detection for approximate foreground eye-distance calibration without face recognition.

## 4. Prohibited AI behavior

- facial identity recognition;
- emotion/personality profiling of children;
- training company models on family activity without separate explicit consent and governance;
- uploading child browsing/images by default;
- using orientation/identity as a “harmful” category;
- unreviewed AI automatically overriding explicit parent allowlists for ordinary content.

## 5. Model package governance

Each model has:
- model ID/version;
- source/license;
- training/evaluation provenance;
- supported locales;
- threshold configuration;
- false-positive/false-negative evaluation;
- signed checksum;
- rollout percentage;
- rollback target;
- privacy impact record.

## 6. Development AI

For engineering after architecture approval, use an orchestrated agent model. Current OpenAI documentation recommends GPT-5.6 Sol for complex reasoning/coding. AI-generated implementation must still be independently reviewed, tested on devices and checked against this requirement traceability matrix.
