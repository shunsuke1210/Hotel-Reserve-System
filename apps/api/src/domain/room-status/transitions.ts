// 部屋の状態のルール（RoomStatusRules。design.md Components and Interfaces、処理仕様 P-12、設計の補足 L-23、
// brief.md ST-01・ST-01a・ST-01b・ST-01c・ST-03b）。
//
// 12の状態のグループと、役割ごとに変えてよい状態の組み合わせを決める。グループの分け方は contracts の
// ROOM_STATUSES_BY_GROUP をそのまま使い、ここで定義し直さない。入力だけから結果が決まる純粋な関数。
// 役割で決まらない業務の操作による変更（チェックイン・チェックアウト・9:00 の処理）は、ここでは判定しない
// （3.7 の業務の操作の入口と、P-10・P-13・7.12 の各処理が担当する）。
import {
  ROOM_STATUSES_BY_GROUP,
  ROOM_STATUS_GROUPS,
  type RoomStatus,
  type RoomStatusGroup,
  type StaffRole,
} from '@hotel/contracts';

export interface RoomStatusRules {
  /** 状態のグループ（空室の清掃・連泊・その他。12.1） */
  groupOf(status: RoomStatus): RoomStatusGroup;
  /**
   * その役割が from から to へ変えてよいか（P-12 の役割ごとの行。12.2〜12.4・12.7）。
   * フロント以上の「任意 → OUT_OF_ORDER」「OUT_OF_ORDER → CLEAN」（故障中の設定と修理の完了。P-13）も許す
   */
  canChange(role: StaffRole, from: RoomStatus, to: RoomStatus): boolean;
  /**
   * 状態の変更（POST /rooms/{id}/status、C03 のボタン）で変えてよいか。canChange に加えて、故障中への変更と
   * 故障中からの変更を許さない（L-23。故障中の設定と修理の完了の API（F13）だけで行う）
   */
  canChangeManually(role: StaffRole, from: RoomStatus, to: RoomStatus): boolean;
}

const GROUP_BY_STATUS: ReadonlyMap<RoomStatus, RoomStatusGroup> = new Map(
  ROOM_STATUS_GROUPS.flatMap((group) =>
    ROOM_STATUSES_BY_GROUP[group].map((status) => [status, group] as const),
  ),
);

/** 状態のグループ（12.1）。部屋の状態でない値は RangeError */
export function roomStatusGroupOf(status: RoomStatus): RoomStatusGroup {
  const group = GROUP_BY_STATUS.get(status);
  if (group === undefined) throw new RangeError(`部屋の状態ではありません：${String(status)}`);
  return group;
}

/**
 * その役割が from から to へ変えてよいか（P-12）。
 * - 清掃員：空室の清掃グループの中・連泊グループの中なら、どの状態にも変えられる（点検の省略・誤操作の訂正・
 *   清掃を断られた部屋の「清掃完了（連泊）」を含む。12.2、ST-01・ST-01b）。ほかには「来客なし → 清掃完了」だけ
 *   （12.3・12.7、ST-03b）。「その他」のグループの中の変更（ST-01c）とグループをまたぐ変更（12.3）は許さない
 * - フロント以上：グループをまたぐ変更も「その他」の中の変更も、どの状態にも変えられる（12.4、ST-01a）
 * - 同じ状態への変更は、変更ではないので許さない（どの役割でも false）
 *
 * 役割・部屋の状態でない値は RangeError。
 */
export function canChangeRoomStatus(role: StaffRole, from: RoomStatus, to: RoomStatus): boolean {
  const fromGroup = roomStatusGroupOf(from);
  const toGroup = roomStatusGroupOf(to);
  switch (role) {
    case 'ADMIN':
    case 'FRONT':
      return from !== to;
    case 'CLEANER': {
      if (from === to) return false;
      const withinCleaningGroup = fromGroup === toGroup && fromGroup !== 'OTHER';
      return withinCleaningGroup || (from === 'NO_ARRIVAL' && to === 'CLEAN');
    }
    default:
      throw new RangeError(`スタッフの役割ではありません：${String(role satisfies never)}`);
  }
}

/**
 * 状態の変更（POST /rooms/{id}/status、C03 のボタン）で、その役割が from から to へ変えてよいか。
 * canChangeRoomStatus に加えて、故障中（OUT_OF_ORDER）への変更と故障中からの変更は、どの役割でも許さない（L-23）。
 * 清掃員はもともと故障中に関わる変更を許されないので、清掃員の結果は canChangeRoomStatus と同じ。
 */
export function canChangeRoomStatusManually(
  role: StaffRole,
  from: RoomStatus,
  to: RoomStatus,
): boolean {
  if (!canChangeRoomStatus(role, from, to)) return false;
  return from !== 'OUT_OF_ORDER' && to !== 'OUT_OF_ORDER';
}

export const roomStatusRules: RoomStatusRules = {
  groupOf: roomStatusGroupOf,
  canChange: canChangeRoomStatus,
  canChangeManually: canChangeRoomStatusManually,
};
