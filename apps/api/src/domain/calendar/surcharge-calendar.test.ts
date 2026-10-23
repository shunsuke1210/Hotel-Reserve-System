// その夜の割増（金・土・祝前日の曜日割増と特定期間割増のうち高いほう。design.md BusinessCalendar、P-01 手順1、UT-BC）。
// テストケースは test-cases/01-pricing.md の 2.2。祝日は入力で渡す（共通の前提：内閣府「国民の祝日」の一覧）。
import { describe, expect, it } from 'vitest';
import { loadHolidays } from '../../../prisma/seed/holidays.js';
import {
  isWeekendOrHolidayEve,
  surchargeFor,
  type SpecialSurchargePeriod,
} from './surcharge-calendar.js';

/** 共通の前提：初期データと同じ、内閣府の祝日の一覧（振替休日・国民の休日を含む） */
const HOLIDAYS: ReadonlySet<string> = new Set(loadHolidays().map((holiday) => holiday.date));
/** 曜日割増（料金の版1の初期値 +20%） */
const WEEKEND_BP = 2000;
const NEW_YEAR: SpecialSurchargePeriod[] = [{ start: '2026-12-28', end: '2027-01-03', bp: 3000 }];

const surcharge = (stayDate: string, specialPeriods: SpecialSurchargePeriod[] = []) =>
  surchargeFor(stayDate, WEEKEND_BP, specialPeriods, HOLIDAYS);

describe('surchargeFor：曜日割増（金曜・土曜・祝前日の夜）', () => {
  it.each([
    ['TC-PR-012', '2026-11-12', 0, '木。翌日は祝日でない'],
    ['TC-PR-013', '2026-11-13', 2000, '金'],
    ['TC-PR-014', '2026-11-14', 2000, '土'],
    ['TC-PR-015', '2026-11-15', 0, '日。翌日は祝日でない'],
    ['TC-PR-016', '2026-11-22', 2000, '日。翌日 11/23 が勤労感謝の日（祝前日）'],
    ['TC-PR-017', '2026-11-23', 0, '月・祝日。祝日当日の夜は対象外'],
    ['TC-PR-018', '2027-03-21', 2000, '日・春分の日。翌日が振替休日（振替休日の前日も祝前日）'],
    ['TC-PR-019', '2027-03-22', 0, '月・振替休日。翌日は祝日でない'],
    ['TC-PR-020', '2026-09-21', 2000, '月・敬老の日。翌日が国民の休日'],
    ['TC-PR-021', '2027-05-04', 2000, '火・みどりの日。翌日もこどもの日（連休中の休日の前日）'],
    ['TC-PR-022', '2027-05-05', 0, '水・連休の最終日'],
  ])('[6.6] %s 宿泊日 %s → %i（%s）', (_id, stayDate, expected) => {
    expect(surcharge(stayDate)).toBe(expected);
  });

  it('[6.8] TC-PR-023 土曜と祝前日が重なっても1つだけ（2027-03-20 → 2000。4000 にしない）', () => {
    expect(surcharge('2027-03-20')).toBe(2000);
  });

  it('[6.6] 2026年の連休：平日（月・火）でも翌日が休日なら対象で、振替休日（5/6 水）の夜は対象外', () => {
    expect(surcharge('2026-05-04')).toBe(2000); // 月・みどりの日。翌日がこどもの日
    expect(surcharge('2026-05-05')).toBe(2000); // 火・こどもの日。翌日が振替休日
    expect(surcharge('2026-05-06')).toBe(0); // 水・振替休日。翌日は祝日でない
  });

  it('[6.6] 曜日割増の率は引数の値を使う（料金の版で変えられる）', () => {
    expect(surchargeFor('2026-11-13', 1500, [], HOLIDAYS)).toBe(1500);
    expect(surchargeFor('2026-11-12', 1500, [], HOLIDAYS)).toBe(0);
  });

  it('[6.6] 祝前日の判定は入力で渡した祝日だけを使う（祝日を渡さなければ日曜の夜は対象外）', () => {
    expect(surchargeFor('2026-11-22', WEEKEND_BP, [], new Set())).toBe(0);
    expect(surchargeFor('2026-11-22', WEEKEND_BP, [], new Set(['2026-11-23']))).toBe(2000);
  });
});

describe('surchargeFor：特定期間割増と、重なったときの高いほう', () => {
  it('[6.7] TC-PR-024 期間の前日（日。翌日は祝日でない）は 0', () => {
    expect(surcharge('2026-12-27', NEW_YEAR)).toBe(0);
  });

  it('[6.7] TC-PR-025 開始日は期間の率', () => {
    expect(surcharge('2026-12-28', NEW_YEAR)).toBe(3000);
  });

  it('[6.7] TC-PR-026 終了日も期間の率', () => {
    expect(surcharge('2027-01-03', NEW_YEAR)).toBe(3000);
  });

  it('[6.7] TC-PR-027 終了日の翌日（月。翌日は祝日でない）は 0', () => {
    expect(surcharge('2027-01-04', NEW_YEAR)).toBe(0);
  });

  it('[6.8] TC-PR-028 祝前日（2000）と特定期間（3000）が重なれば高いほう（2026-12-31 → 3000）', () => {
    expect(surcharge('2026-12-31', NEW_YEAR)).toBe(3000);
  });

  const LOW_PERIOD: SpecialSurchargePeriod[] = [
    { start: '2026-11-13', end: '2026-11-15', bp: 1000 },
  ];

  it('[6.8] TC-PR-029 曜日（2000）が特定期間（1000）より高ければ曜日の率（2026-11-13 金）', () => {
    expect(surcharge('2026-11-13', LOW_PERIOD)).toBe(2000);
  });

  it('[6.7] TC-PR-030 特定期間だけが当てはまる夜は期間の率（2026-11-15 日 → 1000）', () => {
    expect(surcharge('2026-11-15', LOW_PERIOD)).toBe(1000);
  });

  it('[6.8] TC-PR-031 曜日と特定期間が同じ率でも足さない（2026-11-14 土 → 2000）', () => {
    expect(surcharge('2026-11-14', [{ start: '2026-11-14', end: '2026-11-14', bp: 2000 }])).toBe(
      2000,
    );
  });

  it('[6.8] 特定期間が複数当てはまっても、最も高い率を1つだけ使う', () => {
    const periods: SpecialSurchargePeriod[] = [
      { start: '2026-12-20', end: '2026-12-31', bp: 2500 },
      { start: '2026-12-28', end: '2027-01-03', bp: 4000 },
      { start: '2026-12-30', end: '2026-12-30', bp: 3000 },
    ];
    expect(surcharge('2026-12-30', periods)).toBe(4000);
    expect(surcharge('2026-12-24', periods)).toBe(2500);
  });

  it('[6.7] 当てはまる割増がない夜は 0', () => {
    expect(surcharge('2026-11-16', LOW_PERIOD)).toBe(0);
  });
});

describe('isWeekendOrHolidayEve（金曜・土曜・祝前日の夜か）', () => {
  it('[6.6] 金・土・祝前日の夜だけが当てはまる', () => {
    expect(isWeekendOrHolidayEve('2026-11-13', HOLIDAYS)).toBe(true);
    expect(isWeekendOrHolidayEve('2026-11-14', HOLIDAYS)).toBe(true);
    expect(isWeekendOrHolidayEve('2027-03-21', HOLIDAYS)).toBe(true);
    expect(isWeekendOrHolidayEve('2026-11-16', HOLIDAYS)).toBe(false);
    expect(isWeekendOrHolidayEve('2026-11-23', HOLIDAYS)).toBe(false);
  });
});

describe('入力の検証', () => {
  it('YYYY-MM-DD の形でない・存在しない宿泊日や期間の日付は受け付けない', () => {
    expect(() => surcharge('2026/11/13')).toThrow(RangeError);
    expect(() => surcharge('2027-02-29')).toThrow(RangeError);
    expect(() =>
      surcharge('2026-11-13', [{ start: '2026-11-31', end: '2026-12-01', bp: 1000 }]),
    ).toThrow(RangeError);
  });
});
