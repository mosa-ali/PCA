import type { GuideCategory, GuideTopic } from './guideTypes';

export const GUIDE_CATEGORIES: readonly GuideCategory[] = [
  { id: 'gettingStarted', titleKey: 'guide.categories.gettingStarted' },
  { id: 'dashboard', titleKey: 'guide.categories.dashboard' },
  { id: 'children', titleKey: 'guide.categories.children' },
  { id: 'devices', titleKey: 'guide.categories.devices' },
  { id: 'requests', titleKey: 'guide.categories.requests' },
  { id: 'members', titleKey: 'guide.categories.members' },
  { id: 'roles', titleKey: 'guide.categories.roles' },
  { id: 'protection', titleKey: 'guide.categories.protection' },
  { id: 'safetyPrivacy', titleKey: 'guide.categories.safetyPrivacy' },
  { id: 'notifications', titleKey: 'guide.categories.notifications' },
  { id: 'billing', titleKey: 'guide.categories.billing' },
  { id: 'settings', titleKey: 'guide.categories.settings' },
  { id: 'download', titleKey: 'guide.categories.download' },
  { id: 'troubleshooting', titleKey: 'guide.categories.troubleshooting' },
] as const;

export const GUIDE_TOPICS: readonly GuideTopic[] = [
  {
    id: 'getting-started', category: 'gettingStarted', contentKey: 'guide.topics.gettingStarted', availability: 'setup',
    routePatterns: ['/register', '/verify-email', '/login', '/dashboard'], relatedTopicIds: ['parent-account', 'devices', 'download', 'trusted-browser'],
    searchTerms: ['start', 'begin', 'setup', 'account', 'verify', 'إنشاء الحساب', 'البدء', 'إعداد'],
  },
  {
    id: 'parent-account', category: 'gettingStarted', contentKey: 'guide.topics.parentAccount', availability: 'available',
    openPagePath: '/settings', routePatterns: ['/register', '/verify-email', '/login', '/settings'], relatedTopicIds: ['getting-started', 'roles', 'trusted-browser'],
    searchTerms: ['parent account', 'guardian account', 'sign in', 'email verification', 'حساب الوالدين', 'تسجيل الدخول', 'التحقق من البريد'],
  },
  {
    id: 'dashboard', category: 'dashboard', contentKey: 'guide.topics.dashboard', availability: 'available',
    openPagePath: '/dashboard', routePatterns: ['/dashboard'], relatedTopicIds: ['children', 'devices', 'requests', 'alerts'],
    searchTerms: ['home', 'overview', 'status', 'freshness', 'الرئيسية', 'نظرة عامة', 'الحالة'],
  },
  {
    id: 'children', category: 'children', contentKey: 'guide.topics.children', availability: 'available',
    openPagePath: '/children', routePatterns: ['/children', '/children/:childId/*'], relatedTopicIds: ['devices', 'screen-time', 'activity-timeline'],
    searchTerms: ['child', 'children', 'profile', 'overview', 'طفل', 'الأطفال', 'ملف الطفل'],
  },
  {
    id: 'activity-timeline', category: 'children', contentKey: 'guide.topics.activityTimeline', availability: 'available',
    openPagePath: '/children', routePatterns: ['/children/:childId/activity'], relatedTopicIds: ['children', 'security-log'],
    searchTerms: ['activity', 'timeline', 'history', 'نشاط', 'السجل الزمني', 'تاريخ'],
  },
  {
    id: 'devices', category: 'devices', contentKey: 'guide.topics.devices', availability: 'setup',
    openPagePath: '/family/devices', routePatterns: ['/family/devices'], relatedTopicIds: ['children', 'download', 'trusted-browser', 'screen-time'],
    searchTerms: ['device', 'pair', 'pairing', 'connect', 'pending setup', 'جهاز', 'إقران', 'ربط', 'إعداد معلّق'],
  },
  {
    id: 'requests', category: 'requests', contentKey: 'guide.topics.requests', availability: 'permission',
    openPagePath: '/requests', routePatterns: ['/requests'], relatedTopicIds: ['children', 'roles', 'notifications'], permissionAction: 'MANAGE_REQUESTS',
    searchTerms: ['request', 'bonus time', 'unblock', 'approve', 'deny', 'طلب', 'وقت إضافي', 'موافقة', 'رفض'],
  },
  {
    id: 'members', category: 'members', contentKey: 'guide.topics.members', availability: 'permission',
    openPagePath: '/family/members', routePatterns: ['/family/members'], relatedTopicIds: ['roles', 'parent-account'], permissionAction: 'MANAGE_PARENT_MEMBERS',
    searchTerms: ['parents', 'guardians', 'invite', 'member', 'والدان', 'مقدمو الرعاية', 'دعوة'],
  },
  {
    id: 'roles', category: 'roles', contentKey: 'guide.topics.roles', availability: 'permission',
    openPagePath: '/family/roles', routePatterns: ['/family/roles'], relatedTopicIds: ['members', 'requests', 'screen-time'], permissionAction: 'MANAGE_ROLES',
    searchTerms: ['role', 'permission', 'administrator', 'viewer', 'child', 'دور', 'صلاحية', 'مسؤول', 'مشاهد'],
  },
  {
    id: 'protection-status', category: 'protection', contentKey: 'guide.topics.protectionStatus', availability: 'setup',
    openPagePath: '/security/status', routePatterns: ['/security/status'], relatedTopicIds: ['devices', 'trusted-browser', 'alerts'],
    searchTerms: ['protection status', 'protected', 'device state', 'حالة الحماية', 'محمي', 'حالة الجهاز'],
  },
  {
    id: 'screen-time', category: 'protection', contentKey: 'guide.topics.screenTime', availability: 'permission',
    openPagePath: '/protection/screen-time', routePatterns: ['/protection/screen-time', '/children/:childId/screen-time'], relatedTopicIds: ['schedules', 'devices', 'roles'], permissionAction: 'EDIT_CHILD_POLICY',
    searchTerms: ['screen time', 'limits', 'break', 'night protection', 'وقت الشاشة', 'حدود الاستخدام', 'فترة الراحة'],
  },
  {
    id: 'apps-games', category: 'protection', contentKey: 'guide.topics.appsGames', availability: 'permission',
    openPagePath: '/protection/apps-web', routePatterns: ['/protection/apps-web', '/children/:childId/apps'], relatedTopicIds: ['web-protection', 'roles', 'devices'], permissionAction: 'EDIT_CHILD_POLICY',
    searchTerms: ['apps', 'games', 'installed', 'allow app', 'block app', 'التطبيقات', 'الألعاب', 'السماح'],
  },
  {
    id: 'web-protection', category: 'protection', contentKey: 'guide.topics.webProtection', availability: 'permission',
    openPagePath: '/protection/apps-web', routePatterns: ['/children/:childId/web-protection'], relatedTopicIds: ['apps-games', 'devices', 'screen-time'], permissionAction: 'EDIT_CHILD_POLICY',
    searchTerms: ['web', 'website', 'domain', 'filter', 'blocked', 'مواقع الويب', 'موقع', 'حظر', 'فلترة'],
  },
  {
    id: 'schedules', category: 'protection', contentKey: 'guide.topics.schedules', availability: 'permission',
    openPagePath: '/protection/schedules', routePatterns: ['/protection/schedules'], relatedTopicIds: ['screen-time', 'children'], permissionAction: 'EDIT_CHILD_POLICY',
    searchTerms: ['schedule', 'quiet hours', 'night', 'جدول', 'ساعات الهدوء', 'الحماية الليلية'],
  },
  {
    id: 'youtube', category: 'protection', contentKey: 'guide.topics.youtube', availability: 'available',
    openPagePath: '/children', routePatterns: ['/children/:childId/youtube'], relatedTopicIds: ['children', 'roles'],
    searchTerms: ['youtube', 'يوتيوب'],
  },
  {
    id: 'location', category: 'protection', contentKey: 'guide.topics.location', availability: 'setup',
    openPagePath: '/children', routePatterns: ['/children/:childId/location'], relatedTopicIds: ['devices', 'children'],
    searchTerms: ['location', 'safe zone', 'map', 'الموقع', 'المناطق الآمنة', 'خريطة'],
  },
  {
    id: 'eye-protection', category: 'protection', contentKey: 'guide.topics.eyeProtection', availability: 'available',
    openPagePath: '/children', routePatterns: ['/children/:childId/eye-protection'], relatedTopicIds: ['children', 'screen-time'],
    searchTerms: ['eye protection', 'reminder', 'eyes', 'حماية العين', 'تذكير'],
  },
  {
    id: 'prayer', category: 'protection', contentKey: 'guide.topics.prayer', availability: 'available',
    openPagePath: '/children', routePatterns: ['/children/:childId/prayer'], relatedTopicIds: ['children'],
    searchTerms: ['prayer', 'الصلاة'],
  },
  {
    id: 'wellbeing', category: 'protection', contentKey: 'guide.topics.wellbeing', availability: 'permission',
    openPagePath: '/wellbeing-messages', routePatterns: ['/wellbeing-messages', '/children/:childId/wellbeing-messages'], relatedTopicIds: ['children', 'roles', 'notifications'], permissionAction: 'MANAGE_WELLBEING_MESSAGES',
    searchTerms: ['wellbeing', 'message', 'encouragement', 'رفاه', 'رسالة', 'تشجيع'],
  },
  {
    id: 'alerts', category: 'safetyPrivacy', contentKey: 'guide.topics.alerts', availability: 'setup',
    openPagePath: '/safety/alerts', routePatterns: ['/safety/alerts'], relatedTopicIds: ['dashboard', 'protection-status', 'security-log'],
    searchTerms: ['alerts', 'warning', 'security alert', 'تنبيهات', 'تحذير', 'تنبيه أمني'],
  },
  {
    id: 'privacy', category: 'safetyPrivacy', contentKey: 'guide.topics.privacy', availability: 'available',
    openPagePath: '/privacy', routePatterns: ['/privacy'], relatedTopicIds: ['retention', 'export', 'delete', 'what-parents-see', 'app-permissions'],
    searchTerms: ['privacy', 'data', 'الخصوصية', 'البيانات'],
  },
  {
    id: 'retention', category: 'safetyPrivacy', contentKey: 'guide.topics.retention', availability: 'permission',
    openPagePath: '/privacy/retention', routePatterns: ['/privacy/retention'], relatedTopicIds: ['privacy', 'delete', 'roles'], permissionAction: 'CHANGE_RETENTION',
    searchTerms: ['retention', 'keep data', 'احتفاظ', 'الاحتفاظ بالبيانات'],
  },
  {
    id: 'export', category: 'safetyPrivacy', contentKey: 'guide.topics.export', availability: 'permission',
    openPagePath: '/privacy/export', routePatterns: ['/privacy/export'], relatedTopicIds: ['privacy', 'delete', 'roles'], permissionAction: 'EXPORT_DATA',
    searchTerms: ['export', 'download data', 'تصدير', 'تنزيل البيانات'],
  },
  {
    id: 'delete', category: 'safetyPrivacy', contentKey: 'guide.topics.delete', availability: 'permission',
    openPagePath: '/privacy/delete', routePatterns: ['/privacy/delete'], relatedTopicIds: ['privacy', 'retention', 'roles'], permissionAction: 'DELETE_HISTORY',
    searchTerms: ['delete now', 'remove data', 'حذف الآن', 'حذف البيانات'],
  },
  {
    id: 'what-parents-see', category: 'safetyPrivacy', contentKey: 'guide.topics.whatParentsSee', availability: 'available',
    openPagePath: '/privacy/transparency', routePatterns: ['/privacy/transparency'], relatedTopicIds: ['privacy', 'activity-timeline', 'security-log'],
    searchTerms: ['see', 'visibility', 'transparency', 'what can parents see', 'ما الذي يراه الوالدان', 'الشفافية'],
  },
  {
    id: 'app-permissions', category: 'safetyPrivacy', contentKey: 'guide.topics.appPermissions', availability: 'available',
    openPagePath: '/privacy/permissions', routePatterns: ['/privacy/permissions'], relatedTopicIds: ['privacy', 'download', 'devices'],
    searchTerms: ['app permissions', 'permission', 'access', 'أذونات التطبيق', 'الوصول'],
  },
  {
    id: 'trusted-browser', category: 'safetyPrivacy', contentKey: 'guide.topics.trustedBrowser', availability: 'setup',
    openPagePath: '/security/trusted-browser', routePatterns: ['/security/trusted-browser'], relatedTopicIds: ['parent-account', 'protection-status', 'devices', 'troubleshooting'],
    searchTerms: ['trusted browser', 'trust', 'pair browser', 'متصفح موثوق', 'ثقة المتصفح', 'إقران المتصفح'],
  },
  {
    id: 'recovery', category: 'safetyPrivacy', contentKey: 'guide.topics.recovery', availability: 'unavailable',
    openPagePath: '/security/recovery', routePatterns: ['/security/recovery'], relatedTopicIds: ['trusted-browser', 'security-log'], permissionAction: 'REVEAL_RECOVERY_MATERIAL',
    searchTerms: ['recovery', 'recover account', 'استرداد', 'استعادة الحساب'],
  },
  {
    id: 'security-log', category: 'safetyPrivacy', contentKey: 'guide.topics.securityLog', availability: 'setup',
    openPagePath: '/security/audit', routePatterns: ['/security/audit'], relatedTopicIds: ['activity-timeline', 'alerts', 'trusted-browser'],
    searchTerms: ['security log', 'audit', 'account actions', 'سجل الأمان', 'إجراءات الحساب'],
  },
  {
    id: 'notifications', category: 'notifications', contentKey: 'guide.topics.notifications', availability: 'available',
    openPagePath: '/notifications', routePatterns: ['/notifications'], relatedTopicIds: ['requests', 'alerts', 'settings'],
    searchTerms: ['notifications', 'email alerts', 'unread', 'تنبيهات', 'إشعارات', 'غير مقروء'],
  },
  {
    id: 'subscription', category: 'billing', contentKey: 'guide.topics.subscription', availability: 'permission',
    openPagePath: '/subscription', routePatterns: ['/subscription'], relatedTopicIds: ['device-increase', 'parent-increase', 'invoices', 'roles'], permissionAction: 'VIEW_BILLING',
    searchTerms: ['subscription', 'plan', 'billing', 'allowance', 'اشتراك', 'خطة', 'الفوترة', 'السعة'],
  },
  {
    id: 'device-increase', category: 'billing', contentKey: 'guide.topics.deviceIncrease', availability: 'permission',
    openPagePath: '/subscription/increase-devices', routePatterns: ['/subscription/increase-devices'], relatedTopicIds: ['subscription', 'invoices'], permissionAction: 'REQUEST_DEVICE_INCREASE',
    searchTerms: ['more devices', 'device allowance', 'quote', 'payment', 'زيادة الأجهزة', 'عرض سعر', 'دفع'],
  },
  {
    id: 'parent-increase', category: 'billing', contentKey: 'guide.topics.parentIncrease', availability: 'permission',
    openPagePath: '/subscription/increase-parent-members', routePatterns: ['/subscription/increase-parent-members'], relatedTopicIds: ['subscription', 'members'], permissionAction: 'REQUEST_PARENT_MEMBER_INCREASE',
    searchTerms: ['more parents', 'guardian allowance', 'non-billable', 'زيادة الوالدين', 'غير خاضعة للفوترة'],
  },
  {
    id: 'invoices', category: 'billing', contentKey: 'guide.topics.invoices', availability: 'permission',
    openPagePath: '/subscription/invoices', routePatterns: ['/subscription/invoices', '/subscription/invoices/:invoiceId'], relatedTopicIds: ['subscription', 'device-increase'], permissionAction: 'VIEW_BILLING',
    searchTerms: ['invoice', 'receipt', 'payment status', 'فاتورة', 'إيصال', 'حالة الدفع'],
  },
  {
    id: 'settings', category: 'settings', contentKey: 'guide.topics.settings', availability: 'available',
    openPagePath: '/settings', routePatterns: ['/settings'], relatedTopicIds: ['parent-account', 'notifications', 'trusted-browser'],
    searchTerms: ['settings', 'language', 'preferences', 'الإعدادات', 'اللغة', 'التفضيلات'],
  },
  {
    id: 'download', category: 'download', contentKey: 'guide.topics.download', availability: 'setup',
    openPagePath: '/download', routePatterns: ['/download'], relatedTopicIds: ['devices', 'app-permissions', 'troubleshooting'],
    searchTerms: ['download child app', 'android', 'ios', 'install', 'تنزيل تطبيق الطفل', 'أندرويد', 'آيفون', 'تثبيت'],
  },
  {
    id: 'troubleshooting', category: 'troubleshooting', contentKey: 'guide.topics.troubleshooting', availability: 'available',
    routePatterns: ['/not-permitted', '/security/trusted-browser', '/family/devices', '/download'], relatedTopicIds: ['roles', 'devices', 'trusted-browser', 'download', 'device-increase'],
    searchTerms: ['problem', 'why', 'not permitted', 'pending', 'cannot', 'مشكلة', 'لماذا', 'غير مسموح', 'معلّق'],
  },
] as const;

export const GUIDE_TOPIC_BY_ID = new Map(GUIDE_TOPICS.map((topic) => [topic.id, topic]));
