// 業務の操作による部屋の状態の変更の表（design.md 処理仕様 P-12 の「誰が」が操作の行、P-10・P-13、
// 設計の補足 DT-M12・DT-M14・DT-M31、要件 11.2・11.3・11.8・12.5・12.6・13.1・13.4・13.6・13.7）。
//
// 業務の操作（チェックイン・チェックアウト・故障中の設定と修理の完了・9:00 の処理・チェックイン後の故障による移動）は、
// 役割のルール（domain/room-status の roomStatusRules。手動の変更だけに使う）を通さず、この表で判定する
// （tasks.md 2.5 の注記）。操作ごとに「変える先の状態」と「その状態へ変えてよい今の状態」を決める。
// 入力だけから結果が決まる純粋な関数（データベースは RoomStatusService が扱う）。
//
// 表にない組み合わせの扱い（RoomStatusService.applyOperation）：
//   - チェックイン・移動（→ チェックイン済み）：今の状態が清掃完了でなければ ROOM_NOT_CLEAN（業務エラー。11.2・DT-M14）。
//     チェックインの処理（7.7）は DT-M38 の順番で自分でも確かめるが、確かめた後に清掃員が変えた場合の最後の守りになる
//   - 同じ状態（例：9:00 の処理で清掃有（連泊）のままの部屋、チェックアウトで故障中のままの部屋）：何も変えない
//   - それ以外：呼び出し側の誤り（RoomStatusTransitionError）。チェックアウト・故障中・9:00 の処理には部屋の状態による
//     業務エラーがない（チェックアウトの断りは状態・出発日・残高だけ：DT-M38。定時処理は SKIPPED）ので、呼び出し側が
//     lockRooms で今の状態を読み、表にある変更だけを求める（表にない部屋はそのままにする）
import { ROOM_STATUSES, ROOM_STATUSES_BY_GROUP, type RoomStatus } from '@hotel/contracts';
import { roomStatusGroupOf } from '../../domain/room-status/transitions.js';

/** 部屋の状態を変える業務の操作 */
export const ROOM_STATUS_OPERATIONS = [
  /** チェックイン（P-10 手順1。7.7） */
  'CHECK_IN',
  /** チェックイン後の故障による移動の移し先（DT-M14。移動のタスク） */
  'ROOM_MOVE',
  /** チェックアウト（P-10 手順4。7.8） */
  'CHECK_OUT',
  /** 故障中の設定（開始日が今日のもの。P-13。7.9） */
  'OUT_OF_ORDER_START',
  /** 修理の完了（P-13。7.9） */
  'OUT_OF_ORDER_END',
  /** 毎朝 9:00 の処理 morning-status（P-12・DT-M12。7.12） */
  'MORNING_STATUS',
] as const;
export type RoomStatusOperation = (typeof ROOM_STATUS_OPERATIONS)[number];

/** 1つの部屋の変更の判定 */
export type OperationTransitionOutcome =
  /** 変える */
  | 'CHANGE'
  /** 同じ状態なので変えない */
  | 'UNCHANGED'
  /** チェックイン・移動の部屋が清掃完了でない（業務エラー ROOM_NOT_CLEAN） */
  | 'ROOM_NOT_CLEAN'
  /** P-12 にない変更（呼び出し側の誤り） */
  | 'NOT_ALLOWED';

const VACANT = ROOM_STATUSES_BY_GROUP.VACANT;
/** 客が泊まっている部屋（チェックイン済みと連泊グループ） */
const OCCUPIED: readonly RoomStatus[] = ['CHECKED_IN', ...ROOM_STATUSES_BY_GROUP.STAY];
const ANY: readonly RoomStatus[] = ROOM_STATUSES;

/** 操作ごとに、変える先の状態 → その状態へ変えてよい今の状態 */
const OPERATION_TRANSITIONS: Readonly<
  Record<RoomStatusOperation, Partial<Readonly<Record<RoomStatus, readonly RoomStatus[]>>>>
> = {
  // 清掃完了 → チェックイン済み（11.3）
  CHECK_IN: { CHECKED_IN: ['CLEAN'] },
  // 移し先の清掃完了の部屋 → チェックイン済み（DT-M14）
  ROOM_MOVE: { CHECKED_IN: ['CLEAN'] },
  CHECK_OUT: {
    // チェックアウト待ち・チェックイン済み・連泊グループのどれからでも清掃可（11.8、ST-04・ST-05）
    CLEANING_READY: [...OCCUPIED, 'DEPARTURE_PENDING'],
    // 今日から故障中の期間に入る部屋は、チェックアウトで故障中（13.6・DT-M31）。P-12 の表はチェックイン済み・
    // チェックアウト待ちだけを書くが、9:00 より前のチェックアウト（連泊グループの部屋。ST-05）も同じ扱いにする
    OUT_OF_ORDER: [...OCCUPIED, 'DEPARTURE_PENDING'],
  },
  // 任意 → 故障中（13.1。今夜も泊まる客がいる部屋も：13.7）
  OUT_OF_ORDER_START: { OUT_OF_ORDER: ANY },
  // 故障中 → 清掃完了（13.4）
  OUT_OF_ORDER_END: { CLEAN: ['OUT_OF_ORDER'] },
  MORNING_STATUS: {
    // チェックイン済み・連泊グループ → 今日チェックアウトならチェックアウト待ち、ほかは清掃有（連泊）（12.5）
    DEPARTURE_PENDING: OCCUPIED,
    STAY_DIRTY: OCCUPIED,
    // ノーショーの予約が割り当てられていた部屋（チェックイン前の空室）→ 来客なし（12.6）
    NO_ARRIVAL: VACANT,
    // 今日から故障中の期間に入る部屋：今夜も泊まる客がいる部屋（13.7）と、先の日付で設定した故障中（DT-M12・DT-M40）
    OUT_OF_ORDER: ANY,
  },
};

/** 今の状態が清掃完了でなければ ROOM_NOT_CLEAN にする操作（11.2・DT-M14） */
const CLEAN_REQUIRED: ReadonlySet<RoomStatusOperation> = new Set(['CHECK_IN', 'ROOM_MOVE']);

function transitionsOf(
  operation: RoomStatusOperation,
): Partial<Readonly<Record<RoomStatus, readonly RoomStatus[]>>> {
  if (!Object.hasOwn(OPERATION_TRANSITIONS, operation)) {
    throw new RangeError(`部屋の状態を変える業務の操作ではありません：${String(operation)}`);
  }
  return OPERATION_TRANSITIONS[operation];
}

/** その操作が変える先の状態 */
export function operationTargets(operation: RoomStatusOperation): readonly RoomStatus[] {
  return ROOM_STATUSES.filter((status) => transitionsOf(operation)[status] !== undefined);
}

/** その操作をする人の種類（9:00 の処理は定時処理、ほかはスタッフの操作） */
export function operationActorKind(operation: RoomStatusOperation): 'STAFF' | 'SYSTEM' {
  transitionsOf(operation);
  return operation === 'MORNING_STATUS' ? 'SYSTEM' : 'STAFF';
}

/**
 * 業務の操作で、今の状態 from の部屋を to にするときの判定（P-12）。
 * @throws RangeError 操作・状態でない値、またはその操作が変える先の状態でない to（呼び出し側の誤り）
 */
export function evaluateOperationTransition(
  operation: RoomStatusOperation,
  from: RoomStatus,
  to: RoomStatus,
): OperationTransitionOutcome {
  const transitions = transitionsOf(operation);
  const allowedFrom = Object.hasOwn(transitions, to) ? transitions[to] : undefined;
  if (allowedFrom === undefined) {
    throw new RangeError(`業務の操作 ${operation} が変える先の状態ではありません：${String(to)}`);
  }
  roomStatusGroupOf(from);
  if (CLEAN_REQUIRED.has(operation)) return from === 'CLEAN' ? 'CHANGE' : 'ROOM_NOT_CLEAN';
  if (from === to) return 'UNCHANGED';
  return allowedFrom.includes(from) ? 'CHANGE' : 'NOT_ALLOWED';
}
