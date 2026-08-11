import { sanitizeBidiControls } from './BidiUtils.js';
import { AR_MESSAGES } from './messages/ar.js';
import { EN_MESSAGES } from './messages/en.js';
import type { MessageId, MessageParams, SupportedLocale } from './types.js';

const TABLES: Record<SupportedLocale, Record<MessageId, string>> = {
  en: EN_MESSAGES,
  ar: AR_MESSAGES,
};

export interface TranslationFallbackEvent {
  messageId: MessageId;
  requestedLocale: SupportedLocale;
}

/**
 * doc 20 Section 2/lane brief Section 17: "Fallback is English only with a conspicuous
 * localisation-quality defect record; missing Arabic must not silently ship." `translate()`
 * itself never throws for a missing entry (a crash would be worse than showing English) -- but
 * every fallback invokes `onFallback`, so a caller (or this module's own completeness test) can
 * turn "Arabic string missing" into a loud, detectable release-quality failure rather than a
 * silently accepted gap. In this codebase's own tests, every MessageId has both locales
 * populated, so `onFallback` firing at all would itself indicate a regression.
 */
export function translate(
  messageId: MessageId,
  locale: SupportedLocale,
  params: MessageParams = {},
  onFallback?: (event: TranslationFallbackEvent) => void,
): string {
  const table = TABLES[locale];
  let template = table[messageId];
  if (template === undefined) {
    onFallback?.({ messageId, requestedLocale: locale });
    template = TABLES.en[messageId];
  }

  let result = template;
  if (params.domain !== undefined) {
    result = result.split('{domain}').join(sanitizeBidiControls(params.domain));
  }
  return result;
}
