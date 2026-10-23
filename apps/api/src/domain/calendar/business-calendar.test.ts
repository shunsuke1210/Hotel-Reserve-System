// BusinessCalendar（design.md Components and Interfaces）：祝日の一覧を入力で受け取り、暦のルールをまとめて提供する。
import { describe, expect, it } from 'vitest';
import { loadHolidays } from '../../../prisma/seed/holidays.js';
import { createBusinessCalendar, type BusinessCalendar } from './business-calendar.js';

const holidays2026to2027 = loadHolidays()
  .map((holiday) => holiday.date)
  .filter((date) => date >= '2026-01-01' && date <= '2027-12-31');

describe('createBusinessCalendar（祝日の一覧から BusinessCalendar を作る）', () => {
  const calendar: BusinessCalendar = createBusinessCalendar(holidays2026to2027);

  it('[3.6] 営業日：0:59 は前日、1:00 は当日', () => {
    expect(calendar.operatingDate(new Date('2026-11-15T00:59:00+09:00'))).toBe('2026-11-14');
    expect(calendar.operatingDate(new Date('2026-11-15T01:00:00+09:00'))).toBe('2026-11-15');
  });

  it('[3.5] 暦の日付は 0:00 で変わる', () => {
    expect(calendar.calendarDate(new Date('2026-11-15T00:00:00+09:00'))).toBe('2026-11-15');
  });

  it('[6.6] 振替休日の前日が割増の対象（祝日は作るときに渡した一覧を使う）', () => {
    expect(calendar.surchargeFor('2027-03-21', 2000, [])).toBe(2000);
    expect(createBusinessCalendar([]).surchargeFor('2027-03-21', 2000, [])).toBe(0);
  });

  it('[6.7][6.8] 特定期間と曜日割増のうち高いほう', () => {
    const periods = [{ start: '2026-12-28', end: '2027-01-03', bp: 3000 }];
    expect(calendar.surchargeFor('2026-12-31', 2000, periods)).toBe(3000);
    expect(calendar.surchargeFor('2027-01-04', 2000, periods)).toBe(0);
  });

  it('[6.12] 早期割の期限：5/31 到着は 2/28（うるう年は 2/29）', () => {
    expect(calendar.earlyBirdDeadline('2027-05-31')).toBe('2027-02-28');
    expect(calendar.earlyBirdDeadline('2028-05-31')).toBe('2028-02-29');
  });

  it('[8.3] 無料キャンセルの期限：到着日 15:00 の48時間前', () => {
    expect(calendar.freeCancellationDeadline('2026-11-14').toISOString()).toBe(
      '2026-11-12T06:00:00.000Z',
    );
  });

  it('作った後に、渡した祝日の配列を書き換えても影響しない', () => {
    const source = ['2027-03-22'];
    const copied = createBusinessCalendar(source);
    source.length = 0;
    expect(copied.surchargeFor('2027-03-21', 2000, [])).toBe(2000);
  });

  it('YYYY-MM-DD の形でない・存在しない祝日の日付は受け付けない', () => {
    expect(() => createBusinessCalendar(['2026/11/23'])).toThrow(RangeError);
    expect(() => createBusinessCalendar(['2026-02-30'])).toThrow(RangeError);
  });
});
