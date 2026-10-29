// 営業日・暦の日付・境界時刻・早期割の期限・無料キャンセルの期限（design.md BusinessCalendar、File Structure Plan の business-date.ts）。
//
// domain の純粋な関数：時計を読まず、データベースも使わない。「今」は呼び出し側が BusinessClock から得て引数で渡す。
// 日付（宿泊日・到着日など）は日本時間の暦の日付を YYYY-MM-DD の文字列で表し、時刻は瞬間（Date）で表す。
import { TZDate } from '@date-fns/tz';

/** 業務で使う時間帯（日本時間。research.md ADR-10。shared/clock の BUSINESS_TIME_ZONE と同じ値） */
export const JAPAN_TIME_ZONE = 'Asia/Tokyo';

/** 営業日の境目の時刻（1:00。最終チェックイン 25:00 ＝ 翌日 1:00。context.md「営業日」） */
export const OPERATING_DAY_START_HOUR = 1;

/** チェックイン時刻（15:00。brief.md FC-03） */
export const CHECK_IN_HOUR = 15;

/** チェックアウト時刻（12:00。brief.md FC-03） */
export const CHECK_OUT_HOUR = 12;

/** 無料キャンセルの期限：到着日のチェックイン時刻の何時間前か（要件 8.3、brief.md PY-07） */
export const FREE_CANCELLATION_HOURS_BEFORE_CHECK_IN = 48;

/** 早期割の期限：到着日の暦の上で何か月前か（要件 6.12、brief.md PR-15） */
export const EARLY_BIRD_MONTHS_BEFORE_ARRIVAL = 3;

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/**
 * 営業日（1:00 を日の境目とする日付）。0:00〜0:59 は前日の営業日（要件 3.6、context.md「営業日」）。
 * 当日予約の締め切り（25:00）とノーショーの判定に使う。
 */
export function operatingDate(now: Date): string {
  return japanDateOf(instantMs(now) - OPERATING_DAY_START_HOUR * MS_PER_HOUR);
}

/** 日本時間の暦の日付（0:00 で変わる）。365日の判定（要件 3.5）や早期割の予約した日に使う */
export function calendarDate(now: Date): string {
  return japanDateOf(instantMs(now));
}

/**
 * 日付と時刻（日本時間）から、境界時刻の瞬間を作る。
 * 時は 0〜47 で、24 以上は翌日の時刻を表す（例：到着日の 25:00 ＝ 翌日 1:00）。
 */
export function atJapanTime(date: string, hour: number, minute = 0): Date {
  if (!Number.isInteger(hour) || hour < 0 || hour > 47) {
    throw new RangeError(`時は 0〜47 の整数で指定してください: ${hour}`);
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new RangeError(`分は 0〜59 の整数で指定してください: ${minute}`);
  }
  const { year, month, day } = parseDate(date);
  const midnight = new TZDate(year, month - 1, day, JAPAN_TIME_ZONE).getTime();
  return new Date(midnight + hour * MS_PER_HOUR + minute * MS_PER_MINUTE);
}

/** 暦の日付に日数を足す（負なら引く） */
export function addDays(date: string, days: number): string {
  if (!Number.isInteger(days)) {
    throw new RangeError(`日数は整数で指定してください: ${days}`);
  }
  const { year, month, day } = parseDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * MS_PER_DAY);
  return formatDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/**
 * 早期割の期限：到着日の暦の上で3か月前の同じ日。その日がない月は、その月の末日（要件 6.12）。
 * 例：2027-01-15 → 2026-10-15、2027-05-31 → 2027-02-28、2028-05-31 → 2028-02-29。
 */
export function earlyBirdDeadline(arrivalDate: string): string {
  const { year, month, day } = parseDate(arrivalDate);
  const monthIndex = year * 12 + (month - 1) - EARLY_BIRD_MONTHS_BEFORE_ARRIVAL;
  const deadlineYear = Math.floor(monthIndex / 12);
  const deadlineMonth = (monthIndex % 12) + 1;
  const deadlineDay = Math.min(day, daysInMonth(deadlineYear, deadlineMonth));
  return formatDate(deadlineYear, deadlineMonth, deadlineDay);
}

/**
 * 予約した時刻の暦の日付が、早期割の期限の日以内か（期限の日を含む）。
 * 予約した日は営業日ではなく暦の日付で判定するので、期限の翌日の 0:00 からは対象外（test-cases Q-PR-02、TC-PR-043）。
 */
export function isEarlyBirdBooking(bookedAt: Date, arrivalDate: string): boolean {
  return calendarDate(bookedAt) <= earlyBirdDeadline(arrivalDate);
}

/** 無料キャンセルの期限：到着日 15:00（日本時間）の48時間前（要件 8.3、design.md P-06） */
export function freeCancellationDeadline(arrivalDate: string): Date {
  const checkIn = atJapanTime(arrivalDate, CHECK_IN_HOUR);
  return new Date(checkIn.getTime() - FREE_CANCELLATION_HOURS_BEFORE_CHECK_IN * MS_PER_HOUR);
}

/** 取り消す時刻が無料キャンセルの期間内か。期限のちょうどの時刻は無料の側（要件 8.3「その時刻ちょうどを含む」） */
export function isWithinFreeCancellation(at: Date, arrivalDate: string): boolean {
  return instantMs(at) <= freeCancellationDeadline(arrivalDate).getTime();
}

/**
 * YYYY-MM-DD の暦の日付を検証して年・月・日に分ける。形が違う、または存在しない日付なら RangeError。
 * 日付の検証は暦の関数の入力（宿泊日・到着日・祝日・特定期間）に共通で使う。
 */
export function parseDate(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) {
    throw new RangeError(`日付は YYYY-MM-DD の形で指定してください: ${date}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // 0〜99年は Date.UTC が 1900年代として扱うため、業務で使わない古い年として受け付けない
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`存在しない日付です: ${date}`);
  }
  return { year, month, day };
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 瞬間の日本時間の暦の日付 */
function japanDateOf(epochMs: number): string {
  const inJapan = new TZDate(epochMs, JAPAN_TIME_ZONE);
  return formatDate(inJapan.getFullYear(), inJapan.getMonth() + 1, inJapan.getDate());
}

function instantMs(instant: Date): number {
  const ms = instant.getTime();
  if (Number.isNaN(ms)) {
    throw new RangeError('時刻として無効な Date です');
  }
  return ms;
}
