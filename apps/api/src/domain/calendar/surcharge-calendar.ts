// その夜に適用する割増（design.md BusinessCalendar.surchargeFor、P-01 手順1、File Structure Plan の surcharge-calendar.ts）。
//
// 曜日割増（金曜・土曜・祝前日の夜。要件 6.6）と特定期間割増（要件 6.7）のうち、当てはまる最も高い率を1つだけ返す（要件 6.8）。
// 祝日の一覧と特定期間は呼び出し側がデータベース（holidays・special_surcharge_periods）から読んで入力で渡す。
import type { BasisPoints } from '@hotel/contracts';
import { addDays, parseDate } from './business-date.js';

/** 特定期間割増（開始日・終了日を含む。日付は YYYY-MM-DD） */
export interface SpecialSurchargePeriod {
  start: string;
  end: string;
  bp: BasisPoints;
}

const FRIDAY = 5;
const SATURDAY = 6;

/**
 * 宿泊日の夜が、曜日割増の対象（金曜・土曜・祝前日の夜）か。
 * 祝前日は、翌日が祝日の一覧（国民の祝日・振替休日・国民の休日。context.md「祝前日」）にある日。
 */
export function isWeekendOrHolidayEve(stayDate: string, holidays: ReadonlySet<string>): boolean {
  const weekday = dayOfWeek(stayDate);
  return weekday === FRIDAY || weekday === SATURDAY || holidays.has(addDays(stayDate, 1));
}

/**
 * 宿泊日の夜に適用する割増の率（bp）。当てはまる割増がなければ 0。
 * 曜日割増と特定期間割増が重なっても足さず、最も高い率を1つだけ使う（要件 6.8、brief.md PR-05）。
 */
export function surchargeFor(
  stayDate: string,
  weekendBp: BasisPoints,
  specialPeriods: readonly SpecialSurchargePeriod[],
  holidays: ReadonlySet<string>,
): BasisPoints {
  let surcharge: BasisPoints = 0;
  if (isWeekendOrHolidayEve(stayDate, holidays)) {
    surcharge = Math.max(surcharge, weekendBp);
  }
  for (const period of specialPeriods) {
    parseDate(period.start);
    parseDate(period.end);
    if (period.start <= stayDate && stayDate <= period.end) {
      surcharge = Math.max(surcharge, period.bp);
    }
  }
  return surcharge;
}

/** 曜日（0＝日曜〜6＝土曜） */
function dayOfWeek(date: string): number {
  const { year, month, day } = parseDate(date);
  // 1970-01-01 は木曜日（4）
  const epochDay = Date.UTC(year, month - 1, day) / 86_400_000;
  return (((epochDay + 4) % 7) + 7) % 7;
}
