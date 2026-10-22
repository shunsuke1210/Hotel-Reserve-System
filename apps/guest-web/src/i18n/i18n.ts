// 文言の切り替え（react-i18next）。文言はすべてビルドに含め、言語の切り替えで通信しない。
import { LOCALES, type Locale } from '@hotel/contracts';
import i18next, { type i18n as I18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, isLocale } from './locale';
import { DEFAULT_NAMESPACE, NAMESPACES, resources } from './resources';

export type { I18n };

/** 指定した言語で表示する、文言の切り替えの仕組みを作る（アプリやテストごとに別のものを作る） */
export function createI18n(locale: Locale): I18n {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...LOCALES],
    load: 'currentOnly',
    ns: [...NAMESPACES],
    defaultNS: DEFAULT_NAMESPACE,
    // 文言は React が表示するときにエスケープするので、i18next ではエスケープしない
    interpolation: { escapeValue: false },
    initAsync: false,
    react: { useSuspense: false },
  });
  return instance;
}

/** いま表示している言語 */
export function currentLocale(i18n: I18n): Locale {
  return isLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE;
}
