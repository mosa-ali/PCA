import type { SafeExplanationKind } from '../ai/types.js';
import type { WebRuleSource } from '../web/types.js';

/** doc 20 Section 1: launch languages only -- "PCA-FR-110/111." Adding a third locale is a product decision, not a silent code change. */
export type SupportedLocale = 'en' | 'ar';

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ['en', 'ar'];

/**
 * Stable message IDs reused directly from already-accepted, frozen backend modules --
 * `WebDecision.source` (web/types.ts) and `SafeExplanation.kind` (ai/types.ts) -- rather than
 * inventing a parallel identifier scheme. This module never edits web/ or ai/ source; it only
 * consumes their existing machine-readable fields and supplies the localized text they were
 * always meant to be presented through instead of the English sentences baked into
 * web/WebFilterEngine.ts's REASON_CODES / ai/policy.ts's EXPLANATION_LABELS.
 */
export type WebDecisionMessageId = WebRuleSource | 'CLASSIFIER' | 'DEFAULT';
export type AiExplanationMessageId = SafeExplanationKind;

/** One additional message demonstrating the typed-placeholder + bidi-isolation pattern (doc 20 Section 3) for a domain-bearing notice -- not tied to a specific caller yet, available for a future presentation layer. */
export type DomainNoticeMessageId = 'DOMAIN_BLOCKED_NOTICE';

export type MessageId = WebDecisionMessageId | AiExplanationMessageId | DomainNoticeMessageId;

/** Named, typed placeholders only -- never positional string concatenation (doc 20 Section 2). */
export interface MessageParams {
  domain?: string;
}

/** Which named params (if any) a message template accepts, and whether each is an LTR token requiring bidi isolation when embedded in an RTL (ar) message. */
export interface MessageParamSpec {
  name: keyof MessageParams;
  isLtrToken: boolean;
}
