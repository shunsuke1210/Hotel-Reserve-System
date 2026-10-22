// 日付・数字・時刻の表示（要件 16.3）。
// - 日付と数字は、選んだ言語の書き方（Intl API）で表示する
// - 時刻は、どの言語・どの端末のタイムゾーンでも日本時間で表示する（24時間制）
import type { Locale } from '@hotel/contracts';

export const JAPAN_TIME_ZONE = 'Asia/Tokyo';

/** 宿泊日などの暦の日付（YYYY-MM-DD） */
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const DATE_PARTS = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  weekday: 'short',
} as const satisfies Intl.DateTimeFormatOptions;

const TIME_PARTS = {
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h23',
} as const satisfies Intl.DateTimeFormatOptions;

/** 日付の値：暦の日付（YYYY-MM-DD）、または日時（Date か、タイムゾーンつきの ISO 8601 の文字列） */
export type DateValue = string | Date;

/** 日時（Date か、タイムゾーンつきの ISO 8601 の文字列） */
export type InstantValue = string | Date;

function toInstant(value: InstantValue): Date {
  const instant = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError(`日時として読めない値です: ${String(value)}`);
  }
  return instant;
}

/**
 * 日付を選んだ言語の書き方で表示する。
 * 暦の日付（宿泊日）はタイムゾーンで日付がずれないようにそのまま表示し、日時は日本時間の日付で表示する。
 */
export function formatDate(value: DateValue, locale: Locale): string {
  const match = typeof value === 'string' ? CALENDAR_DATE.exec(value) : null;
  if (match) {
    const [, year, month, day] = match;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return new Intl.DateTimeFormat(locale, { ...DATE_PARTS, timeZone: 'UTC' }).format(date);
  }
  return new Intl.DateTimeFormat(locale, { ...DATE_PARTS, timeZone: JAPAN_TIME_ZONE }).format(
    toInstant(value),
  );
}

/** 数字を選んだ言語の書き方で表示する */
export function formatNumber(
  value: number,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

/** 時刻を日本時間で表示する（「日本時間」の表記は付けない。表記は JapanTime の部品が付ける） */
export function formatJapanTime(value: InstantValue, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { ...TIME_PARTS, timeZone: JAPAN_TIME_ZONE }).format(
    toInstant(value),
  );
}

/** 日付と時刻を日本時間で表示する（「日本時間」の表記は付けない） */
export function formatJapanDateTime(value: InstantValue, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    ...DATE_PARTS,
    ...TIME_PARTS,
    timeZone: JAPAN_TIME_ZONE,
  }).format(toInstant(value));
}
