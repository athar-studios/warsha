// @warsha/i18n — Arabic-first internationalization
// Uses ICU MessageFormat via intl-messageformat

import { IntlMessageFormat } from 'intl-messageformat';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

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
    // The first-run wizard (Onboarding.tsx): provider choice → one key → connection test → project.
    'onboarding.provider_title': 'اختر أول مزوّد',
    'onboarding.provider_desc': 'يُسجَّل المزوّد عند الخادم، ويُختبر اتصاله قبل أي تشغيل.',
    'onboarding.provider_loading': 'جاري قراءة المزوّدين من الخادم...',
    'onboarding.provider_unreachable': 'لم يستجب الخادم لطلب قائمة المزوّدين.',
    'onboarding.provider_retry': 'أعد المحاولة',
    'onboarding.provider_from_daemon': 'مزوّدون يعرفهم الخادم',
    'onboarding.provider_none': 'لم يبلّغ الخادم عن أي مزوّد بعد، فاختر واحداً لإضافته:',
    'onboarding.provider_configured': 'مضاف',
    'onboarding.provider_kind.open_router': 'OpenRouter',
    'onboarding.provider_kind.deep_seek': 'DeepSeek',
    'onboarding.provider_kind.kimi': 'Kimi (Moonshot)',
    'onboarding.provider_kind.glm': 'GLM (Zhipu)',
    'onboarding.provider_kind.qwen': 'Qwen (DashScope)',
    'onboarding.key_title': 'الصق مفتاح API',
    'onboarding.key_desc': 'يبقى المفتاح في هذه الشاشة ويُسلَّم للخادم فقط، ولا يُحفظ في المتصفح.',
    'onboarding.key_provider': 'المزوّد: {name}',
    'onboarding.key_label': 'مفتاح API',
    'onboarding.key_placeholder': 'الصق المفتاح هنا',
    'onboarding.key_hint': 'لن يظهر المفتاح كاملاً مرة أخرى.',
    'onboarding.key_connect': 'أضف المزوّد واختبر',
    'onboarding.test_title': 'اختبار الاتصال',
    'onboarding.test_running': 'جاري اختبار الاتصال...',
    'onboarding.test_running_desc': 'ننتظر رد المزوّد.',
    'onboarding.test_passed': 'نجح الاختبار',
    'onboarding.test_passed_desc': 'المزوّد {name} جاهز للعمل.',
    'onboarding.test_refused': 'فشل الاختبار',
    'onboarding.test_refused_desc':
      'لم يقبل المزوّد هذا المفتاح. جرّب مفتاحاً آخر أو مزوّداً غيره.',
    'onboarding.test_detail': 'ما ردّ به الخادم',
    'onboarding.test_continue': 'سمِّ مشروعك الأول',
    'onboarding.test_retry': 'جرّب مفتاحاً آخر',
    'onboarding.test_repick': 'اختر مزوّداً آخر',
    'onboarding.project_title': 'مشروعك الأول',
    'onboarding.project_desc': 'الاسم فقط الآن، ثم نكتب الفكرة في المحادثة.',
    'onboarding.project_label': 'اسم المشروع',
    'onboarding.project_placeholder': 'اسم مشروعك',
    'onboarding.project_create': 'أنشئ المشروع',
    'onboarding.project_creating': 'جاري إنشاء المشروع...',
    'onboarding.project_failed': 'لم يستطع الخادم إنشاء المشروع.',
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
    // The first-run wizard (Onboarding.tsx): provider choice → one key → connection test → project.
    'onboarding.provider_title': 'Choose your first provider',
    'onboarding.provider_desc':
      'Warsha registers the provider with the daemon and tests the connection before any run.',
    'onboarding.provider_loading': 'Reading the providers the daemon reports…',
    'onboarding.provider_unreachable': 'The daemon did not answer the provider list.',
    'onboarding.provider_retry': 'Try again',
    'onboarding.provider_from_daemon': 'Providers the daemon already knows',
    'onboarding.provider_none': 'The daemon reports no providers yet, so pick one to add:',
    'onboarding.provider_configured': 'Added',
    'onboarding.provider_kind.open_router': 'OpenRouter',
    'onboarding.provider_kind.deep_seek': 'DeepSeek',
    'onboarding.provider_kind.kimi': 'Kimi (Moonshot)',
    'onboarding.provider_kind.glm': 'GLM (Zhipu)',
    'onboarding.provider_kind.qwen': 'Qwen (DashScope)',
    'onboarding.key_title': 'Paste your API key',
    'onboarding.key_desc':
      'The key stays on this screen and goes to the daemon only — never to browser storage.',
    'onboarding.key_provider': 'Provider: {name}',
    'onboarding.key_label': 'API key',
    'onboarding.key_placeholder': 'Paste the key here',
    'onboarding.key_hint': 'The key is never shown in full again.',
    'onboarding.key_connect': 'Add the provider and test',
    'onboarding.test_title': 'Connection test',
    'onboarding.test_running': 'Testing the connection…',
    'onboarding.test_running_desc': 'Waiting for the provider to answer.',
    'onboarding.test_passed': 'The test passed',
    'onboarding.test_passed_desc': 'The provider {name} is ready to work.',
    'onboarding.test_refused': 'The test failed',
    'onboarding.test_refused_desc':
      'The provider did not accept this key. Try another key, or another provider.',
    'onboarding.test_detail': 'What the daemon said',
    'onboarding.test_continue': 'Name your first project',
    'onboarding.test_retry': 'Try another key',
    'onboarding.test_repick': 'Pick another provider',
    'onboarding.project_title': 'Your first project',
    'onboarding.project_desc': 'Just the name for now, then you describe the idea in the chat.',
    'onboarding.project_label': 'Project name',
    'onboarding.project_placeholder': 'Your project name',
    'onboarding.project_create': 'Create the project',
    'onboarding.project_creating': 'Creating the project…',
    'onboarding.project_failed': 'The daemon could not create the project.',
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

/**
 * `localStorage` key holding the owner's language choice.
 *
 * Named the same way as the desktop theme key (`warsha.theme`, `apps/desktop/src/theme.tsx`), so
 * both preferences read as one family in devtools.
 */
export const LOCALE_STORAGE_KEY = 'warsha.locale';

/** The slice of `Storage` this module needs, so a test can pass its own. */
export interface LocaleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The two properties `<html>` needs to declare a language. */
export interface LocaleRoot {
  lang: string;
  dir: string;
}

/** `localStorage` when the browser gives us one, `null` when it is blocked or absent. */
export function safeLocaleStorage(): LocaleStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** True for the values this package accepts. Anything else is treated as "no choice". */
export function isLocale(value: string | null | undefined): value is Locale {
  return value === 'ar' || value === 'en';
}

/**
 * The stored choice, or Arabic.
 *
 * Arabic is the default because it is the canonical locale of this product (AGENTS.md: UI strings
 * are Arabic-first); an unrecognised stored value is ignored rather than trusted.
 */
export function readStoredLocale(storage: LocaleStorage | null = safeLocaleStorage()): Locale {
  if (!storage) return defaultLocale;
  try {
    const stored = storage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : defaultLocale;
  } catch {
    return defaultLocale;
  }
}

/** Record the choice. A locked store costs the preference at the next launch, nothing else. */
export function persistLocale(
  locale: Locale,
  storage: LocaleStorage | null = safeLocaleStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignored on purpose: losing the preference must not break the switch that already happened.
  }
}

/**
 * Write `lang` and `dir` on the document root.
 *
 * Both are always written together: a document that says `lang="en"` while still laying out right to
 * left is worse than one that declares nothing.
 *
 * @param locale the locale to declare
 * @param root the element to write; `<html>` by default
 * @returns the locale that was written
 */
export function applyLocale(locale: Locale, root?: LocaleRoot | null): Locale {
  const target = root ?? (typeof document === 'undefined' ? null : document.documentElement);
  if (target) {
    target.lang = locale;
    target.dir = direction(locale);
  }
  return locale;
}

// React context for locale (optional, for apps that want it)
const LocaleContext = createContext<{ locale: Locale; setLocale: (l: Locale) => void }>({
  // Outside a provider the app is Arabic, and switching is inert rather than a crash: a component
  // that only *reads* the locale should not require a provider to render.
  locale: defaultLocale,
  setLocale: () => {},
});

export interface LocaleProviderProps {
  children: ReactNode;
  /** The locale to start in; pass the stored choice so a reload comes back in the same language. */
  initialLocale?: Locale;
  /** Storage the choice is written into; defaults to `localStorage`, `null` disables writing. */
  storage?: LocaleStorage | null;
}

/**
 * Hold the language choice for the whole app.
 *
 * Two things make this more than a `useState`:
 *
 *   * **It applies the choice to the document.** `lang` and `dir` on `<html>` follow the locale, so
 *     the browser's own text direction, hyphenation and screen-reader language are right. Both are
 *     written on mount and on every change, which is why mounting the app in English no longer
 *     leaves `<html dir="rtl">` behind.
 *   * **It stores the choice where the choice is made** — in `setLocale`, not in an effect that
 *     watches the locale. An effect would have to guess whether a render is "the user picked
 *     something" or "the app just mounted"; writing from the setter cannot guess wrong, and it keeps
 *     the default locale from being persisted the moment the app is opened.
 */
export function LocaleProvider({
  children,
  initialLocale = defaultLocale,
  storage,
}: LocaleProviderProps) {
  const [locale, setStoredLocale] = useState<Locale>(initialLocale);

  useEffect(() => {
    applyLocale(locale);
  }, [locale]);

  const setLocale = useCallback(
    (next: Locale) => {
      setStoredLocale(next);
      const store = storage === undefined ? safeLocaleStorage() : storage;
      if (store) persistLocale(next, store);
    },
    [storage]
  );

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}

export function useDirection(): 'rtl' | 'ltr' {
  const locale = useLocale();
  return direction(locale);
}

/**
 * The locale *and* the setter, for a control that changes the language.
 *
 * `useLocale()` stays read-only so a screen cannot silently switch the app's language; a language
 * picker asks for this hook and therefore says so in its imports.
 */
export function useLocaleControl(): { locale: Locale; setLocale: (next: Locale) => void } {
  return useContext(LocaleContext);
}