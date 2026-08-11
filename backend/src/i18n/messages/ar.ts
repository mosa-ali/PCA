import { isolateLtr } from '../BidiUtils.js';
import type { MessageId } from '../types.js';

/**
 * Arabic translations. PENDING NATIVE REVIEWER SIGN-OFF before release (doc 20 Section 2) -- see
 * docs/i18n_arabic_review_notes.md. `DOMAIN_BLOCKED_NOTICE` demonstrates bidi isolation of an
 * embedded LTR domain token per doc 20 Section 3; the placeholder itself is substituted (and
 * isolated) by translate.ts, never hand-concatenated here.
 */
export const AR_MESSAGES: Record<MessageId, string> = {
  'web.SECURITY_DENYLIST': 'محظور بواسطة قاعدة تهديد أمني',
  'web.PARENT_ALLOWLIST': 'مسموح به بواسطة قائمة السماح الخاصة بعائلتك',
  'web.PARENT_DENYLIST': 'محظور بواسطة قائمة الحظر الخاصة بعائلتك',
  'web.CATEGORY_RULE': 'محظور بواسطة قاعدة تصنيف المحتوى الخاصة بعائلتك',
  'web.SCHEDULE_RULE': 'محظور بواسطة قاعدة الجدول الزمني الخاصة بعائلتك',
  'web.CLASSIFIER': 'محظور بواسطة قاعدة المحتوى الصريح الخاصة بعائلتك',
  'web.DEFAULT': 'لا توجد قاعدة مطابقة؛ مسموح به افتراضيًا',

  'ai.CATEGORY_RULE_MATCHED': 'محظور بموجب قاعدة التصنيف الخاصة بعائلتك',
  'ai.SUPPLEMENTARY_RISK_SIGNAL': 'تم وضع علامة عليه بواسطة إشارة خطر تكميلية لمراجعة الوالدين',
  'ai.MODEL_UNAVAILABLE': 'تعذر إجراء التحليل على الجهاز لهذا العنصر',
  'ai.CONFIDENCE_BELOW_THRESHOLD': 'كانت ثقة الإشارة أقل من الحد المُعد',

  'enrollment.INVALID_TOKEN': 'رمز الدعوة غير صالح.',
  'enrollment.INVALID_PUBLIC_KEY': 'المفتاح العام للجهاز غير صالح.',
  'enrollment.KEYS_NOT_DISTINCT': 'يجب أن يكون مفتاحا التوقيع والتشفير مختلفين.',
  'enrollment.INVALID_PLATFORM': 'هذه المنصة غير مدعومة.',
  'enrollment.NOT_FOUND': 'لم يتم العثور على الدعوة.',
  'enrollment.EXPIRED': 'انتهت صلاحية الدعوة.',
  'enrollment.REVOKED': 'تم إلغاء الدعوة.',
  'enrollment.ALREADY_REDEEMED': 'تم استخدام الدعوة مسبقًا.',
  'enrollment.PLATFORM_MISMATCH': 'منصة الجهاز لا تطابق الدعوة.',
  'enrollment.DUPLICATE_KEY': 'هذا المفتاح العام مسجل بالفعل لجهاز آخر.',

  'invitation.INVALID_TOKEN': 'رمز الدعوة غير صالح.',
  'invitation.NOT_FOUND': 'لم يتم العثور على الدعوة.',
  'invitation.EXPIRED': 'انتهت صلاحية الدعوة.',
  'invitation.REVOKED': 'تم إلغاء الدعوة.',
  'invitation.ALREADY_REDEEMED': 'تم استخدام الدعوة مسبقًا.',

  'pairing.NOT_FOUND': 'لم يتم العثور على طلب الإقران.',
  'pairing.INVALID_STATE': 'طلب الإقران ليس في حالة تسمح بهذا الإجراء.',

  'deviceAuth.DEVICE_NOT_FOUND': 'لم يتم العثور على الجهاز.',
  'deviceAuth.DEVICE_REVOKED': 'تم إلغاء تفويض هذا الجهاز.',
  'deviceAuth.NOT_FOUND': 'لم يتم العثور على طلب التحقق.',
  'deviceAuth.EXPIRED': 'انتهت صلاحية طلب التحقق.',
  'deviceAuth.ALREADY_CONSUMED': 'تم استخدام طلب التحقق مسبقًا.',
  'deviceAuth.INVALID_SIGNATURE': 'فشل التحقق من التوقيع.',

  'device.INVALID_PUBLIC_KEY': 'المفتاح العام غير صالح.',
  'device.DUPLICATE_KEY': 'هذا المفتاح العام مسجل بالفعل لجهاز آخر.',
  'device.DEVICE_NOT_FOUND': 'لم يتم العثور على الجهاز.',
  'device.DEVICE_REVOKED': 'تم إلغاء تفويض هذا الجهاز.',
  'device.KEY_NOT_FOUND': 'لم يتم العثور على مفتاح الجهاز.',
  'device.INVALID_STATE': 'الجهاز ليس في حالة تسمح بهذا الإجراء.',

  'recovery.INVALID_INPUT': 'بيانات مغلف الاسترداد غير صالحة.',
  'recovery.VERSION_MISMATCH': 'تم تغيير مغلف الاسترداد من جهاز آخر؛ يرجى إعادة القراءة قبل المحاولة مرة أخرى.',
  'recovery.NOT_FOUND': 'لم يتم العثور على مغلف الاسترداد.',

  'youtube.modeBEvent.PLAYBACK_STARTED': 'الوضع B — بإشراف PCA: بدأ التشغيل',
  'youtube.modeBEvent.PLAYBACK_STATE_OBSERVED': 'الوضع B — بإشراف PCA: تم رصد حالة التشغيل',
  'youtube.modeBEvent.PLAYBACK_COMPLETED_SIGNAL_OBSERVED': 'الوضع B — بإشراف PCA: تم رصد إشارة الانتهاء',
  'youtube.modeBEvent.PLAYBACK_ERROR': 'الوضع B — بإشراف PCA: خطأ في التشغيل',

  'youtube.modeBError.FEATURE_DISABLED': 'الوضع B غير مُفعّل (الميزة معطّلة أو الشروط لم تُراجع بعد).',
  'youtube.modeBError.INVALID_VIDEO_ID': 'معرّف الفيديو غير صالح.',
  'youtube.modeBError.INVALID_CHANNEL_ID': 'معرّف القناة غير صالح.',
  'youtube.modeBError.INVALID_TITLE': 'العنوان غير صالح.',
  'youtube.modeBError.INVALID_EVENT_TYPE': 'نوع الحدث غير معروف.',
  'youtube.modeBError.INVALID_EVENT_SHAPE': 'رمز الخطأ مطلوب لحدث خطأ التشغيل ويجب ألا يكون موجودًا في غيره.',
  'youtube.modeBError.INVALID_DURATION': 'مدة المشاهدة المرصودة يجب أن تكون رقمًا محدودًا غير سالب عند توفرها.',

  'childRequest.INVALID_INPUT': 'بيانات طلب الطفل غير صالحة.',
  'childRequest.NOT_FOUND': 'طلب الطفل غير موجود.',
  'childRequest.ILLEGAL_TRANSITION': 'تم اتخاذ قرار بشأن هذا الطلب مسبقًا أو أنه ليس في حالة تسمح باتخاذ قرار.',
  'childRequest.REQUEST_EXPIRED': 'انتهت صلاحية طلب الطفل هذا.',
  'childRequest.NOT_AUTHORIZED_TO_DECIDE': 'الجهاز الذي يحاول اتخاذ القرار غير مخوّل للموافقة على هذا النوع من الطلبات أو رفضه.',
  'childRequest.NOT_THE_REQUESTER': 'يمكن فقط لجهاز الطفل الذي أرسل الطلب تنفيذ هذا الإجراء.',

  'model.NOT_FOUND': 'سجل دورة حياة النموذج غير موجود.',
  'model.ILLEGAL_TRANSITION': 'هذا الانتقال في دورة الحياة غير مسموح به من الحالة الحالية.',
  'model.ROLLBACK_TARGET_NOT_FOUND': 'نموذج التراجع المستهدف غير موجود.',
  'model.ROLLBACK_TARGET_NOT_KNOWN_GOOD': 'الهدف المطلوب للتراجع لم يتم التحقق منه مسبقًا كنسخة موثوقة.',
  'model.ROLLBACK_TARGET_IS_SAME_MODEL': 'لا يمكن أن يكون هدف التراجع هو النموذج النشط حاليًا نفسه.',
  'model.KILL_SWITCH_NOT_APPLICABLE': 'مفتاح الإيقاف الفوري يمكن أن يعطّل فقط نموذجًا نشطًا حاليًا.',
  'model.DIRECTIVE_WRONG_ACTION': 'إجراء التوجيه الطارئ لا يطابق هذه العملية.',
  'model.DIRECTIVE_WRONG_TARGET': 'معرّف النموذج في التوجيه الطارئ لا يطابق الهدف المطلوب.',
  'model.DIRECTIVE_MISSING_ROLLBACK_TARGET': 'يجب أن يحدد توجيه التراجع النموذج المستهدف.',
  'model.DIRECTIVE_SIGNATURE_INVALID': 'فشل التحقق من توقيع التوجيه الطارئ.',

  'schedule.ALLOWED': 'مسموح.',
  'schedule.ALLOWED_BONUS': 'مسموح مع {bonusMinutes} دقيقة إضافية نشطة.',
  'schedule.ALLOWED_EXCEPTION': 'مسموح بموجب استثناء نشط من أحد الوالدين.',
  'schedule.BLOCKED_BEDTIME': 'محظور بواسطة فترة نوم نشطة.',
  'schedule.BLOCKED_SCHOOL_MODE': 'محظور: خارج النطاق المسموح به في {windowCount} من أصل {totalWindowCount} فترة وضع مدرسي نشطة.',
  'schedule.BLOCKED_PERIOD': 'محظور بواسطة فترة حظر نشطة.',
  'schedule.BLOCKED_OUTSIDE_ALLOW_PERIOD': 'محظور: لا توجد فترة سماح تغطي هذا التطبيق حاليًا.',
  'schedule.BLOCKED_LIMIT_REACHED': 'محظور: تم استخدام {usedMinutes} من أصل {limitMinutes} دقيقة اليوم.',
  'schedule.ENFORCEMENT_UNAVAILABLE': 'لا يمكن تأكيد تطبيق هذا القرار حاليًا (الإمكانية: {enforcementCapability}).',
  'schedule.INVALID_CONFIG': 'فشل التحقق من صحة فترة زمنية واحدة أو أكثر.',

  'retention.EXPIRED': 'تمت إزالته لبلوغه نهاية فترة الاحتفاظ الخاصة بعائلتك.',
  'retention.ROLLING_RETENTION_SUPERSEDED': 'تمت إزالته لأن نقطة موقع أحدث حلّت محله.',
  'retention.DELETE_NOW': 'تمت إزالته بناءً على طلب "الحذف الآن" من أحد الوالدين.',

  'export.COMPLETED': 'اكتمل تصدير بيانات عائلتك بنجاح.',
  'export.CANCELLED': 'تم إلغاء التصدير قبل اكتماله.',
  'export.FAILED': 'تعذر إكمال عملية التصدير.',

  DOMAIN_BLOCKED_NOTICE: `تم حظر ${isolateLtr('{domain}')} بموجب قاعدة عائلتك`,
};
