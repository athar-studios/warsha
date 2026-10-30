// @warsha/i18n — Arabic-first internationalization
// Uses ICU MessageFormat via intl-messageformat

import { IntlMessageFormat } from 'intl-messageformat';
import { createContext, useContext, useState, ReactNode } from 'react';

export type Locale = 'ar' | 'en';

export const defaultLocale: Locale = 'ar';
export const supportedLocales: Locale[] = ['ar', 'en'];

export type MessageValues = Record<string, string | number>;

export function formatMessage(pattern: string, values: MessageValues, locale: Locale): string {
  const formatter = new IntlMessageFormat(pattern, locale);
  return String(formatter.format(values));
}

/** Message catalogs. Keys are added as UI strings are needed (ar is canonical). */
export const messages: Record<Locale, Record<string, string>> = {
  ar: {
    'app.name': 'ورشة',
    'app.tagline': 'مصنع برمجيات بالذكاء الاصطناعي، عربي أولاً',
    'app.loading': 'جاري التحميل...',
    'gate.approve': 'موافقة',
    'gate.reject': 'رفض',
    'gate.request_changes': 'طلب تعديلات',
    'run.status': 'حالة التشغيل: {status}',
    'run.model_label': 'النموذج:',
    'budget.remaining': 'الميزانية المتبقية: {amount}',
    'projects.id_label': 'المعرف:',
    'settings.current_locale': 'اللغة الحالية: {locale}',
    'nav.dashboard': 'لوحة التحكم',
    'devices.qr_code': 'رمز QR',
    'app.brand': 'Warsha',
    'onboarding.lang_ar': 'العربية',
    'onboarding.lang_en': 'English',
    'nav.projects': 'المشاريع',
    'nav.settings': 'الإعدادات',
    'nav.providers': 'المزودين',
    'nav.roles': 'الأدوار',
    'nav.budgets': 'الميزانيات',
    'nav.devices': 'الأجهزة',
    'nav.gates': 'البوابات',
    'nav.artifacts': 'المصنوعات',
    'onboarding.language': 'اختر اللغة',
    'onboarding.next': 'التالي',
    'onboarding.back': 'السابق',
    'onboarding.providers_title': 'إعداد مزودي الذكاء الاصطناعي',
    'onboarding.providers_desc': 'أضف مفاتيح API للمزودين الذين تريد استخدامهم',
    'onboarding.github_title': 'ربط GitHub',
    'onboarding.github_desc': 'قم بتوصيل حساب GitHub لتمكين إنشاء المستودعات، والفرع، وطلبات السحب',
    'onboarding.github_connect': 'الاتصال بـ GitHub',
    'onboarding.github_connected': '✓ تم ربط GitHub',
    'onboarding.complete_title': 'مرحباً بك في ورشة!',
    'onboarding.complete_desc': 'أنت جاهز للبدء. افتح لوحة التحكم لإنشاء مشروعك الأول.',
    'onboarding.open_dashboard': 'فتح لوحة التحكم',
    'projects.title': 'لوحة المشاريع',
    'projects.new': 'مشروع جديد',
    'projects.new_modal_title': 'مشروع جديد',
    'projects.name_placeholder': 'اسم المشروع',
    'projects.idea_placeholder': 'صف فكرتك هنا...',
    'projects.create': 'إنشاء',
    'projects.cancel': 'إلغاء',
    'projects.empty': 'فارغ',
    'projects.gate_empty': 'في انتظار الموافقة',
    'run.back': 'رجوع',
    'run.follow_live': 'متابعة مباشرة',
    'run.stop_follow': 'إيقاف المتابعة',
    'run.advance': 'تقدم',
    'run.event_stream': 'سجل الأحداث',
    'run.artifacts': 'المصنوعات',
    'run.export_all': 'تصدير الكل',
    'run.no_artifacts': 'لا توجد مصنوعات بعد',
    'gates.title': 'صندوق الوارد للبوابات',
    'gates.action_required': 'الإجراء المطلوب',
    'gates.approve': 'موافقة',
    'gates.reject': 'رفض',
    'gates.request_changes': 'طلب تعديلات',
    'gates.reason_placeholder': 'سبب الرفض...',
    'gates.changes_placeholder': 'ملاحظات التغييرات المطلوبة...',
    'gates.pending': 'في الانتظار',
    'gates.approved': 'موافق عليه',
    'gates.rejected': 'مرفوض',
    'gates.changes_requested': 'تغييرات مطلوبة',
    'artifacts.title': 'المصنوعات',
    'artifacts.select': 'اختر مصنوعة',
    'artifacts.select_desc': 'اختر من القائمة الجانبية لعرض أو تحرير مصنوعة',
    'artifacts.edit': 'تحرير',
    'artifacts.export': 'تصدير',
    'artifacts.save': 'حفظ',
    'providers.title': 'إعدادات المزودين',
    'providers.add': 'إضافة مزود',
    'providers.add_title': 'إضافة مزود جديد',
    'providers.type': 'نوع المزود',
    'providers.select_type': 'اختر نوع المزود...',
    'providers.api_key': 'مفتاح API',
    'providers.api_key_placeholder': 'أدخل مفتاح API',
    'providers.api_base': 'قاعدة API (اختياري)',
    'providers.test': 'اختبار',
    'providers.remove': 'حذف',
    'providers.no_providers': 'لا توجد مزودين مضافين',
    'providers.add_first': 'إضافة أول مزود',
    'roles.title': 'إعدادات الأدوار',
    'roles.desc': 'تعيين توجيه المزود/النموذج لكل دور',
    'roles.edit': 'تعديل',
    'roles.configure': 'تهيئة',
    'roles.provider': 'المزود',
    'roles.model': 'النموذج',
    'roles.weight': 'الوزن',
    'roles.add_target': 'إضافة هدف',
    'roles.not_configured': 'غير مهيأ',
    'budgets.title': 'الميزانيات',
    'budgets.desc': 'تتبع الإنفاق لكل مشروع',
    'budgets.set': 'تعيين ميزانية',
    'budgets.set_title': 'تعيين ميزانية جديدة',
    'budgets.project': 'المشروع',
    'budgets.select_project': 'اختر مشروع...',
    'budgets.amount': 'الميزانية (دولار)',
    'budgets.set_btn': 'تعيين',
    'budgets.no_budgets': 'لا توجد ميزانيات محددة',
    'budgets.set_first': 'تعيين أول ميزانية',
    'budgets.used': 'مستخدمة',
    'budgets.set_label': 'محددة',
    'devices.title': 'الأجهزة المقترنة',
    'devices.desc': 'إدارة الأجهزة المصرح لها بالوصول',
    'devices.pair': 'إقران جهاز جديد',
    'devices.pair_title': 'إقران جهاز جديد',
    'devices.pair_desc': 'افتح تطبيق Warsha المحمول وامسح رمز QR أدناه',
    'devices.qr_placeholder': 'QR Code',
    'devices.pairing_code': 'رمز الإقران',
    'devices.copy_code': 'نسخ الرمز',
    'devices.revoke': 'إلغاء الإقران',
    'devices.no_devices': 'لا توجد أجهزة مقترنة',
    'devices.pair_first': 'إقران جهاز',
    'devices.paired': 'مقترن',
    'devices.last_seen': 'آخر ظهور',
    'devices.online': 'متصل',
    'devices.recently_active': 'نشط مؤخراً',
    'devices.offline': 'غير متصل',
  },
  en: {
    'app.name': 'Warsha',
    'app.tagline': 'Arabic-first AI software factory',
    'app.loading': 'Loading...',
    'gate.approve': 'Approve',
    'gate.reject': 'Reject',
    'gate.request_changes': 'Request changes',
    'run.status': 'Run status: {status}',
    'run.model_label': 'Model:',
    'budget.remaining': 'Remaining budget: {amount}',
    'projects.id_label': 'ID:',
    'settings.current_locale': 'Current locale: {locale}',
    'nav.dashboard': 'Dashboard',
    'devices.qr_code': 'QR Code',
    'app.brand': 'Warsha',
    'onboarding.lang_ar': 'العربية',
    'onboarding.lang_en': 'English',
    'nav.projects': 'Projects',
    'nav.settings': 'Settings',
    'nav.providers': 'Providers',
    'nav.roles': 'Roles',
    'nav.budgets': 'Budgets',
    'nav.devices': 'Devices',
    'nav.gates': 'Gates',
    'nav.artifacts': 'Artifacts',
    'onboarding.language': 'Select Language',
    'onboarding.next': 'Next',
    'onboarding.back': 'Back',
    'onboarding.providers_title': 'AI Provider Setup',
    'onboarding.providers_desc': 'Add API keys for providers you want to use',
    'onboarding.github_title': 'Connect GitHub',
    'onboarding.github_desc': 'Connect your GitHub account to enable repository creation, branching, and pull requests',
    'onboarding.github_connect': 'Connect GitHub',
    'onboarding.github_connected': '✓ GitHub Connected',
    'onboarding.complete_title': 'Welcome to Warsha!',
    'onboarding.complete_desc': "You're ready to go. Open the dashboard to create your first project.",
    'onboarding.open_dashboard': 'Open Dashboard',
    'projects.title': 'Projects Board',
    'projects.new': 'New Project',
    'projects.new_modal_title': 'New Project',
    'projects.name_placeholder': 'Project name',
    'projects.idea_placeholder': 'Describe your idea...',
    'projects.create': 'Create',
    'projects.cancel': 'Cancel',
    'projects.empty': 'Empty',
    'projects.gate_empty': 'Awaiting approval',
    'run.back': 'Back',
    'run.follow_live': 'Follow Live',
    'run.stop_follow': 'Stop Following',
    'run.advance': 'Advance',
    'run.event_stream': 'Event Stream',
    'run.artifacts': 'Artifacts',
    'run.export_all': 'Export All',
    'run.no_artifacts': 'No artifacts yet',
    'gates.title': 'Gates Inbox',
    'gates.action_required': 'Action Required',
    'gates.approve': 'Approve',
    'gates.reject': 'Reject',
    'gates.request_changes': 'Request Changes',
    'gates.reason_placeholder': 'Reason for rejection...',
    'gates.changes_placeholder': 'Notes for requested changes...',
    'gates.pending': 'Pending',
    'gates.approved': 'Approved',
    'gates.rejected': 'Rejected',
    'gates.changes_requested': 'Changes Requested',
    'artifacts.title': 'Artifacts',
    'artifacts.select': 'Select an Artifact',
    'artifacts.select_desc': 'Select from the sidebar to view or edit an artifact',
    'artifacts.edit': 'Edit',
    'artifacts.export': 'Export',
    'artifacts.save': 'Save',
    'providers.title': 'Provider Settings',
    'providers.add': 'Add Provider',
    'providers.add_title': 'Add New Provider',
    'providers.type': 'Provider Type',
    'providers.select_type': 'Select provider type...',
    'providers.api_key': 'API Key',
    'providers.api_key_placeholder': 'Enter API key',
    'providers.api_base': 'API Base URL (optional)',
    'providers.test': 'Test',
    'providers.remove': 'Remove',
    'providers.no_providers': 'No providers added',
    'providers.add_first': 'Add First Provider',
    'roles.title': 'Role Settings',
    'roles.desc': 'Assign provider/model routing per role',
    'roles.edit': 'Edit',
    'roles.configure': 'Configure',
    'roles.provider': 'Provider',
    'roles.model': 'Model',
    'roles.weight': 'Weight',
    'roles.add_target': 'Add Target',
    'roles.not_configured': 'Not configured',
    'budgets.title': 'Budgets',
    'budgets.desc': 'Track spending per project',
    'budgets.set': 'Set Budget',
    'budgets.set_title': 'Set New Budget',
    'budgets.project': 'Project',
    'budgets.select_project': 'Select project...',
    'budgets.amount': 'Budget (USD)',
    'budgets.set_btn': 'Set',
    'budgets.no_budgets': 'No budgets set',
    'budgets.set_first': 'Set First Budget',
    'budgets.used': 'used',
    'budgets.set_label': 'Set',
    'devices.title': 'Paired Devices',
    'devices.desc': 'Manage authorized devices',
    'devices.pair': 'Pair New Device',
    'devices.pair_title': 'Pair New Device',
    'devices.pair_desc': 'Open the Warsha mobile app and scan the QR code below',
    'devices.qr_placeholder': 'QR Code',
    'devices.pairing_code': 'Pairing Code',
    'devices.copy_code': 'Copy Code',
    'devices.revoke': 'Revoke',
    'devices.no_devices': 'No paired devices',
    'devices.pair_first': 'Pair Device',
    'devices.paired': 'Paired',
    'devices.last_seen': 'Last seen',
    'devices.online': 'Online',
    'devices.recently_active': 'Recently active',
    'devices.offline': 'Offline',
  },
};

export type MessageKey = string;

/** Translate a message key. Falls back to the key itself when missing. */
export function t(
  key: MessageKey,
  values: MessageValues = {},
  locale: Locale = defaultLocale
): string {
  const pattern = messages[locale]?.[key] ?? messages[defaultLocale]?.[key];
  if (pattern === undefined) return key;
  const hasValues = Object.keys(values).length > 0;
  return hasValues ? formatMessage(pattern, values, locale) : pattern;
}

/** Direction hint for a locale (Arabic is RTL). */
export function direction(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

// React context for locale (optional, for apps that want it)
const LocaleContext = createContext<{ locale: Locale; setLocale: (l: Locale) => void }>({
  locale: defaultLocale,
  setLocale: () => {},
});

export function LocaleProvider({ children, initialLocale = defaultLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}

export function useDirection(): 'rtl' | 'ltr' {
  const locale = useLocale();
  return direction(locale);
}