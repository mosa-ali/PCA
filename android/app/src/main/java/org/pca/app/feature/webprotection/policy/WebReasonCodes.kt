package org.pca.app.feature.webprotection.policy

/**
 * Localized presentation text for [WebReasonId], mirrored verbatim from
 * `backend/src/i18n/messages/en.ts` / `ar.ts`'s `web.*` keys so the child/
 * parent-facing reason text matches the backend contract exactly. Policy/
 * audit code must key off [WebReasonId] itself, never parse or compare
 * against this prose (same PCA-16A discipline as the backend catalogue).
 */
private val EN: Map<WebReasonId, String> = mapOf(
    WebReasonId.SECURITY_DENYLIST to "blocked by a security threat rule",
    WebReasonId.PARENT_ALLOWLIST to "allowed by your parent's allow list",
    WebReasonId.PARENT_DENYLIST to "blocked by your parent's block list",
    WebReasonId.CATEGORY_RULE to "blocked by your parent's content category rule",
    WebReasonId.SCHEDULE_RULE to "blocked by your parent's schedule rule",
    WebReasonId.CLASSIFIER to "blocked by your parent's explicit-content rule",
    WebReasonId.DEFAULT to "no matching rule; allowed by default",
    WebReasonId.VPN_UNAVAILABLE to "network filtering capability was unavailable for this request",
)

private val AR: Map<WebReasonId, String> = mapOf(
    WebReasonId.SECURITY_DENYLIST to "محظور بواسطة قاعدة تهديد أمني",
    WebReasonId.PARENT_ALLOWLIST to "مسموح به بواسطة قائمة السماح الخاصة بولي أمرك",
    WebReasonId.PARENT_DENYLIST to "محظور بواسطة قائمة الحظر الخاصة بولي أمرك",
    WebReasonId.CATEGORY_RULE to "محظور بواسطة قاعدة تصنيف المحتوى الخاصة بولي أمرك",
    WebReasonId.SCHEDULE_RULE to "محظور بواسطة قاعدة الجدول الزمني الخاصة بولي أمرك",
    WebReasonId.CLASSIFIER to "محظور بواسطة قاعدة المحتوى الصريح الخاصة بولي أمرك",
    WebReasonId.DEFAULT to "لا توجد قاعدة مطابقة؛ مسموح به افتراضيًا",
    WebReasonId.VPN_UNAVAILABLE to "كانت إمكانية تصفية الشبكة غير متاحة لهذا الطلب",
)

fun translateWebReason(reasonId: WebReasonId, locale: WebLocale): String =
    (if (locale == WebLocale.AR) AR else EN).getValue(reasonId)
