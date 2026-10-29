// 業務の操作による部屋の状態の変更の表（design.md 処理仕様 P-12 の「誰が」が操作の行、P-10・P-13、
// 設計の補足 DT-M12・DT-M14・DT-M31、要件 11.2・11.3・11.8・12.5・12.6・13.1・13.4・13.6・13.7）。
// 役割で決まる変更（清掃員・フロント以上の手動の変更）は domain/room-status の roomStatusRules（2.5）が決め、
// ここでは扱わない。業務の操作は役割のルールを通さない（tasks.md 2.5 の注記）。
import { ROOM_STATUSES, type RoomStatus } from '@hotel/contracts';
import { describe, expect, it } from 'vitest';
import {
  evaluateOperationTransition,
  operationActorKind,
  operationTargets,
  ROOM_STATUS_OPERATIONS,
  type OperationTransitionOutcome,
  type RoomStatusOperation,
} from './room-status-operations.js';

/** 表の列の並び（contracts の ROOM_STATUSES と同じ）。空室の清掃・連泊・その他の4つずつを空白で区切る */
const COLUMNS: readonly RoomStatus[] = [
  'CLEANING_READY',
  'CLEANING',
  'INSPECTION',
  'CLEAN',
  'STAY_DIRTY',
  'STAY_CLEANING',
  'STAY_INSPECTION',
  'STAY_CLEAN',
  'CHECKED_IN',
  'DEPARTURE_PENDING',
  'NO_ARRIVAL',
  'OUT_OF_ORDER',
];

/**
 * 記号：o＝変える、=＝同じ状態なので変えない、c＝清掃完了でないので断る（ROOM_NOT_CLEAN）、
 * x＝P-12 にない変更（呼び出し側の誤り）、.＝その操作が変える先の状態ではない（RangeError）
 */
const SYMBOL: Record<OperationTransitionOutcome, string> = {
  CHANGE: 'o',
  UNCHANGED: '=',
  ROOM_NOT_CLEAN: 'c',
  NOT_ALLOWED: 'x',
};

type Matrix = Record<RoomStatus, string>;

/** 操作ごとに、行＝今の状態・列＝変える先の状態の結果を表の形にする */
function matrixOf(operation: RoomStatusOperation): Matrix {
  const targets = new Set(operationTargets(operation));
  const rows = COLUMNS.map((from) => {
    const cells = COLUMNS.map((to) =>
      targets.has(to) ? SYMBOL[evaluateOperationTransition(operation, from, to)] : '.',
    );
    const row = [cells.slice(0, 4), cells.slice(4, 8), cells.slice(8, 12)]
      .map((group) => group.join(''))
      .join(' ');
    return [from, row] as const;
  });
  return Object.fromEntries(rows) as Matrix;
}

describe('業務の操作の表', () => {
  it('列の並びは contracts の ROOM_STATUSES と同じ（表の読み違いを防ぐ）', () => {
    expect(COLUMNS).toEqual(ROOM_STATUSES);
  });

  it('操作は、チェックイン・移動・チェックアウト・故障中の設定と修理の完了・9:00 の処理の6つ', () => {
    expect(ROOM_STATUS_OPERATIONS).toEqual([
      'CHECK_IN',
      'ROOM_MOVE',
      'CHECK_OUT',
      'OUT_OF_ORDER_START',
      'OUT_OF_ORDER_END',
      'MORNING_STATUS',
    ]);
  });

  it('[11.2][11.3] チェックイン：清掃完了 → チェックイン済みだけ。清掃完了でない部屋（チェックイン済みを含む）は ROOM_NOT_CLEAN', () => {
    expect(matrixOf('CHECK_IN')).toEqual({
      CLEANING_READY: '.... .... c...',
      CLEANING: '.... .... c...',
      INSPECTION: '.... .... c...',
      CLEAN: '.... .... o...',
      STAY_DIRTY: '.... .... c...',
      STAY_CLEANING: '.... .... c...',
      STAY_INSPECTION: '.... .... c...',
      STAY_CLEAN: '.... .... c...',
      CHECKED_IN: '.... .... c...',
      DEPARTURE_PENDING: '.... .... c...',
      NO_ARRIVAL: '.... .... c...',
      OUT_OF_ORDER: '.... .... c...',
    });
  });

  it('[DT-M14] チェックイン後の故障による移動：移し先は清掃完了の部屋だけで、チェックイン済みにする（チェックインと同じ）', () => {
    expect(matrixOf('ROOM_MOVE')).toEqual(matrixOf('CHECK_IN'));
  });

  it('[11.8][13.6] チェックアウト：チェックイン済み・連泊グループ・チェックアウト待ち → 清掃可、または（今日から故障中の部屋は）故障中。故障中の部屋はそのまま', () => {
    expect(matrixOf('CHECK_OUT')).toEqual({
      CLEANING_READY: '=... .... ...x',
      CLEANING: 'x... .... ...x',
      INSPECTION: 'x... .... ...x',
      CLEAN: 'x... .... ...x',
      STAY_DIRTY: 'o... .... ...o',
      STAY_CLEANING: 'o... .... ...o',
      STAY_INSPECTION: 'o... .... ...o',
      STAY_CLEAN: 'o... .... ...o',
      CHECKED_IN: 'o... .... ...o',
      DEPARTURE_PENDING: 'o... .... ...o',
      NO_ARRIVAL: 'x... .... ...x',
      OUT_OF_ORDER: 'x... .... ...=',
    });
  });

  it('[13.1][13.7] 故障中の設定：どの状態からでも故障中にする（役割のルールを通さない）', () => {
    expect(matrixOf('OUT_OF_ORDER_START')).toEqual({
      CLEANING_READY: '.... .... ...o',
      CLEANING: '.... .... ...o',
      INSPECTION: '.... .... ...o',
      CLEAN: '.... .... ...o',
      STAY_DIRTY: '.... .... ...o',
      STAY_CLEANING: '.... .... ...o',
      STAY_INSPECTION: '.... .... ...o',
      STAY_CLEAN: '.... .... ...o',
      CHECKED_IN: '.... .... ...o',
      DEPARTURE_PENDING: '.... .... ...o',
      NO_ARRIVAL: '.... .... ...o',
      OUT_OF_ORDER: '.... .... ...=',
    });
  });

  it('[13.4] 修理の完了：故障中 → 清掃完了だけ', () => {
    expect(matrixOf('OUT_OF_ORDER_END')).toEqual({
      CLEANING_READY: '...x .... ....',
      CLEANING: '...x .... ....',
      INSPECTION: '...x .... ....',
      CLEAN: '...= .... ....',
      STAY_DIRTY: '...x .... ....',
      STAY_CLEANING: '...x .... ....',
      STAY_INSPECTION: '...x .... ....',
      STAY_CLEAN: '...x .... ....',
      CHECKED_IN: '...x .... ....',
      DEPARTURE_PENDING: '...x .... ....',
      NO_ARRIVAL: '...x .... ....',
      OUT_OF_ORDER: '...o .... ....',
    });
  });

  it('[12.5][12.6][13.7][DT-M12] 9:00 の処理：チェックイン済み・連泊グループ → チェックアウト待ち・清掃有（連泊）・故障中、空室の清掃グループ → 来客なし、どの状態からでも故障中', () => {
    expect(matrixOf('MORNING_STATUS')).toEqual({
      CLEANING_READY: '.... x... .xoo',
      CLEANING: '.... x... .xoo',
      INSPECTION: '.... x... .xoo',
      CLEAN: '.... x... .xoo',
      // 清掃しなかった部屋（清掃有（連泊）のまま）も対象だが、同じ状態なので変えない（TC-OP-224）
      STAY_DIRTY: '.... =... .oxo',
      STAY_CLEANING: '.... o... .oxo',
      STAY_INSPECTION: '.... o... .oxo',
      STAY_CLEAN: '.... o... .oxo',
      CHECKED_IN: '.... o... .oxo',
      DEPARTURE_PENDING: '.... x... .=xo',
      NO_ARRIVAL: '.... x... .x=o',
      OUT_OF_ORDER: '.... x... .xx=',
    });
  });

  it('操作した人：9:00 の処理は定時処理（システム）、ほかはスタッフ', () => {
    expect(
      Object.fromEntries(ROOM_STATUS_OPERATIONS.map((op) => [op, operationActorKind(op)])),
    ).toEqual({
      CHECK_IN: 'STAFF',
      ROOM_MOVE: 'STAFF',
      CHECK_OUT: 'STAFF',
      OUT_OF_ORDER_START: 'STAFF',
      OUT_OF_ORDER_END: 'STAFF',
      MORNING_STATUS: 'SYSTEM',
    });
  });

  it('その操作が変える先の状態でなければ RangeError（呼び出し側の誤り）', () => {
    expect(() => evaluateOperationTransition('CHECK_IN', 'CLEAN', 'STAY_DIRTY')).toThrow(
      RangeError,
    );
    expect(() =>
      evaluateOperationTransition('OUT_OF_ORDER_END', 'OUT_OF_ORDER', 'CLEANING_READY'),
    ).toThrow(RangeError);
  });

  it('操作・状態でない値は RangeError', () => {
    expect(() =>
      evaluateOperationTransition('CLEANING' as RoomStatusOperation, 'CLEAN', 'CHECKED_IN'),
    ).toThrow(RangeError);
    expect(() => operationTargets('CLEANING' as RoomStatusOperation)).toThrow(RangeError);
    expect(() => operationActorKind('CLEANING' as RoomStatusOperation)).toThrow(RangeError);
    expect(() =>
      evaluateOperationTransition('CHECK_OUT', 'DIRTY' as RoomStatus, 'CLEANING_READY'),
    ).toThrow(RangeError);
  });
});
