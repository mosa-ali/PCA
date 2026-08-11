# 36 — Parent-Controlled Wellbeing Message Policy

Owning agent: **PCA-CLAUDE-8-WELLBEING-PARENT-CONTROL**. This document specifies the canonical parent-authored wellbeing-message policy domain: what a parent may configure, how it is validated client-side, and how it crosses the family privacy boundary. It does not define endpoints, a wire serialization, a cryptographic suite, or an Android/UI implementation — those remain the authority of doc 22, doc 09, and the owning Android/web agents respectively.

## 1. Scope and relationship to WELL-1

WELL-1 (owned by the Android `feature/wellbeing` track) is the on-device presentation and scheduling *engine* for wellbeing messages. This document defines the *parent authoring and control* domain that produces the policy WELL-1 consumes: which curated suggestions are active, what custom family messages exist, and under what conditions each may appear. It aligns terminology (categories, triggers) with WELL-1 so the two remain a single logical vocabulary, but it does not modify WELL-1's runtime engine, scheduling clock, or persistence.

This document does not grant enforcement authority to any trigger or delivery surface named here — a receiving device independently verifies FTS authorization, target membership, and its own local scheduling state before presenting anything (doc 09, doc 22 §1, PCA-API-001).

## 2. Privacy boundary — no central plaintext

PCA-WELLCTRL-001: parent-authored custom message text (title, body, any language variant) is **family plaintext**. It MUST NOT require a readable central (MySQL / service-side) store at any point in its lifecycle. The client domain defined here (`parent-sdk/wellbeing-control`) produces a canonical payload suitable only for encapsulation inside the existing family envelope (doc 22 §3, doc 09 §4).

PCA-WELLCTRL-002: the service/Relay control plane sees only opaque envelope metadata and ciphertext for this message class, consistent with doc 22 §1's plane separation. It never receives message text, family schedule detail, faith-category preference, or target meaning.

PCA-WELLCTRL-003: no MySQL table is introduced for custom message plaintext, and no existing schema owned by another agent is modified by this domain. If a future operational relay needs metadata (e.g. delivery receipts), it reuses the existing encrypted family envelope / relay architecture — this document does not define a new one.

## 3. Contract version — `WellbeingMessageControlV1`

PCA-WELLCTRL-010: the canonical contract is versioned (`version = 1`). Required top-level concepts:

| Field | Purpose |
|---|---|
| `version` | Fixed `1` for this contract generation. |
| `policyId` | Opaque identifier for one family's wellbeing-control policy. |
| `policyRevision` | Strictly monotonic integer revision (§8). |
| `familyScopeRef` | Opaque reference to the owning family; not a readable central identifier. |
| `targets` | Which children the policy's messages may reach (§4). |
| `enabled` | Master on/off for the policy. |
| `selectedCuratedSuggestionIds` | Enable/disable state for PCA-curated suggestions, referenced by stable `suggestionId` (§6). |
| `customMessages` | Parent-authored custom messages (§5). |
| `createdAt` / `updatedAt` | Timestamps for the policy document. |

PCA-WELLCTRL-011: child display names are never used as cross-boundary identifiers anywhere in this contract. All target and actor references are opaque IDs (`familyMemberId`-shaped), consistent with doc 22's "opaque identifier" convention.

## 4. Target model

PCA-WELLCTRL-020: a policy or an individual custom message targets exactly one of:

- `ONE_CHILD` — a single opaque profile ID.
- `MULTIPLE_CHILDREN` — a non-empty set of opaque profile IDs.
- `ALL_CHILDREN` — every child currently in family scope, resolved at delivery time, not baked into the policy document.

PCA-WELLCTRL-021: this contract performs no server-side target authorization. It is a client-side authoring/validation domain only. The receiving parent/child endpoint that later applies a policy MUST independently verify family membership, FTS authority, and target-profile membership at runtime (doc 09, doc 22 §1) before any message is scheduled or shown. Nothing in this document may be read as granting that authority.

## 5. Custom message model

Each parent-authored custom message carries: `messageId`, `enabled`, `category`, `languageTexts`, optional `startDate`/`endDate`, `daysOfWeek`, `timeWindows`, `triggers`, `minimumIntervalMinutes`, `maximumPerDay`, `repeatCooldownMinutes`, `lockScreenAllowed`, `dismissible`, `snoozable`, `requiresAdultSupervision`, optional `archivedAt`.

### 5.1 Language text

PCA-WELLCTRL-030: `languageTexts` is an explicit map keyed by language tag (at minimum `en`, `ar`). A parent may supply one or both. The domain never auto-translates and never invents translated religious/custom text (§7 category note). When a child's preferred language has no parent-authored translation, that is a rendering-layer decision (show original with language metadata, or suppress per parent policy) — out of scope here, but the contract carries enough metadata (which languages exist) for that decision to be made correctly downstream.

### 5.2 Categories

PCA-WELLCTRL-031: supported categories, aligned with WELL-1: `SKILLS_AND_LEARNING`, `READING`, `FAITH_POSITIVE`, `GRATITUDE`, `GOOD_DEED`, `FAMILY_HELP`, `HOME_RESPONSIBILITY`, `CREATIVITY`, `MOVEMENT_RESET`, `REST_AND_RESET`, `OUTDOOR_OR_OFFSCREEN`, `PLANNING_AND_ORGANIZATION`, `CUSTOM`.

### 5.3 Triggers

PCA-WELLCTRL-032: supported triggers: `PERIODIC`, `AFTER_UNLOCK`, `RAPID_GAME_RETURN`, `BREAK_STARTED`, `BREAK_ACTIVE`, `BREAK_COMPLETED`, `LONG_SESSION_ENDED`, `SCHEDULED_TIME`, `CHILD_REQUESTED_IDEA`. A trigger name alone confers no enforcement or delivery authority (§4, §6.1).

### 5.4 Length bounds

PCA-WELLCTRL-033: title ≤ 60 characters, body ≤ 240 characters per language variant, enforced by client-side validation (§7). This keeps messages sized for a small card and prevents essay-length notifications.

## 6. Delivery model

### 6.1 Permitted surfaces

PCA-WELLCTRL-040: only these ordinary delivery surfaces are defined: `IN_APP_SMALL_CARD`, `STANDARD_NOTIFICATION`, `LOCK_SCREEN_REDACTED`, `NEXT_UNLOCK_SMALL_CARD`, `BREAK_SHIELD_OPTIONAL_CARD`.

PCA-WELLCTRL-041: this contract does not define, and validation MUST reject configurations that imply, a full-screen ordinary wellbeing message, a system lock-screen replacement, or any surface impersonating a system security alert. Ordinary wellbeing content is never full-screen.

### 6.2 Curated selection

PCA-WELLCTRL-042: parents reference PCA-curated suggestions by stable `suggestionId` rather than duplicating curated prose into family policy. This allows the PCA catalogue to update independently of family policy documents. A parent who wants a modified version creates an explicit custom message copy (§5) rather than mutating curated content in place.

## 7. Client-side mechanical safety validation

PCA-WELLCTRL-050: custom message text is mechanically validated client-side before it may enter a policy. At minimum, the validator rejects: blank text, over-length text (§5.4), control characters, bidirectional-override abuse, HTML/script-like markup, and text patterns impersonating an operating-system security alert.

PCA-WELLCTRL-051: this mechanical validation is a safety floor only. It cannot and does not determine moral, religious, or developmental appropriateness of parent-authored content — that judgment remains with the parent.

## 8. Frequency and schedule validation

PCA-WELLCTRL-060: frequency fields (`minimumIntervalMinutes`, `maximumPerDay`, `repeatCooldownMinutes`) are validated against product-safe bounds. Zero-second cooldowns, unbounded daily counts, and effectively-permanent repeated alerts are rejected. This contract intentionally provides no "nag intensity" control — frequency safety bounds are not a tunable escalation dial.

PCA-WELLCTRL-061: schedule fields (`startDate`/`endDate`, `daysOfWeek`, `timeWindows`) are validated for date ordering, time-window ordering including midnight-crossing windows, non-empty day sets where required, and (where a timezone identifier is present) syntactic validity. These fields describe presentation-window scheduling only; they are not used for rapid-return elapsed-time computation, which is WELL-1 runtime-clock territory and must use monotonic/wall-clock handling appropriate to that engine, not this contract.

## 9. Adult supervision

PCA-WELLCTRL-070: `requiresAdultSupervision` is semantically enforced, not decorative. When `true`:

- `lockScreenAllowed` MUST be `false`.
- Unattended standard-notification delivery MUST be rejected by client-side validation.

PCA-WELLCTRL-071: this is defense-in-depth only. The final Android integration independently re-enforces the same rule at delivery time; this contract's validation does not substitute for that runtime check.

## 10. Revision and idempotency model

PCA-WELLCTRL-080: `policyRevision` is strictly monotonic. The domain implements: stale-update rejection (an update whose `expectedRevision` does not match current state is refused), duplicate/idempotent operation handling (a replayed `operationId` is a no-op, not a double-apply), and acceptance of a genuinely newer revision. Localized text is never used as revision identity — only the integer revision counter is authoritative.

## 11. Command model

PCA-WELLCTRL-090: parent operations are represented as discrete commands: `CREATE_CUSTOM_MESSAGE`, `UPDATE_CUSTOM_MESSAGE`, `ARCHIVE_CUSTOM_MESSAGE`, `RESTORE_CUSTOM_MESSAGE`, `ENABLE_CURATED_MESSAGE`, `DISABLE_CURATED_MESSAGE`, `UPDATE_DELIVERY_POLICY`, `UPDATE_TARGETS`. Each command carries `operationId`, `expectedRevision`, `newRevision`, `actorMemberId`, and a target scope. This contract stops at command validation and revision-guarded application to a local policy document; actual FTS-authorized-actor verification belongs to trusted endpoint integration (§4, PCA-API-001), performed later by the coordinator-wired runtime.

## 12. Audit representation

PCA-WELLCTRL-100: an E2EE family audit record is produced per applied command, containing: action type, opaque actor, opaque target, `messageId` (where applicable), `policyRevision`, timestamp, `operationId`. Full custom-message prose is not copied into the audit record — audit entries carry metadata only, consistent with §2's plaintext-minimization principle.

## 13. Preview model

PCA-WELLCTRL-110: a UI-independent preview model exists for each delivery surface family: `IN_APP_SMALL_CARD`, `STANDARD_NOTIFICATION`, `LOCK_SCREEN_REDACTED`, plus locale-oriented previews `ARABIC_RTL` and `ENGLISH`. The public/lock-screen preview defaults to a generic, non-revealing presentation; it MUST NOT include private custom-message text unless the parent has explicitly selected a platform-supported private presentation and the previewing context is authorized to show it. This mirrors §9's supervision handling: redaction is the default, not an opt-out.

## 14. Child-dignity constraints

PCA-WELLCTRL-120: this domain supports parent guidance only. It does not introduce, and validation must not be extended to accommodate, coercive or dark-pattern features: forced devotional completion, forced exercise, body/weight targets, shaming metrics, leaderboards, or punitive streaks. A future change proposing any of these requires an explicit owner decision and a doc 24 (threat model / abuse cases) review before implementation.

## 15. Non-goals

This document does not select a production signature/AEAD algorithm, does not define a wire serialization for transport (only a deterministic canonical form for signing/hashing consistency, per doc 22's neutral-representation posture), does not perform server-side authorization, and does not modify WELL-1's Android runtime, Agent 7's parent-web UI, or Agent 6's MySQL schema.

## 16. Implementation surface

- `contracts/wellbeing-control/` — logical, representation-neutral contract catalogue and validator (mirrors the `contracts/` foundation pattern used for the family envelope in doc 22).
- `parent-sdk/wellbeing-control/` — standalone TypeScript parent-domain package: types, validators, canonical serialization, command builder, policy editor service, revision guard, preview model builder, and a `WellbeingMessageAdminClient` interface for Agent 7's parent-web UI to consume (initially via a mock implementation).
