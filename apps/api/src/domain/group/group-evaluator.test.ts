// 団体の判定（design.md GroupEvaluator、処理仕様 P-08、設計の補足 DT-M32・L-41、brief.md PY-14・PY-14a・PY-14b）。
// テストケースは test-cases/04-change-cancel.md の 2.9（TC-CH-096〜098・100〜103・105・106・220〜223）と
// 03-booking.md の TC-RS-280・TC-RS-284 のうち、入力だけで決まる部分（最大室数・is_group・合算で団体にする予約）。
// 確保の時点で判定しないこと（P-04 手順5 で確定の後に呼ぶ）・同じ会員の予約を集めること・行のロックと保存、
// 団体の規定によるキャンセル料（TC-CH-099・104）は、5.x・6.x の結合テストで確かめる。
import { RESERVATION_STATUSES, type ReservationStatus } from '@hotel/contracts';
import { describe, expect, it } from 'vitest';
import { addDays } from '../calendar/business-date.js';
import {
  GROUP_AGGREGATED_STATUSES,
  GROUP_MIN_ROOM_COUNT,
  evaluateGroup,
  groupEvaluator,
  isGroupByNightlySum,
  peakNightlyRoomCount,
  type GroupTarget,
  type MemberReservation,
} from './group-evaluator.js';

/** 到着日から泊数分の夜（出発日は含まない。context.md「夜」） */
function nightsOf(arrivalDate: string, nightCount: number): string[] {
  return Array.from({ length: nightCount }, (_, index) => addDays(arrivalDate, index));
}

/** 確定・変更する予約（既定は確保の時点の値：max_room_count＝0・is_group＝false。L-41） */
function target(
  arrivalDate: string,
  nightCount: number,
  roomCount: number,
  previous: { maxRoomCount?: number; isGroup?: boolean } = {},
): GroupTarget {
  return {
    id: 'target',
    nights: nightsOf(arrivalDate, nightCount),
    roomCount,
    maxRoomCount: previous.maxRoomCount ?? 0,
    isGroup: previous.isGroup ?? false,
  };
}

/** 同じ会員のほかの予約（既定は CONFIRMED・is_group＝false） */
function other(
  id: string,
  arrivalDate: string,
  nightCount: number,
  roomCount: number,
  options: { status?: ReservationStatus; isGroup?: boolean } = {},
): MemberReservation {
  return {
    id,
    nights: nightsOf(arrivalDate, nightCount),
    roomCount,
    status: options.status ?? 'CONFIRMED',
    isGroup: options.isGroup ?? false,
  };
}

describe('定数', () => {
  it('[8.7][8.8] 団体になる室数は5', () => {
    expect(GROUP_MIN_ROOM_COUNT).toBe(5);
  });

  it('[8.8] DT-M32：合算の対象は確定済み・滞在中・チェックアウト済み・ノーショーだけ', () => {
    expect([...GROUP_AGGREGATED_STATUSES].sort()).toEqual(
      ['CHECKED_IN', 'CHECKED_OUT', 'CONFIRMED', 'NO_SHOW'].sort(),
    );
  });
});

describe('予約の最大室数による団体の判定（8.7）', () => {
  it('[8.7] TC-RS-280・TC-RS-284：確保（max_room_count＝0）の後に5室で確定すると、max_room_count＝5・団体', () => {
    const result = evaluateGroup(target('2026-12-01', 1, 5), []);
    expect(result).toEqual({
      maxRoomCount: 5,
      isGroup: true,
      peakNightlyRoomCount: 5,
      othersToMarkAsGroup: [],
    });
  });

  it('[8.7] TC-CH-096：4室の予約は団体でない（max_room_count＝4）', () => {
    const result = evaluateGroup(target('2026-11-16', 2, 4), []);
    expect(result.maxRoomCount).toBe(4);
    expect(result.isGroup).toBe(false);
  });

  it('[8.7] TC-CH-097：4室の予約を5室に変えると団体になる（max_room_count＝5）', () => {
    const result = evaluateGroup(target('2026-11-16', 2, 5, { maxRoomCount: 4 }), []);
    expect(result.maxRoomCount).toBe(5);
    expect(result.isGroup).toBe(true);
  });

  it('[8.7] TC-CH-098：5室の団体の予約を4室に減らしても団体のまま（max_room_count＝5 のまま）', () => {
    const result = evaluateGroup(
      target('2026-11-30', 3, 4, { maxRoomCount: 5, isGroup: true }),
      [],
    );
    expect(result.maxRoomCount).toBe(5);
    expect(result.isGroup).toBe(true);
  });

  it('[8.7] PY-14：一度5室になった予約は、is_group が false で渡されても max_room_count から団体にする', () => {
    const result = evaluateGroup(target('2026-11-30', 3, 1, { maxRoomCount: 5 }), []);
    expect(result.maxRoomCount).toBe(5);
    expect(result.isGroup).toBe(true);
  });

  it('[8.7] 室数が減っても max_room_count は下げない（3室 → 2室で3のまま）', () => {
    const result = evaluateGroup(target('2026-11-16', 2, 2, { maxRoomCount: 3 }), []);
    expect(result.maxRoomCount).toBe(3);
    expect(result.isGroup).toBe(false);
  });
});

describe('同じ会員の予約の夜ごとの合算（8.8）', () => {
  // 予約X：スタンダード キング3室・夜 11/16・11/17（出発 11/18）
  const reservationX = (options: { status?: ReservationStatus; isGroup?: boolean } = {}) =>
    other('X', '2026-11-16', 2, 3, options);

  it('[8.8] TC-CH-100：X（3室・11/16〜17）と重なる Y（2室・11/17〜18）を確定すると、11/17 が5室で X・Y とも団体', () => {
    const result = evaluateGroup(target('2026-11-17', 2, 2), [reservationX()]);
    expect(result).toEqual({
      maxRoomCount: 2,
      isGroup: true,
      peakNightlyRoomCount: 5,
      othersToMarkAsGroup: ['X'],
    });
  });

  it('[8.8] TC-CH-101：X の出発日 11/18 に到着する Y（2室・11/18〜19）は夜が重ならないので、どちらも団体でない', () => {
    const result = evaluateGroup(target('2026-11-18', 2, 2), [reservationX()]);
    expect(result.isGroup).toBe(false);
    expect(result.peakNightlyRoomCount).toBe(2);
    expect(result.othersToMarkAsGroup).toEqual([]);
  });

  it('[8.8] TC-CH-102：Y（1室・11/17）を足しても 11/17 は4室なので、どちらも団体でない', () => {
    const result = evaluateGroup(target('2026-11-17', 1, 1), [reservationX()]);
    expect(result.isGroup).toBe(false);
    expect(result.peakNightlyRoomCount).toBe(4);
    expect(result.othersToMarkAsGroup).toEqual([]);
  });

  it('[8.8] TC-CH-103・PY-14b：別の会員の予約は渡さない（同じ会員の予約を集めるのは呼び出し側）ので、2室は団体でない', () => {
    const result = evaluateGroup(target('2026-11-17', 1, 2), []);
    expect(result.isGroup).toBe(false);
    expect(result.othersToMarkAsGroup).toEqual([]);
  });

  it('[8.8] TC-CH-106：X を3泊（11/18 を追加）に変えると、Y（2室・11/18〜19）と 11/18 が5室になり X・Y とも団体', () => {
    const changedX = { ...target('2026-11-16', 3, 3, { maxRoomCount: 3 }), id: 'X' };
    const result = evaluateGroup(changedX, [other('Y', '2026-11-18', 2, 2)]);
    expect(result).toEqual({
      maxRoomCount: 3,
      isGroup: true,
      peakNightlyRoomCount: 5,
      othersToMarkAsGroup: ['Y'],
    });
  });

  it('[8.8] TC-CH-220：取消済みの予約Z（3室・11/17）は合算しないので、Y（2室・11/17）は団体でない', () => {
    const result = evaluateGroup(target('2026-11-17', 1, 2), [
      other('Z', '2026-11-17', 1, 3, { status: 'CANCELLED' }),
    ]);
    expect(result.isGroup).toBe(false);
    expect(result.peakNightlyRoomCount).toBe(2);
    expect(result.othersToMarkAsGroup).toEqual([]);
  });

  it('[8.8] TC-CH-221：X の変更では、決済待ちの Y（2室・11/17）を合算せず、Y も団体にしない', () => {
    const changedX = { ...target('2026-11-16', 2, 3, { maxRoomCount: 3 }), id: 'X' };
    const result = evaluateGroup(changedX, [
      other('Y', '2026-11-17', 1, 2, { status: 'PENDING_PAYMENT' }),
    ]);
    expect(result.isGroup).toBe(false);
    expect(result.peakNightlyRoomCount).toBe(3);
    expect(result.othersToMarkAsGroup).toEqual([]);
  });

  it('[8.8] TC-CH-222：決済待ちだった Y（2室・11/17）を確定した時点で判定し、X（3室）と合わせて5室で X・Y とも団体', () => {
    const result = evaluateGroup(target('2026-11-17', 1, 2), [reservationX()]);
    expect(result.isGroup).toBe(true);
    expect(result.maxRoomCount).toBe(2);
    expect(result.othersToMarkAsGroup).toEqual(['X']);
  });

  it('[8.8] TC-CH-223：滞在中（CHECKED_IN）の X を合算し、Y（2室・11/17）と5室で X・Y とも団体', () => {
    const result = evaluateGroup(target('2026-11-17', 1, 2), [
      reservationX({ status: 'CHECKED_IN' }),
    ]);
    expect(result.isGroup).toBe(true);
    expect(result.othersToMarkAsGroup).toEqual(['X']);
  });

  it.each(RESERVATION_STATUSES.map((status) => [status] as const))(
    '[8.8] DT-M32：重なる予約の状態が %s のときの合算',
    (status) => {
      const counted = (GROUP_AGGREGATED_STATUSES as readonly string[]).includes(status);
      const result = evaluateGroup(target('2026-11-17', 1, 2), [reservationX({ status })]);
      expect(result.isGroup).toBe(counted);
      expect(result.peakNightlyRoomCount).toBe(counted ? 5 : 2);
      expect(result.othersToMarkAsGroup).toEqual(counted ? ['X'] : []);
    },
  );

  it('[8.8] 夜ごとに足す：別々の夜の室数は足さない（11/16 が4室・11/17 が3室なら、延べ6室でも団体でない）', () => {
    const result = evaluateGroup(target('2026-11-16', 2, 1), [
      other('A', '2026-11-16', 1, 3),
      other('B', '2026-11-17', 1, 2),
    ]);
    expect(result.isGroup).toBe(false);
    expect(result.peakNightlyRoomCount).toBe(4);
    expect(result.othersToMarkAsGroup).toEqual([]);
  });

  it('[8.8] P-08：最大が5以上なら、5室になった夜に泊まらない予約も含めて、夜が重なる予約すべてを団体にする', () => {
    // T：3室・11/16〜18。A：1室・11/16（11/16 は4室）。B：2室・11/18（11/18 は5室）
    const result = evaluateGroup(target('2026-11-16', 3, 3), [
      other('A', '2026-11-16', 1, 1),
      other('B', '2026-11-18', 1, 2),
    ]);
    expect(result.isGroup).toBe(true);
    expect(result.peakNightlyRoomCount).toBe(5);
    expect(result.othersToMarkAsGroup).toEqual(['A', 'B']);
  });

  it('[8.8] 夜が重ならない予約は、合算で団体になっても団体にしない', () => {
    const result = evaluateGroup(target('2026-11-16', 2, 3), [
      other('A', '2026-11-17', 1, 2),
      other('C', '2026-11-20', 1, 1),
    ]);
    expect(result.isGroup).toBe(true);
    expect(result.othersToMarkAsGroup).toEqual(['A']);
  });

  it('[8.8] すでに団体の予約は、変える予約（othersToMarkAsGroup）に入れない', () => {
    const result = evaluateGroup(target('2026-11-17', 1, 2), [
      reservationX({ isGroup: true }),
      other('W', '2026-11-17', 1, 1),
    ]);
    expect(result.isGroup).toBe(true);
    expect(result.peakNightlyRoomCount).toBe(6);
    expect(result.othersToMarkAsGroup).toEqual(['W']);
  });

  it('[8.8] 合算に関係する予約が団体でも、夜ごとの合計が4室以下なら新しい予約は団体にしない（室数で判定する）', () => {
    // X は5室から3室に減らした団体（is_group＝true）。Y（1室・11/17）を足しても 11/17 は4室
    const result = evaluateGroup(target('2026-11-17', 1, 1), [reservationX({ isGroup: true })]);
    expect(result.isGroup).toBe(false);
    expect(result.othersToMarkAsGroup).toEqual([]);
  });

  it('[8.8] 1つの予約だけで5室なら、夜が重なる同じ会員の予約も団体にする', () => {
    const result = evaluateGroup(target('2026-11-17', 1, 5), [other('A', '2026-11-17', 1, 1)]);
    expect(result.isGroup).toBe(true);
    expect(result.peakNightlyRoomCount).toBe(6);
    expect(result.othersToMarkAsGroup).toEqual(['A']);
  });

  it('[8.7][8.8] TC-CH-105・P-08：合算で団体になった予約は、相手がキャンセルされた後に変更しても団体のまま', () => {
    // TC-CH-100 の後の Y（2室・11/17〜18、is_group＝true、max_room_count＝2）。X はキャンセル済み
    const changedY = target('2026-11-17', 2, 2, { maxRoomCount: 2, isGroup: true });
    const result = evaluateGroup(changedY, [reservationX({ status: 'CANCELLED', isGroup: true })]);
    expect(result).toEqual({
      maxRoomCount: 2,
      isGroup: true,
      peakNightlyRoomCount: 2,
      othersToMarkAsGroup: [],
    });
  });
});

describe('design.md の GroupEvaluator.isGroup（夜ごとの合算だけ）', () => {
  it('[8.8] 対象の夜ごとに、重なる予約の室数を足して、最大が5以上か', () => {
    const y = { nights: nightsOf('2026-11-17', 2), roomCount: 2 };
    const x = { nights: nightsOf('2026-11-16', 2), roomCount: 3 };
    expect(groupEvaluator.isGroup(y, [x])).toBe(true);
    expect(isGroupByNightlySum(y, [x])).toBe(true);
    expect(peakNightlyRoomCount(y, [x])).toBe(5);
  });

  it('[8.8] 合計が4室なら false、重ならない予約は足さない', () => {
    const y = { nights: nightsOf('2026-11-18', 1), roomCount: 1 };
    const x = { nights: nightsOf('2026-11-16', 2), roomCount: 3 };
    expect(groupEvaluator.isGroup(y, [x])).toBe(false);
    expect(peakNightlyRoomCount(y, [x])).toBe(1);
    expect(groupEvaluator.isGroup({ nights: ['2026-11-17'], roomCount: 1 }, [x])).toBe(false);
  });

  it('[8.7] ほかの予約がなければ、対象の室数が5以上か', () => {
    expect(groupEvaluator.isGroup({ nights: ['2026-12-01'], roomCount: 5 }, [])).toBe(true);
    expect(groupEvaluator.isGroup({ nights: ['2026-12-01'], roomCount: 4 }, [])).toBe(false);
  });

  it('groupEvaluator.evaluate は evaluateGroup と同じ', () => {
    expect(groupEvaluator.evaluate).toBe(evaluateGroup);
  });
});

describe('入力の誤り（プログラムの誤りなので RangeError）', () => {
  it('夜がない・日付の形が違う・同じ夜が2回ある', () => {
    expect(() => evaluateGroup({ ...target('2026-11-16', 1, 1), nights: [] }, [])).toThrow(
      RangeError,
    );
    expect(() =>
      evaluateGroup({ ...target('2026-11-16', 1, 1), nights: ['2026/11/16'] }, []),
    ).toThrow(RangeError);
    expect(() =>
      evaluateGroup({ ...target('2026-11-16', 1, 1), nights: ['2026-11-16', '2026-11-16'] }, []),
    ).toThrow(RangeError);
    expect(() =>
      evaluateGroup(target('2026-11-16', 1, 1), [
        { ...other('A', '2026-11-16', 1, 1), nights: [] },
      ]),
    ).toThrow(RangeError);
    expect(() => groupEvaluator.isGroup({ nights: ['2026-02-30'], roomCount: 1 }, [])).toThrow(
      RangeError,
    );
  });

  it('室数が1以上の整数でない・max_room_count が0以上の整数でない', () => {
    expect(() => evaluateGroup(target('2026-11-16', 1, 0), [])).toThrow(RangeError);
    expect(() => evaluateGroup(target('2026-11-16', 1, 1.5), [])).toThrow(RangeError);
    expect(() => evaluateGroup(target('2026-11-16', 1, 1, { maxRoomCount: -1 }), [])).toThrow(
      RangeError,
    );
    expect(() =>
      evaluateGroup(target('2026-11-16', 1, 1), [other('A', '2026-11-16', 1, 0)]),
    ).toThrow(RangeError);
  });

  it('ほかの予約に対象の予約自身・同じ予約が2回・予約の状態でない値がある', () => {
    expect(() =>
      evaluateGroup(target('2026-11-16', 1, 1), [other('target', '2026-11-16', 1, 1)]),
    ).toThrow(RangeError);
    expect(() =>
      evaluateGroup(target('2026-11-16', 1, 1), [
        other('A', '2026-11-16', 1, 1),
        other('A', '2026-11-17', 1, 1),
      ]),
    ).toThrow(RangeError);
    expect(() =>
      evaluateGroup(target('2026-11-16', 1, 1), [
        other('A', '2026-11-16', 1, 1, { status: 'HOLD' as ReservationStatus }),
      ]),
    ).toThrow(RangeError);
  });
});

describe('レビューで足した境界（2.6）', () => {
  it('[8.8] 合算で団体になっても、夜が接するだけの予約（対象の出発日に到着）は団体にしない', () => {
    // 対象：3室・夜 11/16〜11/17（出発 11/18）。A：2室・夜 11/16（重なる）。B：2室・夜 11/18（接するだけ）
    const result = evaluateGroup(target('2026-11-16', 2, 3), [
      other('A', '2026-11-16', 1, 2),
      other('B', '2026-11-18', 1, 2),
    ]);
    expect(result.isGroup).toBe(true);
    expect(result.peakNightlyRoomCount).toBe(5);
    expect(result.othersToMarkAsGroup).toEqual(['A']);
  });

  it('[8.7][8.8] 最大室数で団体のままの予約でも、今の室数の合算が4室なら重なる予約は団体にしない', () => {
    // 対象：以前5室（max_room_count＝5・団体）で今は3室。A：1室で重なる（合計4室）
    const result = evaluateGroup(target('2026-11-16', 2, 3, { maxRoomCount: 5, isGroup: true }), [
      other('A', '2026-11-16', 2, 1),
    ]);
    expect(result.isGroup).toBe(true);
    expect(result.maxRoomCount).toBe(5);
    expect(result.peakNightlyRoomCount).toBe(4);
    expect(result.othersToMarkAsGroup).toEqual([]);
  });
});
