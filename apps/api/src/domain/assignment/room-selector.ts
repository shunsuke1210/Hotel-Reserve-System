// 部屋の選び方（RoomSelector。design.md Components and Interfaces、処理仕様 P-03 手順2・4、設計の補足 DT-M11、
// brief.md AS-01〜AS-03・AS-12・AS-12a）。
//
// 全日程を通して空いている部屋の候補から、割り当てる部屋を選ぶ。部屋の配置（各階のタイプと部屋番号）は持たず、
// 候補・階ごとの延べの割り当て済み室数・その客室タイプの1つの階の室数の最大を入力で受け取る。
// 入力だけから結果が決まる純粋な関数で、データベースと現在時刻を使わない。
// 候補の集め方（P-02 手順3）、延べの室数の数え方（宿泊期間の夜・同じ客室タイプの部屋だけ。DT-M11）、
// 確保の行の挿入とお知らせ（SPLIT_FLOORS）の作成は呼び出し側（5.3 の RoomAllocationService）が行う。

/** 割り当ての候補の部屋 */
export interface RoomCandidate {
  roomId: string;
  roomNumber: number;
  floor: number;
}

export interface RoomSelection {
  /** 選んだ部屋（部屋番号の小さい順） */
  rooms: RoomCandidate[];
  /** 予約の部屋（残す部屋を含む）が2つ以上の階に分かれたか */
  splitAcrossFloors: boolean;
  /**
   * 予約の室数（残す部屋を含む）が、その客室タイプの1つの階の室数の最大より多く、配置上どの階にも収まらないか。
   * SPLIT_FLOORS のお知らせは、splitAcrossFloors が true で、これが false のときだけ作る（9.4、AS-12a、P-03 手順4）
   */
  structurallyImpossible: boolean;
}

export interface RoomSelectionOptions {
  /**
   * 同じ予約で割り当てたまま残す部屋（室数を増やす変更・日程の変更で選び直さない部屋。L-26、P-05 手順3a）。
   * 指定すると、残す部屋と選ぶ部屋を合わせた全室に2室以上の規則を当てる（1室を選ぶときも）。
   * 全室が同じ階に入るなら残す部屋の階で全室の番号の範囲が最も狭くなる部屋を選び、入らなければ全室で使う階の数が
   * 最も少なく範囲が狭い組み合わせを選ぶ。候補と同じ部屋を含めてはいけない
   */
  existingRooms?: readonly RoomCandidate[];
}

export interface RoomSelector {
  /**
   * 全日程空いている部屋の候補から、1室なら階の均等 → 上の階 → 番号順、2室以上なら同じ階 → 番号の範囲が狭い順で選ぶ。
   * floorLoad は階ごとの宿泊期間中の割り当て済み室数（延べ。同じ客室タイプだけ）で、ない階は0室として扱う
   */
  select(
    candidates: readonly RoomCandidate[],
    requested: number,
    floorLoad: ReadonlyMap<number, number>,
    maxRoomsOfTypePerFloor: number,
    options?: RoomSelectionOptions,
  ): RoomSelection;
}

/** 2室以上の組み合わせの比べ方に使う値（小さいほど先） */
interface RoomSetChoice {
  rooms: RoomCandidate[];
  /** 全室（残す部屋を含む）で使う階（上の階から） */
  floorsDescending: number[];
  /** 全室（残す部屋を含む）の部屋番号の範囲（最大 − 最小） */
  range: number;
}

/**
 * 割り当てる部屋を選ぶ（9.2〜9.4、P-03 手順2）。
 * - 1室：延べの割り当て済み室数が最も少ない階 → 同じなら上の階 → 同じ階では部屋番号の小さい部屋（9.2、AS-03）
 * - 2室以上：全室が同じ階に入るなら、部屋番号の範囲が最も狭い組み合わせ。範囲が同じなら上の階、同じ階で範囲が同じなら
 *   小さい番号の側（9.3、AS-12、DT-M11）。延べの割り当て済み室数は使わない（同じ階に入れることを階の均等より優先する）
 * - 同じ階に入らなければ、使う階の数が最も少なく、範囲（階をまたぐ部屋番号の最大 − 最小）が狭い組み合わせ。
 *   それも同じなら上の階の組み合わせ、さらに同じなら小さい番号の側（9.4）
 *
 * 候補が室数より少ない（呼び出し側で在庫なしとして扱う：9.5）、部屋が重なっている、候補のある階の室数が
 * maxRoomsOfTypePerFloor を超えているなど、入力の誤りは RangeError。
 */
export function selectRooms(
  candidates: readonly RoomCandidate[],
  requested: number,
  floorLoad: ReadonlyMap<number, number>,
  maxRoomsOfTypePerFloor: number,
  options: RoomSelectionOptions = {},
): RoomSelection {
  const existingRooms = options.existingRooms ?? [];
  validateInput(candidates, requested, floorLoad, maxRoomsOfTypePerFloor, existingRooms);

  const rooms =
    requested === 1 && existingRooms.length === 0
      ? [selectSingleRoom(candidates, floorLoad)]
      : selectRoomSet(candidates, requested, existingRooms).rooms;
  const floors = new Set([...existingRooms, ...rooms].map((room) => room.floor));
  return {
    rooms,
    splitAcrossFloors: floors.size > 1,
    structurallyImpossible: existingRooms.length + requested > maxRoomsOfTypePerFloor,
  };
}

export const roomSelector: RoomSelector = {
  select: selectRooms,
};

/** 1室：延べの室数の少ない階 → 上の階 → 番号の小さい部屋 */
function selectSingleRoom(
  candidates: readonly RoomCandidate[],
  floorLoad: ReadonlyMap<number, number>,
): RoomCandidate {
  const loadOf = (room: RoomCandidate): number => floorLoad.get(room.floor) ?? 0;
  const [best] = candidates.toSorted(
    (a, b) => loadOf(a) - loadOf(b) || b.floor - a.floor || a.roomNumber - b.roomNumber,
  );
  if (best === undefined) throw new RangeError('候補の部屋がありません');
  return best;
}

/**
 * 2室以上（または残す部屋がある場合）：全室で使う階の数 → 範囲 → 上の階 → 小さい番号の側の順に比べて最もよい組み合わせ。
 *
 * 使う階の数の最小は、残す部屋の階の候補に加えて、候補の多い階から順に足して室数に届く階の数で決まる。
 * その数の階の組み合わせごとに、候補を部屋番号の順に並べ、連続した requested 室を比べる。
 * 最もよい組み合わせは、必ずこの連続した組み合わせの中にある（どの組み合わせも、その最小の部屋から連続した
 * requested 室に置き換えると、範囲は広がらず番号は小さい側になる）。残す部屋があると連続していない組み合わせが
 * 範囲で並ぶことがある（例：1・10 を残して 2・3・4 から2室を選ぶと {2,4} も範囲9）が、その場合も連続した {2,3} が先になる。
 * 1つの客室タイプの階は多くても10程度なので、階の組み合わせを全部調べても十分に速い。
 */
function selectRoomSet(
  candidates: readonly RoomCandidate[],
  requested: number,
  existingRooms: readonly RoomCandidate[],
): RoomSetChoice {
  const existingFloors = new Set(existingRooms.map((room) => room.floor));
  const onExistingFloors = candidates.filter((room) => existingFloors.has(room.floor));
  const otherFloors = new Map<number, RoomCandidate[]>();
  for (const room of candidates) {
    if (existingFloors.has(room.floor)) continue;
    const rooms = otherFloors.get(room.floor);
    if (rooms === undefined) otherFloors.set(room.floor, [room]);
    else rooms.push(room);
  }

  const additionalFloorCount = minimumFloorCount(
    [...otherFloors.values()].map((rooms) => rooms.length),
    requested - onExistingFloors.length,
  );

  let best: RoomSetChoice | undefined;
  for (const floors of combinations([...otherFloors.keys()], additionalFloorCount)) {
    const pool = [
      ...onExistingFloors,
      ...floors.flatMap((floor) => otherFloors.get(floor) ?? []),
    ].toSorted((a, b) => a.roomNumber - b.roomNumber);
    for (let start = 0; start + requested <= pool.length; start++) {
      const choice = toChoice(pool.slice(start, start + requested), existingRooms);
      if (best === undefined || compareChoices(choice, best) < 0) best = choice;
    }
  }
  if (best === undefined) throw new RangeError('候補の部屋が予約の室数より少ない');
  return best;
}

/** 候補の多い階から順に足して needed 室に届く階の数（needed が0以下なら0） */
function minimumFloorCount(roomCountsPerFloor: readonly number[], needed: number): number {
  const counts = roomCountsPerFloor.toSorted((a, b) => b - a);
  let total = 0;
  let floorCount = 0;
  while (total < needed) {
    const count = counts[floorCount];
    if (count === undefined) throw new RangeError('候補の部屋が予約の室数より少ない');
    total += count;
    floorCount += 1;
  }
  return floorCount;
}

/** items から size 個を選ぶ組み合わせ（size が0なら空の組み合わせ1つ） */
function combinations<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  const result: T[][] = [];
  for (let i = 0; i + size <= items.length; i++) {
    const head = items[i] as T;
    for (const rest of combinations(items.slice(i + 1), size - 1)) {
      result.push([head, ...rest]);
    }
  }
  return result;
}

function toChoice(rooms: RoomCandidate[], existingRooms: readonly RoomCandidate[]): RoomSetChoice {
  const all = [...existingRooms, ...rooms];
  const numbers = all.map((room) => room.roomNumber);
  return {
    rooms,
    floorsDescending: [...new Set(all.map((room) => room.floor))].toSorted((a, b) => b - a),
    range: Math.max(...numbers) - Math.min(...numbers),
  };
}

/** 使う階の数が少ない → 範囲が狭い → 上の階 → 小さい番号の側（rooms は番号の小さい順） */
function compareChoices(a: RoomSetChoice, b: RoomSetChoice): number {
  return (
    a.floorsDescending.length - b.floorsDescending.length ||
    a.range - b.range ||
    compareSequences(b.floorsDescending, a.floorsDescending) ||
    compareSequences(
      a.rooms.map((room) => room.roomNumber),
      b.rooms.map((room) => room.roomNumber),
    )
  );
}

/** 同じ長さの数の並びを先頭から比べる */
function compareSequences(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function validateInput(
  candidates: readonly RoomCandidate[],
  requested: number,
  floorLoad: ReadonlyMap<number, number>,
  maxRoomsOfTypePerFloor: number,
  existingRooms: readonly RoomCandidate[],
): void {
  if (!Number.isSafeInteger(requested) || requested < 1) {
    throw new RangeError('予約の室数は1以上の整数にしてください');
  }
  if (!Number.isSafeInteger(maxRoomsOfTypePerFloor) || maxRoomsOfTypePerFloor < 1) {
    throw new RangeError('1つの階の室数の最大は1以上の整数にしてください');
  }
  if (candidates.length < requested) {
    throw new RangeError('候補の部屋が予約の室数より少ない（在庫なしとして扱うこと）');
  }

  const roomIds = new Set<string>();
  const roomNumbers = new Set<number>();
  for (const room of [...existingRooms, ...candidates]) {
    if (!Number.isSafeInteger(room.roomNumber) || !Number.isSafeInteger(room.floor)) {
      throw new RangeError('部屋番号と階は整数にしてください');
    }
    if (roomIds.has(room.roomId) || roomNumbers.has(room.roomNumber)) {
      throw new RangeError('同じ部屋が重なっています（候補と残す部屋を含む）');
    }
    roomIds.add(room.roomId);
    roomNumbers.add(room.roomNumber);
  }

  const candidatesPerFloor = new Map<number, number>();
  for (const room of candidates) {
    const count = (candidatesPerFloor.get(room.floor) ?? 0) + 1;
    if (count > maxRoomsOfTypePerFloor) {
      throw new RangeError('候補のある階の室数が、1つの階の室数の最大を超えています');
    }
    candidatesPerFloor.set(room.floor, count);
  }

  for (const load of floorLoad.values()) {
    if (!Number.isSafeInteger(load) || load < 0) {
      throw new RangeError('階ごとの割り当て済み室数は0以上の整数にしてください');
    }
  }
}
