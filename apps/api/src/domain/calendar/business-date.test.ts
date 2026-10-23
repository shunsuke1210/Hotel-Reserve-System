// 営業日・暦の日付・境界時刻・早期割の期限・無料キャンセルの期限（design.md BusinessCalendar、UT-BC）。
// テストケースは test-cases/01-pricing.md の 2.1・2.3・2.4。時刻はすべて引数で与え、時計を使わない。
import { describe, expect, it } from 'vitest';
import {
  addDays,
  atJapanTime,
  calendarDate,
  earlyBirdDeadline,
  freeCancellationDeadline,
  isEarlyBirdBooking,
  isWithinFreeCancellation,
  operatingDate,
} from './business-date.js';

/** 日本時間の日時（YYYY-MM-DDTHH:mm）を瞬間にする */
const jst = (dateTime: string): Date => new Date(`${dateTime}:00+09:00`);

describe('operatingDate（1:00 を日の境目とする営業日）', () => {
  it('[3.6] TC-PR-001 0:59 は前日の営業日', () => {
    expect(operatingDate(jst('2026-11-15T00:59'))).toBe('2026-11-14');
  });

  it('[3.6] TC-PR-002 1:00 ちょうどで当日の営業日になる', () => {
    expect(operatingDate(jst('2026-11-15T01:00'))).toBe('2026-11-15');
  });

  it('[3.6] TC-PR-003 1:01 は当日の営業日', () => {
    expect(operatingDate(jst('2026-11-15T01:01'))).toBe('2026-11-15');
  });

  it('[3.6] TC-PR-004 0:00 は暦の日付が変わっても前日の営業日', () => {
    expect(operatingDate(jst('2026-11-15T00:00'))).toBe('2026-11-14');
  });

  it('[3.6] TC-PR-005 23:59 はその日の営業日', () => {
    expect(operatingDate(jst('2026-11-14T23:59'))).toBe('2026-11-14');
  });

  it('[3.6] TC-PR-006 元日の 0:30 は年をまたいで前年の大みそか', () => {
    expect(operatingDate(jst('2027-01-01T00:30'))).toBe('2026-12-31');
  });

  it('[3.6] TC-PR-007 3/1 の 0:59 は月をまたいで 2/28（2027年は平年）', () => {
    expect(operatingDate(jst('2027-03-01T00:59'))).toBe('2027-02-28');
  });

  it('[3.6] TC-PR-008 UTC で与えても日本時間で判定する（2026-11-14T16:00Z ＝ 日本時間 11/15 1:00）', () => {
    expect(operatingDate(new Date('2026-11-14T16:00:00Z'))).toBe('2026-11-15');
  });

  it('[3.6] 最終チェックイン時刻（25:00 ＝ 翌日 1:00）の1ミリ秒前までは、前日が営業日の今日', () => {
    const cutoff = atJapanTime('2026-11-14', 25);
    expect(operatingDate(new Date(cutoff.getTime() - 1))).toBe('2026-11-14');
    expect(operatingDate(cutoff)).toBe('2026-11-15');
  });

  it('時刻として無効な Date は受け付けない', () => {
    expect(() => operatingDate(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe('calendarDate（日本時間の暦の日付）', () => {
  it('[3.5] TC-PR-009 0:30 の暦の日付はその日（同じ時刻の営業日 11/14 とは異なる）', () => {
    const now = jst('2026-11-15T00:30');
    expect(calendarDate(now)).toBe('2026-11-15');
    expect(operatingDate(now)).toBe('2026-11-14');
  });

  it('[3.5] TC-PR-010 2026-11-14T14:59Z（日本時間 23:59）は 11/14', () => {
    expect(calendarDate(new Date('2026-11-14T14:59:00Z'))).toBe('2026-11-14');
  });

  it('[3.5] TC-PR-011 2026-11-14T15:00Z（日本時間 0:00）は 11/15（UTC の日付ではない）', () => {
    expect(calendarDate(new Date('2026-11-14T15:00:00Z'))).toBe('2026-11-15');
  });

  it('時刻として無効な Date は受け付けない', () => {
    expect(() => calendarDate(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe('atJapanTime（日付と時刻から、日本時間の境界時刻の瞬間を作る）', () => {
  it('到着日の 15:00（チェックイン時刻）', () => {
    expect(atJapanTime('2026-11-14', 15).toISOString()).toBe('2026-11-14T06:00:00.000Z');
  });

  it('[3.6] 25:00 は翌日の 1:00（月・年をまたぐ）', () => {
    expect(atJapanTime('2026-12-31', 25).toISOString()).toBe('2026-12-31T16:00:00.000Z');
    expect(calendarDate(atJapanTime('2026-12-31', 25))).toBe('2027-01-01');
  });

  it('0:00 と、分の指定', () => {
    expect(atJapanTime('2026-11-01', 0).toISOString()).toBe('2026-10-31T15:00:00.000Z');
    expect(atJapanTime('2026-11-14', 9, 30).toISOString()).toBe('2026-11-14T00:30:00.000Z');
  });

  it('存在しない日付・範囲外の時刻は受け付けない', () => {
    expect(() => atJapanTime('2027-02-29', 0)).toThrow(RangeError);
    expect(() => atJapanTime('2026-11-14', -1)).toThrow(RangeError);
    expect(() => atJapanTime('2026-11-14', 48)).toThrow(RangeError);
    expect(() => atJapanTime('2026-11-14', 1.5)).toThrow(RangeError);
    expect(() => atJapanTime('2026-11-14', 15, 60)).toThrow(RangeError);
  });
});

describe('addDays（暦の日付に日数を足す）', () => {
  it('月末・年末・うるう年の 2/29 をまたいで足し引きできる', () => {
    expect(addDays('2026-11-14', 1)).toBe('2026-11-15');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-11-14', 0)).toBe('2026-11-14');
    expect(addDays('2026-10-16', 365)).toBe('2027-10-16');
    expect(addDays('2027-11-30', -30)).toBe('2027-10-31');
  });

  it('1955〜2100年の毎日で、標準の暦と一致する', () => {
    const start = Date.UTC(1955, 0, 1);
    const end = Date.UTC(2100, 11, 31);
    const MS_PER_DAY = 86_400_000;
    for (let ms = start; ms < end; ms += MS_PER_DAY) {
      const today = new Date(ms).toISOString().slice(0, 10);
      const tomorrow = new Date(ms + MS_PER_DAY).toISOString().slice(0, 10);
      if (addDays(today, 1) !== tomorrow || addDays(tomorrow, -1) !== today) {
        expect.fail(`${today} と ${tomorrow} の計算が合わない`);
      }
    }
  });

  it('YYYY-MM-DD の形でない日付・存在しない日付・整数でない日数は受け付けない', () => {
    expect(() => addDays('2026/11/14', 1)).toThrow(RangeError);
    expect(() => addDays('2026-11-31', 1)).toThrow(RangeError);
    expect(() => addDays('2026-13-01', 1)).toThrow(RangeError);
    expect(() => addDays('2026-11-14', 0.5)).toThrow(RangeError);
  });
});

describe('earlyBirdDeadline（早期割の期限：暦の上で3か月前の同じ日、なければその月の末日）', () => {
  it.each([
    ['TC-PR-032', '2027-01-15', '2026-10-15', '要件の例'],
    ['TC-PR-033', '2027-02-10', '2026-11-10', '年をまたぐ'],
    ['TC-PR-034', '2027-05-28', '2027-02-28', '同じ日がある'],
    ['TC-PR-035', '2027-05-29', '2027-02-28', '平年は 2/29 がないので月末'],
    ['TC-PR-036', '2027-05-31', '2027-02-28', '要件の例'],
    ['TC-PR-037', '2028-05-29', '2028-02-29', 'うるう年は同じ日がある'],
    ['TC-PR-038', '2028-05-31', '2028-02-29', '要件の例：うるう年'],
    ['TC-PR-039', '2027-07-31', '2027-04-30', '30日までの月は月末'],
    ['TC-PR-040', '2027-03-31', '2026-12-31', '同じ日があり、年をまたぐ'],
  ])('[6.12] %s 到着 %s → %s（%s）', (_id, arrivalDate, expected) => {
    expect(earlyBirdDeadline(arrivalDate)).toBe(expected);
  });

  it('[6.12] 到着が 1〜3月なら前年の 10〜12月になる', () => {
    expect(earlyBirdDeadline('2027-01-01')).toBe('2026-10-01');
    expect(earlyBirdDeadline('2027-03-01')).toBe('2026-12-01');
    expect(earlyBirdDeadline('2026-12-31')).toBe('2026-09-30');
  });

  it('存在しない到着日は受け付けない', () => {
    expect(() => earlyBirdDeadline('2027-02-29')).toThrow(RangeError);
  });
});

describe('isEarlyBirdBooking（予約した暦の日付が早期割の期限以内か）', () => {
  // 到着 2027-02-15 の期限は 2026-11-15
  const arrivalDate = '2027-02-15';

  it('[6.12] TC-PR-041 期限の前日に予約すれば対象', () => {
    expect(isEarlyBirdBooking(jst('2026-11-14T10:00'), arrivalDate)).toBe(true);
  });

  it('[6.12] TC-PR-042 期限の当日 23:59 の予約も対象（期限の日を含む）', () => {
    expect(isEarlyBirdBooking(jst('2026-11-15T23:59'), arrivalDate)).toBe(true);
  });

  it('[6.12] TC-PR-043 期限の翌日 0:00 の予約は対象外（暦の日付で判定し、営業日を使わない）', () => {
    const bookedAt = jst('2026-11-16T00:00');
    expect(operatingDate(bookedAt)).toBe('2026-11-15');
    expect(isEarlyBirdBooking(bookedAt, arrivalDate)).toBe(false);
  });

  it('[6.12] TC-PR-044 期限の翌日 1:00 の予約は対象外', () => {
    expect(isEarlyBirdBooking(jst('2026-11-16T01:00'), arrivalDate)).toBe(false);
  });

  it('[6.12] 5/31 到着は 2/28 まで（うるう年は 2/29 まで）の予約が対象', () => {
    expect(isEarlyBirdBooking(jst('2027-02-28T23:59'), '2027-05-31')).toBe(true);
    expect(isEarlyBirdBooking(jst('2027-03-01T00:00'), '2027-05-31')).toBe(false);
    expect(isEarlyBirdBooking(jst('2028-02-29T23:59'), '2028-05-31')).toBe(true);
    expect(isEarlyBirdBooking(jst('2028-03-01T00:00'), '2028-05-31')).toBe(false);
  });
});

describe('freeCancellationDeadline（無料キャンセルの期限：到着日 15:00 の48時間前）', () => {
  it('[8.3] TC-PR-047 2026-11-14 到着 → 2026-11-12 15:00（日本時間）', () => {
    expect(freeCancellationDeadline('2026-11-14').toISOString()).toBe('2026-11-12T06:00:00.000Z');
  });

  it('[8.3] TC-PR-048 2027-01-01 到着 → 2026-12-30 15:00（年をまたぐ）', () => {
    expect(freeCancellationDeadline('2027-01-01')).toEqual(jst('2026-12-30T15:00'));
  });

  it('[8.3] TC-PR-049 2027-03-01 到着 → 2027-02-27 15:00（平年の2月をまたぐ）', () => {
    expect(freeCancellationDeadline('2027-03-01')).toEqual(jst('2027-02-27T15:00'));
  });

  it('[8.3] TC-PR-050 2028-03-01 到着 → 2028-02-28 15:00（うるう年は 2/29 をはさむ）', () => {
    expect(freeCancellationDeadline('2028-03-01')).toEqual(jst('2028-02-28T15:00'));
  });

  it('[8.3] 返した Date を書き換えても、次の結果に影響しない', () => {
    freeCancellationDeadline('2026-11-14').setFullYear(2000);
    expect(freeCancellationDeadline('2026-11-14').toISOString()).toBe('2026-11-12T06:00:00.000Z');
  });
});

describe('isWithinFreeCancellation（期限のちょうどの時刻を含めて、無料キャンセルの期間内か）', () => {
  const arrivalDate = '2026-11-14';

  it('[8.3] 期限より前は期間内', () => {
    expect(isWithinFreeCancellation(jst('2026-11-12T14:59'), arrivalDate)).toBe(true);
  });

  it('[8.3] 期限ちょうど（到着日 15:00 の48時間前）は無料の側', () => {
    expect(isWithinFreeCancellation(jst('2026-11-12T15:00'), arrivalDate)).toBe(true);
  });

  it('[8.3] 期限を1ミリ秒でも過ぎたら期間外', () => {
    const justAfter = new Date(jst('2026-11-12T15:00').getTime() + 1);
    expect(isWithinFreeCancellation(justAfter, arrivalDate)).toBe(false);
    expect(isWithinFreeCancellation(jst('2026-11-13T10:00'), arrivalDate)).toBe(false);
  });
});
