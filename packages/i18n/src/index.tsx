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
    'gate.approve': 'موافقة',
    'gate.reject': 'رفض',
    'gate.request_changes': 'طلب تعديلات',
    'run.status': 'حالة التشغيل: {status}',
    'budget.remaining': 'الميزانية المتبقية: {amount}',
  },
  en: {
    'app.name': 'Warsha',
    'app.tagline': 'Arabic-first AI software factory',
    'gate.approve': 'Approve',
    'gate.reject': 'Reject',
    'gate.request_changes': 'Request changes',
    'run.status': 'Run status: {status}',
    'budget.remaining': 'Remaining budget: {amount}',
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