// 前後の客の間の清掃時間の判定（design.md P-11 の TURNOVER_GAP、要件 10.11・10.12）。
// テストケースは test-cases/05-operations.md の 2.8（TC-OP-106〜114・124）のうち、入力だけで決まる部分（時刻の差と
// 2時間未満かどうか、前の客・次の客の見分け方）。部屋の夜の読み込みとお知らせの作成・重複のまとめは、
// modules/notices の結合テスト（notice.service.integration.test.ts）で確かめる。
import { describe, expect, it } from 'vitest';
import { CHECK_IN_HOUR, CHECK_OUT_HOUR } from '../calendar/business-date.js';
import {
  MIN_TURNOVER_MINUTES,
  checkinTimeOf,
  checkoutTimeOf,
  evaluateTurnoverGap,
  judgeTurnover,
  turnoverPointsOf,
  type NightOccupant,
  type OccupiedNight,
} from './turnover-gap.js';

/** 時刻（時・分）を 0:00 からの分にする */
const at = (hour: number, minute = 0): number => hour * 60 + minute;

/** 部屋の夜の客（既定は 11/11〜11/12 の1泊・時間外なし） */
function occupant(overrides: Partial<NightOccupant> = {}): NightOccupant {
  return {
    stayId: 'stay-P',
    arrivalDate: '2026-11-11',
    departureDate: '2026-11-12',
    earlyCheckinHour: null,
    lateCheckoutHour: null,
    ...overrides,
  };
}

describe('定数', () => {
  it('[10.11] チェックアウトは 12:00、チェックインは 15:00、必要な空きは2時間（brief.md FC-03、design.md P-11）', () => {
    expect(CHECK_OUT_HOUR).toBe(12);
    expect(CHECK_IN_HOUR).toBe(15);
    expect(MIN_TURNOVER_MINUTES).toBe(120);
  });
});

describe('前の客のチェックアウト時刻・次の客のチェックイン時刻', () => {
  it('[10.11] レイトがなければ 12:00、あればその時刻', () => {
    expect(checkoutTimeOf(null)).toEqual({ minutes: at(12), late: false });
    expect(checkoutTimeOf(13)).toEqual({ minutes: at(13), late: true });
    expect(checkoutTimeOf(14)).toEqual({ minutes: at(14), late: true });
    expect(checkoutTimeOf(15)).toEqual({ minutes: at(15), late: true });
  });

  it('[10.11] アーリーがなければ 15:00、あればその時刻', () => {
    expect(checkinTimeOf(null)).toEqual({ minutes: at(15), early: false });
    expect(checkinTimeOf(12)).toEqual({ minutes: at(12), early: true });
    expect(checkinTimeOf(13)).toEqual({ minutes: at(13), early: true });
    expect(checkinTimeOf(14)).toEqual({ minutes: at(14), early: true });
  });

  it('レイト（13〜15時）・アーリー（12〜14時）の範囲の外の時刻は RangeError（プログラムの誤り）', () => {
    for (const hour of [12, 16, 13.5]) {
      expect(() => checkoutTimeOf(hour as never)).toThrow(RangeError);
    }
    for (const hour of [11, 15, 12.5]) {
      expect(() => checkinTimeOf(hour as never)).toThrow(RangeError);
    }
  });
});

describe('[10.12] 空きが2時間未満かの判定（設計の例）', () => {
  // design.md P-11・要件 10.12 の例と、test-cases 05 の 2.8 の境界（TC-OP-106〜113）
  it.each([
    {
      title: '12:00 → 15:00（3時間）は作らない。TC-OP-106',
      late: null,
      early: null,
      gap: 180,
      insufficient: false,
    },
    {
      title: '12:00 → アーリー14:00（ちょうど2時間）は作らない。TC-OP-107',
      late: null,
      early: 14,
      gap: 120,
      insufficient: false,
    },
    {
      title: '12:00 → アーリー13:00（1時間）は作る。TC-OP-108',
      late: null,
      early: 13,
      gap: 60,
      insufficient: true,
    },
    {
      title: 'レイト14:00 → 15:00（1時間）は作る。TC-OP-109',
      late: 14,
      early: null,
      gap: 60,
      insufficient: true,
    },
    {
      title: 'レイト15:00 → アーリー13:00（時刻が逆転）は作る。TC-OP-110',
      late: 15,
      early: 13,
      gap: -120,
      insufficient: true,
    },
    {
      title: 'レイト13:00 → 15:00（ちょうど2時間）は作らない。TC-OP-111',
      late: 13,
      early: null,
      gap: 120,
      insufficient: false,
    },
    {
      title: 'レイト13:00 → アーリー14:00（1時間）は作る。TC-OP-112',
      late: 13,
      early: 14,
      gap: 60,
      insufficient: true,
    },
    {
      title: '12:00 → アーリー12:00（0時間）は作る。TC-OP-113',
      late: null,
      early: 12,
      gap: 0,
      insufficient: true,
    },
  ] as const)('$title', ({ late, early, gap, insufficient }) => {
    const result = evaluateTurnoverGap(checkoutTimeOf(late).minutes, checkinTimeOf(early).minutes);
    expect(result).toEqual({ gapMinutes: gap, insufficient });
  });

  it('[10.12] 境目は2時間ちょうど：1時間59分は作り、2時間00分・2時間01分は作らない', () => {
    expect(evaluateTurnoverGap(at(12), at(13, 59))).toEqual({
      gapMinutes: 119,
      insufficient: true,
    });
    expect(evaluateTurnoverGap(at(12), at(14))).toEqual({ gapMinutes: 120, insufficient: false });
    expect(evaluateTurnoverGap(at(12), at(14, 1))).toEqual({
      gapMinutes: 121,
      insufficient: false,
    });
  });

  it('時刻は 0:00〜24:00 の分の整数（外れたら RangeError）', () => {
    expect(() => evaluateTurnoverGap(-1, at(15))).toThrow(RangeError);
    expect(() => evaluateTurnoverGap(at(12), at(24, 1))).toThrow(RangeError);
    expect(() => evaluateTurnoverGap(at(12) + 0.5, at(15))).toThrow(RangeError);
  });
});

describe('[10.11] 同じ部屋の同じ日の前の客と次の客の判定（judgeTurnover）', () => {
  const DATE = '2026-11-12';
  const previous = occupant({ stayId: 'stay-P', departureDate: DATE });
  const next = occupant({ stayId: 'stay-N', arrivalDate: DATE, departureDate: '2026-11-13' });

  it('[10.11] 前の客のチェックアウトから次の客のチェックインまでの空きを判定する（TC-OP-109 の形）', () => {
    expect(judgeTurnover(DATE, { ...previous, lateCheckoutHour: 14 }, next)).toEqual({
      turnover: true,
      checkout: { minutes: at(14), late: true },
      checkin: { minutes: at(15), early: false },
      gapMinutes: 60,
      insufficient: true,
    });
    expect(judgeTurnover(DATE, previous, next)).toMatchObject({
      turnover: true,
      gapMinutes: 180,
      insufficient: false,
    });
  });

  it('[10.11] 前の夜に客がいなければ判定しない（TC-OP-124）', () => {
    expect(judgeTurnover(DATE, undefined, { ...next, earlyCheckinHour: 12 })).toEqual({
      turnover: false,
      reason: 'NO_PREVIOUS_GUEST',
    });
  });

  it('[10.11] その日の夜に客がいなければ判定しない（TC-OP-114：次の客は翌日に着く）', () => {
    expect(judgeTurnover(DATE, { ...previous, lateCheckoutHour: 15 }, undefined)).toEqual({
      turnover: false,
      reason: 'NO_NEXT_GUEST',
    });
  });

  it('[10.11] 前の夜と同じ滞在（連泊の途中）は入れ替わりがないので判定しない', () => {
    const staying = occupant({
      stayId: 'stay-S',
      arrivalDate: '2026-11-11',
      departureDate: '2026-11-14',
      earlyCheckinHour: 12,
      lateCheckoutHour: 15,
    });
    expect(judgeTurnover(DATE, staying, staying)).toEqual({ turnover: false, reason: 'SAME_STAY' });
  });

  it('[10.11] レイトは前の客の出発日、アーリーは次の客の到着日だけに当てる（途中で部屋を移った客などは既定の時刻）', () => {
    // 前の客は予約の出発日が 11/14（この部屋の最後の夜が 11/11 で、11/12 から別の部屋へ移った）→ 12:00
    const movedOut = occupant({
      stayId: 'stay-M',
      departureDate: '2026-11-14',
      lateCheckoutHour: 15,
    });
    // 次の客は予約の到着日が 11/10（別の部屋から 11/12 の夜にこの部屋へ移ってきた）→ 15:00
    const movedIn = occupant({
      stayId: 'stay-I',
      arrivalDate: '2026-11-10',
      departureDate: '2026-11-13',
      earlyCheckinHour: 12,
    });
    expect(judgeTurnover(DATE, movedOut, next)).toMatchObject({
      checkout: { minutes: at(12), late: false },
      gapMinutes: 180,
      insufficient: false,
    });
    expect(judgeTurnover(DATE, previous, movedIn)).toMatchObject({
      checkin: { minutes: at(15), early: false },
      gapMinutes: 180,
      insufficient: false,
    });
  });

  it('日付が YYYY-MM-DD でなければ RangeError', () => {
    expect(() => judgeTurnover('2026/11/12', previous, next)).toThrow(RangeError);
  });
});

describe('[10.11] 判定する部屋・日付（予約の夜の切れ目。turnoverPointsOf）', () => {
  const night = (stayId: string, roomId: string, stayDate: string): OccupiedNight => ({
    stayId,
    roomId,
    stayDate,
  });

  it('[10.11] 連泊は、到着日（前の客との切れ目）と出発日（次の客との切れ目）の2か所', () => {
    expect(
      turnoverPointsOf([
        night('X', 'room-501', '2026-11-12'),
        night('X', 'room-501', '2026-11-10'),
        night('X', 'room-501', '2026-11-11'),
      ]),
    ).toEqual({
      arrivals: [{ roomId: 'room-501', date: '2026-11-10' }],
      departures: [{ roomId: 'room-501', date: '2026-11-13' }],
    });
  });

  it('[10.11] 2室以上の予約は部屋ごと。途中で部屋を移った滞在は、部屋ごとの夜の続きで切れ目を作る', () => {
    expect(
      turnoverPointsOf([
        night('X1', 'room-502', '2026-11-10'),
        night('X1', 'room-502', '2026-11-11'),
        night('X2', 'room-501', '2026-11-10'),
        // X2 は 11/11 の夜から 601 へ移った
        night('X2', 'room-601', '2026-11-11'),
      ]),
    ).toEqual({
      arrivals: [
        { roomId: 'room-501', date: '2026-11-10' },
        { roomId: 'room-502', date: '2026-11-10' },
        { roomId: 'room-601', date: '2026-11-11' },
      ],
      departures: [
        { roomId: 'room-501', date: '2026-11-11' },
        { roomId: 'room-502', date: '2026-11-12' },
        { roomId: 'room-601', date: '2026-11-12' },
      ],
    });
  });

  it('[10.11] 同じ部屋で夜が途切れていれば、それぞれの続きの切れ目。同じ部屋・日付は1つにまとめる', () => {
    expect(
      turnoverPointsOf([
        night('X', 'room-501', '2026-11-10'),
        night('X', 'room-501', '2026-11-12'),
        // 同じ部屋で X の後に Y が泊まる（X の出発の切れ目と Y の到着の切れ目は別の一覧）
        night('Y', 'room-501', '2026-11-13'),
        night('X', 'room-501', '2026-11-10'),
      ]),
    ).toEqual({
      arrivals: [
        { roomId: 'room-501', date: '2026-11-10' },
        { roomId: 'room-501', date: '2026-11-12' },
        { roomId: 'room-501', date: '2026-11-13' },
      ],
      departures: [
        { roomId: 'room-501', date: '2026-11-11' },
        { roomId: 'room-501', date: '2026-11-13' },
        { roomId: 'room-501', date: '2026-11-14' },
      ],
    });
  });

  it('夜がなければ切れ目もない。日付の形が違えば RangeError', () => {
    expect(turnoverPointsOf([])).toEqual({ arrivals: [], departures: [] });
    expect(() => turnoverPointsOf([night('X', 'room-501', '11/12')])).toThrow(RangeError);
  });
});
