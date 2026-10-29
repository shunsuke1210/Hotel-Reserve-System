// お知らせのメッセージ（F03 のダイアログに出す本文。スタッフ向けなので日本語だけ）の文言。
// design-screens.md F03 の例と test-cases/05-operations.md TC-OP-115 の形。宿泊客の氏名などは入れない。
import { describe, expect, it } from 'vitest';
import {
  fragmentedInventoryMessage,
  splitFloorsMessage,
  turnoverGapMessage,
} from './notice-messages.js';

const at = (hour: number, minute = 0): number => hour * 60 + minute;

describe('[10.11][10.14] 清掃時間の不足のメッセージ（部屋・日付・両方の時刻）', () => {
  it('[10.11] TC-OP-115：レイト14:00 → 15:00 は「501号室 11/12：…まで1時間しかありません」', () => {
    expect(
      turnoverGapMessage({
        roomNumber: 501,
        date: '2026-11-12',
        checkout: { minutes: at(14), late: true },
        checkin: { minutes: at(15), early: false },
        gapMinutes: 60,
      }),
    ).toBe(
      '501号室 11/12：前の客のレイトチェックアウト 14:00 から次の客のチェックイン 15:00 まで1時間しかありません',
    );
  });

  it('[10.11] アーリーは「次の客のアーリーチェックイン」、既定の時刻は「前の客のチェックアウト」と書く（TC-OP-108）', () => {
    expect(
      turnoverGapMessage({
        roomNumber: 1323,
        date: '2026-01-05',
        checkout: { minutes: at(12), late: false },
        checkin: { minutes: at(13), early: true },
        gapMinutes: 60,
      }),
    ).toBe(
      '1323号室 1/5：前の客のチェックアウト 12:00 から次の客のアーリーチェックイン 13:00 まで1時間しかありません',
    );
  });

  it('[10.11] 分の端数があれば「1時間59分」「59分」と書く', () => {
    const base = {
      roomNumber: 601,
      date: '2026-11-03',
      checkout: { minutes: at(12), late: false },
    } as const;
    expect(
      turnoverGapMessage({
        ...base,
        checkin: { minutes: at(13, 59), early: true },
        gapMinutes: 119,
      }),
    ).toBe(
      '601号室 11/3：前の客のチェックアウト 12:00 から次の客のアーリーチェックイン 13:59 まで1時間59分しかありません',
    );
    expect(
      turnoverGapMessage({
        ...base,
        checkin: { minutes: at(12, 59), early: true },
        gapMinutes: 59,
      }),
    ).toBe(
      '601号室 11/3：前の客のチェックアウト 12:00 から次の客のアーリーチェックイン 12:59 まで59分しかありません',
    );
  });

  it('[10.12] 同じ時刻（TC-OP-113）と、時刻の逆転（TC-OP-110）は、空きがないことを書く', () => {
    expect(
      turnoverGapMessage({
        roomNumber: 501,
        date: '2026-11-12',
        checkout: { minutes: at(12), late: false },
        checkin: { minutes: at(12), early: true },
        gapMinutes: 0,
      }),
    ).toBe(
      '501号室 11/12：前の客のチェックアウト 12:00 と次の客のアーリーチェックイン 12:00 が同じ時刻で、清掃の時間がありません',
    );
    expect(
      turnoverGapMessage({
        roomNumber: 501,
        date: '2026-11-12',
        checkout: { minutes: at(15), late: true },
        checkin: { minutes: at(13), early: true },
        gapMinutes: -120,
      }),
    ).toBe(
      '501号室 11/12：前の客のレイトチェックアウト 15:00 が次の客のアーリーチェックイン 13:00 より後です（時刻が逆転しています）',
    );
  });
});

describe('[10.8][10.14] 連泊できない在庫なしのメッセージ（客室タイプと日程）', () => {
  it('[10.8] F03 の例の形：「スタンダード キング 11/3〜11/5：各夜に空室はありますが、連泊できる部屋がありません」', () => {
    expect(
      fragmentedInventoryMessage({
        roomTypeName: 'スタンダード キング',
        arrivalDate: '2026-11-03',
        departureDate: '2026-11-05',
      }),
    ).toBe('スタンダード キング 11/3〜11/5：各夜に空室はありますが、連泊できる部屋がありません');
  });
});

describe('[10.10][10.14] 離れた部屋のメッセージ（予約番号と部屋）', () => {
  it('[10.10] 予約番号・室数・部屋番号（小さい順）を書く', () => {
    expect(splitFloorsMessage({ reservationNumber: 'AB12CD34EF', roomNumbers: [601, 501] })).toBe(
      '予約 AB12CD34EF：2室が同じ階に収まらず、離れた階の部屋になっています（501・601号室）',
    );
  });
});
