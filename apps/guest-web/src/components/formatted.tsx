// 日付・数字・時刻を、選んだ言語の書き方で表示する共通部品（要件 16.3）。
// 時刻はどの言語でも日本時間で表示し、横に「日本時間」の表記を付ける（design-screens.md 共通の約束）。
import { useTranslation } from 'react-i18next';
import {
  formatDate,
  formatJapanDateTime,
  formatJapanTime,
  formatNumber,
  type DateValue,
  type InstantValue,
} from '../i18n/format';
import { currentLocale } from '../i18n/i18n';

function useLocale() {
  const { i18n } = useTranslation();
  return currentLocale(i18n);
}

function toIsoString(value: InstantValue): string {
  return (typeof value === 'string' ? new Date(value) : value).toISOString();
}

/** 日付（宿泊日 YYYY-MM-DD、または日時の日本時間の日付） */
export function LocalDate({ value }: { value: DateValue }) {
  const locale = useLocale();
  return (
    <time dateTime={typeof value === 'string' ? value : value.toISOString()}>
      {formatDate(value, locale)}
    </time>
  );
}

/** 数字 */
export function LocalNumber({
  value,
  options,
}: {
  value: number;
  options?: Intl.NumberFormatOptions;
}) {
  const locale = useLocale();
  return <>{formatNumber(value, locale, options)}</>;
}

/** 時刻（日本時間。withDate で日付も表示する） */
export function JapanTime({
  value,
  withDate = false,
}: {
  value: InstantValue;
  withDate?: boolean;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const time = withDate ? formatJapanDateTime(value, locale) : formatJapanTime(value, locale);
  return <time dateTime={toIsoString(value)}>{t('time.japanTime', { time })}</time>;
}
