import type { MessageId } from '../types.js';

/**
 * English source strings. Reuses the exact wording already accepted in web/WebFilterEngine.ts's
 * REASON_CODES and ai/policy.ts's EXPLANATION_LABELS (kept word-for-word so no behavioral
 * meaning drifts between the frozen source module's own English text and this presentation-layer
 * table) plus one new placeholder-bearing message.
 */
export const EN_MESSAGES: Record<MessageId, string> = {
  SECURITY_DENYLIST: 'blocked by a security threat rule',
  PARENT_ALLOWLIST: "allowed by your family's allow list",
  PARENT_DENYLIST: "blocked by your family's block list",
  CATEGORY_RULE: "blocked by your family's content category rule",
  SCHEDULE_RULE: "blocked by your family's schedule rule",
  CLASSIFIER: "blocked by your family's explicit-content rule",
  DEFAULT: 'no matching rule; allowed by default',
  CATEGORY_RULE_MATCHED: "blocked under your family's category rule",
  SUPPLEMENTARY_RISK_SIGNAL: 'flagged by a supplementary risk signal for parent review',
  MODEL_UNAVAILABLE: 'on-device analysis was unavailable for this item',
  CONFIDENCE_BELOW_THRESHOLD: 'signal confidence was below the configured threshold',
  DOMAIN_BLOCKED_NOTICE: '{domain} was blocked under your family’s rule',
};
