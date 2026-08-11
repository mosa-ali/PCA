import { isolateLtr } from '../BidiUtils.js';
import type { MessageId } from '../types.js';

/**
 * Arabic translations. PENDING NATIVE REVIEWER SIGN-OFF before release (doc 20 Section 2) -- see
 * ../../../../docs/i18n_arabic_review_notes.md. `DOMAIN_BLOCKED_NOTICE` demonstrates bidi isolation of an
 * embedded LTR domain token per doc 20 Section 3; the placeholder itself is substituted (and
 * isolated) by translate.ts, never hand-concatenated here.
 */
export const AR_MESSAGES: Record<MessageId, string> = {
  SECURITY_DENYLIST: 'محظور بواسطة قاعدة تهديد أمني',
  PARENT_ALLOWLIST: 'مسموح به بواسطة قائمة السماح الخاصة بعائلتك',
  PARENT_DENYLIST: 'محظور بواسطة قائمة الحظر الخاصة بعائلتك',
  CATEGORY_RULE: 'محظور بواسطة قاعدة تصنيف المحتوى الخاصة بعائلتك',
  SCHEDULE_RULE: 'محظور بواسطة قاعدة الجدول الزمني الخاصة بعائلتك',
  CLASSIFIER: 'محظور بواسطة قاعدة المحتوى الصريح الخاصة بعائلتك',
  DEFAULT: 'لا توجد قاعدة مطابقة؛ مسموح به افتراضيًا',
  CATEGORY_RULE_MATCHED: 'محظور بموجب قاعدة التصنيف الخاصة بعائلتك',
  SUPPLEMENTARY_RISK_SIGNAL: 'تم وضع علامة عليه بواسطة إشارة خطر تكميلية لمراجعة الوالدين',
  MODEL_UNAVAILABLE: 'تعذر إجراء التحليل على الجهاز لهذا العنصر',
  CONFIDENCE_BELOW_THRESHOLD: 'كانت ثقة الإشارة أقل من الحد المُعد',
  DOMAIN_BLOCKED_NOTICE: `تم حظر ${isolateLtr('{domain}')} بموجب قاعدة عائلتك`,
};
