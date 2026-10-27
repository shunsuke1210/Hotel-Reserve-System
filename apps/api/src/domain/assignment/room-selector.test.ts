// 部屋の選び方（design.md RoomSelector、処理仕様 P-03 手順2・4、設計の補足 DT-M11、brief.md AS-03・AS-12・AS-12a）。
// テストケースは test-cases/05-operations.md の 2.1（TC-OP-001〜016）のうち RoomSelector で決まる部分。
// 候補の集め方（全日程の空き・故障中の除外）と、階ごとの延べの割り当て済み室数の数え方（宿泊期間の夜だけ・同じ客室タイプだけ）は
// 呼び出し側（5.3 の RoomAllocationService）の担当なので、ここでは「その結果として渡された候補と室数」から選ぶことを確かめる。
// お知らせ（SPLIT_FLOORS）の作成も 5.3 で行う。ここでは作る条件（splitAcrossFloors かつ structurallyImpossible でない）を返すことを確かめる。
//
// 部屋は初期データの配置（tasks.md Implementation Notes 1.5）から作る。テストケースの部屋番号は説明用の値なので、
// 同じ階・同じタイプの部屋に読み替えた（読み替えたものは各テストのコメントに書く）。
import { describe, expect, it } from 'vitest';
import { buildRooms, type RoomTypeCode } from '../../../prisma/seed/initial-data.js';
import {
  roomSelector,
  selectRooms,
  type RoomCandidate,
  type RoomSelection,
} from './room-selector.js';

const SEED_ROOMS = buildRooms();
const SK: RoomTypeCode = 'STANDARD_KING';
const DK: RoomTypeCode = 'DELUXE_KING';
/** スタンダード キングがある階（4〜12F） */
const SK_FLOORS = [4, 5, 6, 7, 8, 9, 10, 11, 12];

function toCandidate(room: { roomNumber: number; floor: number }): RoomCandidate {
  return { roomId: `room-${room.roomNumber}`, roomNumber: room.roomNumber, floor: room.floor };
}

/** そのタイプの全部屋（except の部屋番号を除く） */
function allOf(type: RoomTypeCode, except: readonly number[] = []): RoomCandidate[] {
  return SEED_ROOMS.filter(
    (room) => room.roomTypeCode === type && !except.includes(room.roomNumber),
  ).map(toCandidate);
}

/** 指定した部屋番号の部屋。そのタイプの部屋でなければ失敗させる（読み替えの誤りを止める） */
function roomsOf(type: RoomTypeCode, roomNumbers: readonly number[]): RoomCandidate[] {
  return roomNumbers.map((roomNumber) => {
    const room = SEED_ROOMS.find((seed) => seed.roomNumber === roomNumber);
    if (room?.roomTypeCode !== type) {
      throw new Error(`${roomNumber} は ${type} の部屋ではありません`);
    }
    return toCandidate(room);
  });
}

/** そのタイプの1つの階の室数の最大（SK は 4F の12室、DK は 5F・6F の3室） */
function maxRoomsPerFloor(type: RoomTypeCode): number {
  const counts = new Map<number, number>();
  for (const room of SEED_ROOMS.filter((seed) => seed.roomTypeCode === type)) {
    counts.set(room.floor, (counts.get(room.floor) ?? 0) + 1);
  }
  return Math.max(...counts.values());
}

/** 階ごとの延べの割り当て済み室数。others は floors のうち overrides にない階の値 */
function floorLoad(
  overrides: Record<number, number>,
  others = 0,
  floors: readonly number[] = SK_FLOORS,
): Map<number, number> {
  return new Map(floors.map((floor) => [floor, overrides[floor] ?? others]));
}

const numbersOf = (selection: RoomSelection): number[] =>
  selection.rooms.map((room) => room.roomNumber);

/** P-03 手順4：SPLIT_FLOORS のお知らせを作るか */
const needsSplitNotice = (selection: RoomSelection): boolean =>
  selection.splitAcrossFloors && !selection.structurallyImpossible;

const SK_MAX = maxRoomsPerFloor(SK);
const DK_MAX = maxRoomsPerFloor(DK);

describe('selectRooms：1室（階の均等 → 上の階 → 番号の小さい順）', () => {
  it('[9.2] TC-OP-001 全階0室で同点なら上の階（12F）の、番号の最も小さい部屋', () => {
    const selection = selectRooms(allOf(SK), 1, floorLoad({}), SK_MAX);
    expect(numbersOf(selection)).toEqual([1201]);
    expect(selection.splitAcrossFloors).toBe(false);
    expect(selection.structurallyImpossible).toBe(false);
  });

  it('[9.2] TC-OP-002 延べの室数で比べる（5F＝3・6F＝2 なら 6F。部屋の数で比べた 5F ではない）', () => {
    // 5F は 501 が3泊とも、6F は 601・602 が1泊ずつ割り当て済み（全日程の空きではないので候補にない）。
    // 他の階は2室ずつ割り当て済みで延べ4
    const otherAssigned = [4, 7, 8, 9, 10, 11, 12].flatMap((floor) => [
      floor * 100 + 1,
      floor * 100 + 2,
    ]);
    const candidates = allOf(SK, [501, 601, 602, ...otherAssigned]);
    const selection = selectRooms(candidates, 1, floorLoad({ 5: 3, 6: 2 }, 4), SK_MAX);
    expect(numbersOf(selection)).toEqual([603]);
  });

  it('[9.2] TC-OP-003 渡された室数（宿泊期間の夜だけを数えた値）で選ぶ：12F＝0・他の階＝1以上なら 12F', () => {
    // 12F の SK は 11/9・11/11 の夜に各5室割り当て済みだが、11/10 の1泊には空いている（候補に入り、室数は0）
    const otherAssigned = [4, 5, 6, 7, 8, 9, 10, 11].map((floor) => floor * 100 + 1);
    const candidates = allOf(SK, otherAssigned);
    const selection = selectRooms(candidates, 1, floorLoad({ 12: 0 }, 1), SK_MAX);
    expect(numbersOf(selection)).toEqual([1201]);
  });

  it('[9.2] TC-OP-004 室数の少ない階が上の階より先。0室どうし（10F・11F）では上の 11F', () => {
    const otherAssigned = [4, 5, 6, 7, 8, 9].flatMap((floor) => [floor * 100 + 1, floor * 100 + 2]);
    const candidates = allOf(SK, [1201, ...otherAssigned]);
    const selection = selectRooms(candidates, 1, floorLoad({ 12: 1, 11: 0, 10: 0 }, 2), SK_MAX);
    expect(numbersOf(selection)).toEqual([1101]);
  });

  it('[9.2] TC-OP-005 故障中の部屋（候補から外れた 1201）の次に番号の小さい 1202', () => {
    const selection = selectRooms(allOf(SK, [1201]), 1, floorLoad({}), SK_MAX);
    expect(numbersOf(selection)).toEqual([1202]);
  });

  it('[9.2] TC-OP-006 同じ客室タイプだけで数えた室数で選ぶ（12F の DK 3室は 6F に読み替え）', () => {
    // テストケースの「12F の DK＝3室」は、DK が3室の階（6F）で行う（Implementation Notes 1.5）。
    // 11/10 の夜：6F は SK＝0室・DK＝3室、5F は SK・DK とも0室、他の階は SK が各1室以上
    const otherAssigned = [4, 7, 8, 9, 10, 11, 12].map((floor) => floor * 100 + 1);
    const candidates = allOf(SK, otherAssigned);
    const skOnly = floorLoad({ 6: 0, 5: 0 }, 1);
    expect(numbersOf(selectRooms(candidates, 1, skOnly, SK_MAX))).toEqual([601]);
    // DK の3室まで数えた室数を渡すと 5F になる（呼び出し側は SK だけで数えること：DT-M11）
    const withDeluxe = floorLoad({ 6: 3, 5: 0 }, 1);
    expect(numbersOf(selectRooms(candidates, 1, withDeluxe, SK_MAX))).toEqual([501]);
  });

  it('[9.2] 室数の表にない階は0室として扱う', () => {
    const candidates = roomsOf(SK, [1105, 1203]);
    const selection = selectRooms(candidates, 1, new Map([[12, 1]]), SK_MAX);
    expect(numbersOf(selection)).toEqual([1105]);
  });

  it('[9.2] 候補の並び順に左右されない', () => {
    const candidates = allOf(SK, [1201, 1202]).reverse();
    expect(numbersOf(selectRooms(candidates, 1, floorLoad({}), SK_MAX))).toEqual([1203]);
  });
});

describe('selectRooms：2室以上（同じ階 → 番号の範囲が狭い順。階の均等より優先）', () => {
  it('[9.3] TC-OP-007 同じ階で番号の範囲が最も狭い組み合わせ（501・502）', () => {
    const singles = [401, 701, 801, 901, 1001, 1101, 1201];
    const candidates = roomsOf(SK, [501, 502, 601, 605, ...singles]);
    const selection = selectRooms(candidates, 2, floorLoad({}), SK_MAX);
    expect(numbersOf(selection)).toEqual([501, 502]);
    expect(selection.splitAcrossFloors).toBe(false);
    expect(selection.structurallyImpossible).toBe(false);
    expect(needsSplitNotice(selection)).toBe(false);
  });

  it('[9.3] TC-OP-008 延べの少ない 7F より、2室が同じ階に入る 9F を選ぶ', () => {
    const candidates = roomsOf(SK, [701, 903, 904]);
    const selection = selectRooms(candidates, 2, floorLoad({ 7: 10, 9: 18 }), SK_MAX);
    expect(numbersOf(selection)).toEqual([903, 904]);
    expect(selection.splitAcrossFloors).toBe(false);
  });

  it('[9.3] TC-OP-009 範囲が同じ階が複数あれば上の階（延べの少ない 10F ではなく 12F。DT-M11）', () => {
    const candidates = roomsOf(SK, [401, 1001, 1002, 1105, 1201, 1202]);
    const selection = selectRooms(candidates, 2, floorLoad({ 10: 0, 12: 5 }), SK_MAX);
    expect(numbersOf(selection)).toEqual([1201, 1202]);
  });

  it('[9.3] TC-OP-010 同じ階で範囲が同じ組み合わせが複数あれば小さい番号の側（DT-M11）', () => {
    const candidates = roomsOf(SK, [1205, 1206, 1201, 1202, 401, 901]);
    const selection = selectRooms(candidates, 2, floorLoad({}), SK_MAX);
    expect(numbersOf(selection)).toEqual([1201, 1202]);
  });

  it('[9.3] 範囲は上の階より先に比べる（下の階の範囲1が、上の階の範囲2より先）', () => {
    const candidates = roomsOf(SK, [501, 502, 1201, 1203]);
    expect(numbersOf(selectRooms(candidates, 2, floorLoad({}), SK_MAX))).toEqual([501, 502]);
  });

  it('[9.3] 番号が飛んでいる階では、範囲が最も狭い連続した組み合わせ（1203〜1205）', () => {
    const candidates = roomsOf(SK, [1201, 1203, 1204, 1205, 1209]);
    const selection = selectRooms(candidates, 3, floorLoad({}), SK_MAX);
    expect(numbersOf(selection)).toEqual([1203, 1204, 1205]);
  });

  it('[9.3][9.4] TC-OP-014 室数＝1つの階の最大（DK 3室）：3室とも 5F に入り、お知らせの条件にならない', () => {
    const candidates = roomsOf(DK, [423, 424, 522, 523, 524, 622, 623, 1222, 1223]);
    const selection = selectRooms(candidates, 3, floorLoad({}), DK_MAX);
    expect(DK_MAX).toBe(3);
    expect(numbersOf(selection)).toEqual([522, 523, 524]);
    expect(selection.splitAcrossFloors).toBe(false);
    expect(selection.structurallyImpossible).toBe(false);
    expect(needsSplitNotice(selection)).toBe(false);
  });
});

describe('selectRooms：同じ階に入らない（使う階の数が最も少なく、範囲が狭い組み合わせ）', () => {
  it('[9.4] TC-OP-011・TC-OP-012 DK 3室：5F の2室と 6F の1室（5F＋8F より範囲が狭い）。お知らせの条件になる', () => {
    // 05 の DK の空き 5F＝2室・6F＝1室・8F＝1室 を 522・523・622・822 に読み替え
    const candidates = roomsOf(DK, [522, 523, 622, 822]);
    const selection = selectRooms(candidates, 3, floorLoad({}), DK_MAX);
    expect(numbersOf(selection)).toEqual([522, 523, 622]);
    expect(selection.splitAcrossFloors).toBe(true);
    expect(selection.structurallyImpossible).toBe(false);
    expect(needsSplitNotice(selection)).toBe(true);
  });

  it('[9.4] TC-OP-013 DK 2室（最大3室の1つ手前）：2つの階に1室ずつで、お知らせの条件になる', () => {
    const candidates = roomsOf(DK, [522, 622]);
    const selection = selectRooms(candidates, 2, floorLoad({}), DK_MAX);
    expect(numbersOf(selection)).toEqual([522, 622]);
    expect(selection.splitAcrossFloors).toBe(true);
    expect(selection.structurallyImpossible).toBe(false);
    expect(needsSplitNotice(selection)).toBe(true);
  });

  it('[9.4] TC-OP-015・TC-OP-016 DK 4室（最大3室の1つ後）：2つの階に分け、配置上どの階にも入らないのでお知らせの条件にならない', () => {
    const candidates = roomsOf(DK, [622, 623, 624, 522, 523, 524]);
    const selection = selectRooms(candidates, 4, floorLoad({}), DK_MAX);
    // 範囲が同じ（100）組み合わせのうち小さい番号の側
    expect(numbersOf(selection)).toEqual([522, 523, 524, 622]);
    expect(selection.splitAcrossFloors).toBe(true);
    expect(selection.structurallyImpossible).toBe(true);
    expect(needsSplitNotice(selection)).toBe(false);
  });

  it('[9.4] 使う階の数を範囲より先に比べる（2つの階で範囲701を、3つの階で範囲200より先）', () => {
    const candidates = roomsOf(SK, [501, 502, 601, 701, 1201, 1202]);
    const selection = selectRooms(candidates, 4, floorLoad({}), SK_MAX);
    expect(numbersOf(selection)).toEqual([501, 502, 1201, 1202]);
    expect(selection.splitAcrossFloors).toBe(true);
  });

  it('[9.4] 階の数も範囲も同じなら上の階の組み合わせ（5F＋6F より 6F＋7F）', () => {
    const candidates = roomsOf(SK, [501, 502, 601, 602, 701, 702]);
    const selection = selectRooms(candidates, 3, floorLoad({}), SK_MAX);
    expect(numbersOf(selection)).toEqual([601, 602, 701]);
  });
});

describe('selectRooms：同じ予約の残す部屋（existingRooms。室数の追加・日程の変更の選び直し：L-26、P-05 手順3a）', () => {
  it('[9.3] 残す部屋の階に入るなら、全室の範囲が最も狭くなる部屋（1室でも階の均等の規則にしない）', () => {
    const existing = roomsOf(SK, [1205]);
    const candidates = roomsOf(SK, [501, 1201, 1206]);
    const selection = selectRooms(candidates, 1, floorLoad({ 5: 0, 12: 9 }), SK_MAX, {
      existingRooms: existing,
    });
    expect(numbersOf(selection)).toEqual([1206]);
    expect(selection.splitAcrossFloors).toBe(false);
    expect(selection.structurallyImpossible).toBe(false);
  });

  it('[9.4] 残す部屋の階に入らなければ、全室で使う階の数が最も少なく範囲が狭い組み合わせ', () => {
    const existing = roomsOf(SK, [501]);
    const candidates = roomsOf(SK, [502, 601, 602, 603, 1201, 1202]);
    const selection = selectRooms(candidates, 2, floorLoad({}), SK_MAX, {
      existingRooms: existing,
    });
    expect(numbersOf(selection)).toEqual([502, 601]);
    expect(selection.splitAcrossFloors).toBe(true);
    expect(needsSplitNotice(selection)).toBe(true);
  });

  it('[9.4] TC-CH-202 残す部屋（5F）と選んだ1室が別の階なら、全室で離れたと判定する（L-26）', () => {
    // 5F には 501 のほかに空いている SK がない。全室の範囲が同じ（100）401 と 601 では上の階の 601。
    // 選んだ部屋だけでは1つの階だが、残す部屋と合わせると 5F・6F に分かれるので、お知らせの条件になる
    const existing = roomsOf(SK, [501]);
    const candidates = roomsOf(SK, [401, 601, 602, 1201]);
    const selection = selectRooms(candidates, 1, floorLoad({ 6: 5 }), SK_MAX, {
      existingRooms: existing,
    });
    expect(numbersOf(selection)).toEqual([601]);
    expect(selection.splitAcrossFloors).toBe(true);
    expect(selection.structurallyImpossible).toBe(false);
    expect(needsSplitNotice(selection)).toBe(true);
  });

  it('[9.4] 配置上どの階にも入らないかは、残す部屋を含めた室数で判定する（DK 2室＋2室＞最大3室）', () => {
    const existing = roomsOf(DK, [522, 523]);
    const candidates = roomsOf(DK, [524, 622, 623]);
    const selection = selectRooms(candidates, 2, floorLoad({}), DK_MAX, {
      existingRooms: existing,
    });
    expect(numbersOf(selection)).toEqual([524, 622]);
    expect(selection.splitAcrossFloors).toBe(true);
    expect(selection.structurallyImpossible).toBe(true);
    expect(needsSplitNotice(selection)).toBe(false);
  });

  it('残す部屋が空の配列なら、指定しない場合と同じ', () => {
    const candidates = allOf(SK);
    expect(selectRooms(candidates, 1, floorLoad({}), SK_MAX, { existingRooms: [] })).toEqual(
      selectRooms(candidates, 1, floorLoad({}), SK_MAX),
    );
  });
});

describe('selectRooms：入力の誤り（呼び出し側の誤りは RangeError）', () => {
  const candidates = roomsOf(SK, [1201, 1202]);

  it('室数が1以上の整数でない', () => {
    expect(() => selectRooms(candidates, 0, floorLoad({}), SK_MAX)).toThrow(RangeError);
    expect(() => selectRooms(candidates, 1.5, floorLoad({}), SK_MAX)).toThrow(RangeError);
  });

  it('候補が室数より少ない（呼び出し側で在庫なしとして扱う）', () => {
    expect(() => selectRooms(candidates, 3, floorLoad({}), SK_MAX)).toThrow(RangeError);
  });

  it('1つの階の室数の最大が1以上の整数でない、または候補の階の室数がそれを超える', () => {
    expect(() => selectRooms(candidates, 1, floorLoad({}), 0)).toThrow(RangeError);
    expect(() => selectRooms(candidates, 1, floorLoad({}), 2.5)).toThrow(RangeError);
    expect(() => selectRooms(candidates, 1, floorLoad({}), 1)).toThrow(RangeError);
  });

  it('同じ部屋（ID・部屋番号）が重なっている', () => {
    const [first] = candidates;
    if (first === undefined) throw new Error('候補がない');
    expect(() => selectRooms([...candidates, first], 1, floorLoad({}), SK_MAX)).toThrow(RangeError);
    expect(() =>
      selectRooms([...candidates, { ...first, roomId: 'other' }], 1, floorLoad({}), SK_MAX),
    ).toThrow(RangeError);
    expect(() =>
      selectRooms(candidates, 1, floorLoad({}), SK_MAX, { existingRooms: [first] }),
    ).toThrow(RangeError);
  });

  it('部屋番号・階・室数が整数でない、または室数が負', () => {
    expect(() =>
      selectRooms([{ roomId: 'x', roomNumber: 12.5, floor: 12 }], 1, floorLoad({}), SK_MAX),
    ).toThrow(RangeError);
    expect(() =>
      selectRooms([{ roomId: 'x', roomNumber: 1201, floor: Number.NaN }], 1, new Map(), SK_MAX),
    ).toThrow(RangeError);
    expect(() => selectRooms(candidates, 1, new Map([[12, -1]]), SK_MAX)).toThrow(RangeError);
  });
});

describe('roomSelector（design.md の RoomSelector）', () => {
  it('select は selectRooms と同じ結果を返す', () => {
    const candidates = allOf(DK);
    expect(roomSelector.select(candidates, 2, floorLoad({}), DK_MAX)).toEqual(
      selectRooms(candidates, 2, floorLoad({}), DK_MAX),
    );
  });
});
