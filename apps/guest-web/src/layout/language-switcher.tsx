// 言語の切り替え（要件 16.1。design-screens.md 共通の約束：全画面の右上で5言語を切り替える）
import { LOCALES } from '@hotel/contracts';
import { useTranslation } from 'react-i18next';
import { currentLocale } from '../i18n/i18n';
import { LOCALE_LABELS, isLocale } from '../i18n/locale';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  return (
    <label className="language-switcher">
      <span className="language-switcher__label">{t('language.label')}</span>
      <select
        value={currentLocale(i18n)}
        onChange={(event) => {
          if (isLocale(event.target.value)) void i18n.changeLanguage(event.target.value);
        }}
      >
        {LOCALES.map((locale) => (
          <option key={locale} value={locale} lang={locale}>
            {LOCALE_LABELS[locale]}
          </option>
        ))}
      </select>
    </label>
  );
}
