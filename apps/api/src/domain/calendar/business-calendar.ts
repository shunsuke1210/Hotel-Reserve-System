// BusinessCalendar（design.md Components and Interfaces）：営業日・境界時刻・割増の対象日・早期割の期限・無料キャンセルの期限。
//
// 祝日の判定は holidays テーブルの内容だけを使う（design.md Allowed Dependencies）。domain はデータベースを読まないので、
// 呼び出し側（modules のサービス）が祝日の一覧を読み、createBusinessCalendar に渡して作る。
import type { BasisPoints } from '@hotel/contracts';
import {
  calendarDate,
  earlyBirdDeadline,
  freeCancellationDeadline,
  operatingDate,
  parseDate,
} from './business-date.js';
import { surchargeFor, type SpecialSurchargePeriod } from './surcharge-calendar.js';

export interface BusinessCalendar {
  /** 1:00 を日の境目とする営業日（0:00〜0:59 は前日） */
  operatingDate(now: Date): string;
  /** 日本時間の暦の日付 */
  calendarDate(now: Date): string;
  /** その夜の割増（曜日割増と特定期間のうち高いほう。なければ 0） */
  surchargeFor(
    stayDate: string,
    weekendBp: BasisPoints,
    specialPeriods: readonly SpecialSurchargePeriod[],
  ): BasisPoints;
  /** 暦の上で3か月前の同じ日（なければ月末） */
  earlyBirdDeadline(arrivalDate: string): string;
  /** 到着日 15:00 の48時間前 */
  freeCancellationDeadline(arrivalDate: string): Date;
}

/**
 * 祝日の一覧（YYYY-MM-DD。振替休日・国民の休日を含む）から BusinessCalendar を作る。
 * 一覧は作った時点で写し取るので、後で元の配列を書き換えても影響しない。形が違う・存在しない日付は RangeError。
 */
export function createBusinessCalendar(holidays: Iterable<string>): BusinessCalendar {
  const holidaySet = new Set<string>();
  for (const holiday of holidays) {
    parseDate(holiday);
    holidaySet.add(holiday);
  }
  return {
    operatingDate,
    calendarDate,
    surchargeFor: (stayDate, weekendBp, specialPeriods) =>
      surchargeFor(stayDate, weekendBp, specialPeriods, holidaySet),
    earlyBirdDeadline,
    freeCancellationDeadline,
  };
}
