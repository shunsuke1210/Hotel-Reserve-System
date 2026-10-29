// メールの金額・日付・時刻の書き方（要件 16.3：日付と数字は選んだ言語の書き方、時刻はどの言語でも日本時間）。
// 書式は Intl API（Node の ICU）で作る。時刻は日本時間（Asia/Tokyo）で示し、「日本時間」の表記を付ける。
import type { Locale } from '@hotel/contracts';
import { BUSINESS_TIME_ZONE } from '../../shared/clock/business-clock.js';

export interface MailFormat {
  readonly locale: Locale;
  /** 円の金額（0以上の整数）。例：ja「61,900円」、en「JPY 61,900」 */
  yen(amount: number): string;
  /** 暦の日付（YYYY-MM-DD）。例：ja「2026年11月20日(金)」、en「Fri, November 20, 2026」 */
  date(isoDate: string): string;
  /** 瞬間を日本時間の日時で。例：ja「2026年11月18日 15:00（日本時間）」 */
  dateTime(instant: string): string;
  /** 時刻（時。25 は翌日 1:00 を表す 25:00）。例：「15:00」「1:00」 */
  hour(hour: number): string;
  /** 到着日から出発日までの泊数 */
  nights(arrivalDate: string, departureDate: string): number;
  /** 数（人数・室数など）。例：「1,234」 */
  count(value: number): string;
}

const YEN: Readonly<Record<Locale, (formatted: string) => string>> = {
  ja: (n) => `${n}円`,
  en: (n) => `JPY ${n}`,
  ko: (n) => `${n}엔`,
  'zh-Hans': (n) => `${n}日元`,
  'zh-Hant': (n) => `${n}日圓`,
};

/** 時刻の後ろに付ける「日本時間」の表記 */
const JAPAN_TIME_SUFFIX: Readonly<Record<Locale, string>> = {
  ja: '（日本時間）',
  en: ' (Japan time)',
  ko: '(일본 시간)',
  'zh-Hans': '（日本时间）',
  'zh-Hant': '（日本時間）',
};

const MS_PER_DAY = 86_400_000;

/** YYYY-MM-DD を UTC の 0:00 の瞬間にする（暦の日付として書式にするため） */
function utcMidnight(isoDate: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new RangeError('日付は YYYY-MM-DD で指定してください');
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function mailFormat(locale: Locale): MailFormat {
  const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const dateFormat = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
  const dateTimeFormat = new Intl.DateTimeFormat(locale, {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return {
    locale,
    yen(amount) {
      if (!Number.isInteger(amount) || amount < 0) {
        throw new RangeError('金額は0以上の整数で指定してください');
      }
      return YEN[locale](numberFormat.format(amount));
    },
    date: (isoDate) => dateFormat.format(utcMidnight(isoDate)),
    dateTime(instant) {
      const date = new Date(instant);
      if (Number.isNaN(date.getTime())) throw new RangeError('日時として解釈できません');
      return `${dateTimeFormat.format(date)}${JAPAN_TIME_SUFFIX[locale]}`;
    },
    hour: (hour) => `${hour}:00`,
    nights: (arrivalDate, departureDate) =>
      Math.round(
        (utcMidnight(departureDate).getTime() - utcMidnight(arrivalDate).getTime()) / MS_PER_DAY,
      ),
    count: (value) => numberFormat.format(value),
  };
}

/** 時刻の後ろに付ける「日本時間」の表記（catalog で時刻だけを示すときに使う） */
export function japanTimeSuffix(locale: Locale): string {
  return JAPAN_TIME_SUFFIX[locale];
}
