// 部屋の状態の変更（design.md Components の RoomStatusService、処理仕様 P-12、Data Models rooms、
// 設計の補足 L-23・L-42、要件 12.1〜12.4・12.7）。
//
// 部屋の状態（rooms.status）を変えるのは、このサービスだけにする。入口は2つ：
//
// 1. スタッフの手動の変更 changeByStaff（POST /rooms/{id}/status：7.11 のコントローラーから呼ぶだけでよい）
//    役割のルール（roomStatusRules.canChangeManually：清掃員は同じグループの中と「来客なし → 清掃完了」だけ、
//    フロント以上はどの状態にも。故障中への変更と故障中からの変更はどの役割でも断る L-23）で判定し、
//    自分のトランザクションで rooms の status・status_changed_at・status_changed_by と、操作履歴 ROOM_STATUS_CHANGE
//    （対象は部屋、detail.roomStatusChanges に変化）を1行書く。別のトランザクションの中で呼ばない。
//
//      @Post(':id/status')
//      change(@CurrentStaff() staff: StaffPrincipal, @Param('id') id: string, @Body() body: { to: RoomStatus }) {
//        return this.roomStatus.changeByStaff(staff, id, body.to);
//      }
//
// 2. 業務の操作の入口 applyOperation（チェックイン 7.7・チェックアウト 7.8・故障中の設定と修理の完了 7.9・
//    9:00 の処理 7.12・チェックイン後の故障による移動 DT-M14）
//    役割のルールを通さず、操作ごとの表（room-status-operations.ts。P-12 の操作の行）で判定する。呼び出し側の
//    トランザクションの中で rooms を変え、操作履歴は書かずに変化（AuditRoomStatusChange）を返す。呼び出し側は、
//    その操作の1行（CHECK_IN・CHECK_OUT・OUT_OF_ORDER_*・定時処理の ROOM_STATUS_CHANGE）の detail に入れる（L-42。
//    ここで書くと、同じトランザクションの2行目として AuditLogService に断られる）：
//
//      await runInTransaction(this.prisma, async (tx) => {
//        const rooms = await this.roomStatus.lockRooms(tx, roomIds);       // 今の状態を読んで判定する（DT-M38 の順番など）
//        … 判定・予約の変更 …
//        const roomStatusChanges = await this.roomStatus.applyOperation(
//          tx, staffActor(staff), 'CHECK_IN', roomIds.map((roomId) => ({ roomId, to: 'CHECKED_IN' })), { at: now });
//        await this.audit.record(tx, staffActor(staff), {
//          action: 'CHECK_IN', target: { type: 'reservation', id }, detail: { roomStatusChanges }, at: now });
//      });
//
//    定時処理は processTargets の process の tx の中で、systemActor(ctx) と 'MORNING_STATUS' で呼ぶ。変化が空なら
//    （同じ状態だった）'SKIPPED' として操作履歴を書かない。
//
// 約束：
// - 「いつ・誰が」は rooms.status_changed_at・status_changed_by（スタッフの ID。定時処理は空）と、操作履歴の1行
//   （スタッフ番号または SYSTEM:処理名・日時・操作の名前）に残る
// - 部屋の行は SELECT … FOR NO KEY UPDATE でロックしてから今の状態を読む。同じ部屋の同時の変更（2人の清掃員、
//   清掃員とチェックイン）は1つずつ行われ、後の変更は先の変更の後の状態で判定される。FOR UPDATE にしないのは、
//   rooms を参照する行（room_nights・reservation_rooms・out_of_order_periods・notices）の追加で外部キーの確認が
//   取る FOR KEY SHARE と衝突させないため（確保・確定を待たせず、それらとのデッドロックも起こさない）。
//   複数の部屋は ID の順にロックする（ロックの順番をそろえて、同じ部屋を求める操作どうしのデッドロックを避ける）
// - 同じ状態への変更（ボタンの二度押しなど）は何もせずに成功する（changed: false。時刻・変えた人・操作履歴は
//   変えない）。手動の変更の 422 は、許されない変更のときだけ（tasks.md 2.5 の注記で 3.7 が決めることにした点）
import { ROOM_STATUSES, type RoomStatus } from '@hotel/contracts';
import { Injectable } from '@nestjs/common';
import {
  staffActor,
  type AuditActor,
  type AuditRoomStatusChange,
} from '../../shared/audit/audit-entry.js';
import { AuditLogService } from '../../shared/audit/audit-log.service.js';
import { BusinessClock } from '../../shared/clock/business-clock.js';
import { BusinessError } from '../../shared/errors/business-error.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import { runInTransaction, type TransactionClient } from '../../shared/prisma/transaction.js';
import type { StaffPrincipal } from '../../shared/session/principals.js';
import { manualChangeRejection } from './manual-change-rejection.js';
import {
  evaluateOperationTransition,
  operationActorKind,
  type RoomStatusOperation,
} from './room-status-operations.js';

/** 部屋の今の状態 */
export interface RoomStatusView {
  roomId: string;
  roomNumber: number;
  status: RoomStatus;
  /** 最後に状態を変えた時刻 */
  statusChangedAt: Date;
  /** 最後に状態を変えたスタッフの ID（定時処理の変更と、まだ変えていない部屋は空） */
  statusChangedBy: string | null;
}

/** スタッフの手動の変更の結果 */
export interface ManualRoomStatusChangeResult {
  /** 変えたか（false：すでにその状態だったので何も変えなかった） */
  changed: boolean;
  /** 変更の後の部屋の状態 */
  room: RoomStatusView;
}

/** 業務の操作で変える1つの部屋 */
export interface RoomStatusChangeRequest {
  readonly roomId: string;
  readonly to: RoomStatus;
}

export interface ApplyOperationOptions {
  /** 変えた時刻（省略時は業務の時計の今）。操作の行の時刻（checked_in_at・操作履歴の at など）とそろえるときに渡す */
  readonly at?: Date;
}

/**
 * 業務の操作で、P-12 にない変更を求めた（呼び出し側の誤り）。呼び出し側は lockRooms で今の状態を読み、
 * 表にある変更だけを求める（room-status-operations.ts）。文言は部屋の状態と操作の名前だけで、個人情報を含めない
 */
export class RoomStatusTransitionError extends Error {
  constructor(
    readonly operation: RoomStatusOperation,
    readonly roomId: string,
    readonly from: RoomStatus,
    readonly to: RoomStatus,
  ) {
    super(
      `業務の操作 ${operation} では、部屋の状態を ${from} から ${to} へ変えられません（design.md P-12）。lockRooms で今の状態を確かめてから変えてください`,
    );
    this.name = 'RoomStatusTransitionError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOM_STATUS_VALUES: ReadonlySet<string> = new Set(ROOM_STATUSES);

interface LockedRoomRow {
  id: string;
  room_number: number;
  status: string;
  status_changed_at: Date;
  status_changed_by: string | null;
}

@Injectable()
export class RoomStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: BusinessClock,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * スタッフの手動の変更（POST /rooms/{id}/status。12.2〜12.4・12.7）。自分のトランザクションで、部屋の状態と
   * 操作履歴 ROOM_STATUS_CHANGE を1行記録する。すでにその状態なら何も変えずに changed: false を返す。
   * @param staff 操作したスタッフ（@CurrentStaff()。役割で判定し、スタッフ番号を操作履歴に記録する）
   * @throws BusinessError NOT_FOUND：部屋がないとき（ID の形が違うときを含む）
   * @throws BusinessError VALIDATION_FAILED：to が部屋の状態でないとき
   * @throws BusinessError STATUS_TRANSITION_NOT_ALLOWED：役割で許されない変更（details に reason・from・to。L-23 を含む）
   */
  async changeByStaff(
    staff: Pick<StaffPrincipal, 'staffId' | 'staffNumber' | 'role'>,
    roomId: string,
    to: RoomStatus,
  ): Promise<ManualRoomStatusChangeResult> {
    // 要求の形の検証は 7.11 のコントローラー（zod）が先に行う。ここは型を通らずに渡された値の守り
    if (typeof to !== 'string' || !ROOM_STATUS_VALUES.has(to)) {
      throw new BusinessError('VALIDATION_FAILED');
    }
    if (typeof roomId !== 'string' || !UUID.test(roomId)) throw new BusinessError('NOT_FOUND');
    const actor = staffActor(staff);
    const now = this.clock.now();
    return runInTransaction(this.prisma, async (tx) => {
      const room = (await this.lockRoomRows(tx, [roomId])).get(roomId.toLowerCase());
      if (room === undefined) throw new BusinessError('NOT_FOUND');
      const from = room.status;
      if (from === to) return { changed: false, room };

      const rejection = manualChangeRejection(staff.role, from, to);
      if (rejection !== null) {
        throw new BusinessError('STATUS_TRANSITION_NOT_ALLOWED', {
          message: rejection.message,
          details: { reason: rejection.reason, from, to },
        });
      }
      const changed = await this.updateStatus(tx, room.roomId, to, actor, now);
      await this.audit.record(tx, actor, {
        action: 'ROOM_STATUS_CHANGE',
        target: { type: 'room', id: room.roomId },
        detail: { roomStatusChanges: [{ roomId: room.roomId, from, to }] },
        at: now,
      });
      return { changed: true, room: changed };
    });
  }

  /**
   * 部屋の行をロックして今の状態を読む（業務の操作のトランザクションの中で、変える前の判定に使う。
   * 例：チェックインの ROOM_NOT_CLEAN、チェックアウトで清掃可・故障中・そのままのどれにするか、9:00 の処理の確かめ直し）。
   * ロックはトランザクションの終わりまで続き、その間の手動の変更・ほかの操作は待たされる。部屋の ID の順にロックする。
   * @returns 部屋の ID（小文字）→ 今の状態
   * @throws RangeError 部屋の ID が UUID でないとき（プログラムの誤り）
   * @throws Error トランザクションの外の接続を渡したとき・ない部屋があるとき（プログラムの誤り）
   */
  async lockRooms(
    tx: TransactionClient,
    roomIds: readonly string[],
  ): Promise<ReadonlyMap<string, RoomStatusView>> {
    assertTransactionClient(tx);
    const ids = normalizedRoomIds(roomIds);
    const rooms = await this.lockRoomRows(tx, ids);
    const missing = ids.filter((id) => !rooms.has(id));
    if (missing.length > 0) {
      throw new Error(
        `部屋がありません（${missing.length}件）。予約に割り当てた部屋の ID を渡してください`,
      );
    }
    return rooms;
  }

  /**
   * 業務の操作による部屋の状態の変更（P-12 の操作の行。役割のルールは通さない）。呼び出し側のトランザクションの中で
   * 変え、操作履歴は書かずに、変わった部屋の変化を求めた順に返す（呼び出し側の操作の1行の detail.roomStatusChanges
   * に入れる：L-42）。すでにその状態の部屋は変えずに、戻り値に含めない（全部がそうなら空の配列）。
   * すべての部屋を確かめてから変えるので、断るときはどの部屋も変えない。
   * @param actor 操作した人（9:00 の処理は systemActor(ctx)、ほかは staffActor(staff)）。status_changed_by に使う
   * @throws BusinessError ROOM_NOT_CLEAN：チェックイン・移動の部屋が清掃完了でないとき（11.2・DT-M14。details に
   *   roomId・roomNumber・status）
   * @throws RoomStatusTransitionError P-12 にない変更（呼び出し側の誤り。lockRooms で今の状態を確かめてから呼ぶ）
   * @throws RangeError その操作が変える先でない状態・同じ部屋の重複・UUID でない部屋の ID（呼び出し側の誤り）
   * @throws Error トランザクションの外の接続を渡したとき・操作した人の種類が操作に合わないとき・ない部屋があるとき
   */
  async applyOperation(
    tx: TransactionClient,
    actor: AuditActor,
    operation: RoomStatusOperation,
    changes: readonly RoomStatusChangeRequest[],
    options: ApplyOperationOptions = {},
  ): Promise<AuditRoomStatusChange[]> {
    assertTransactionClient(tx);
    const actorKind = operationActorKind(operation);
    if (actor.kind !== actorKind) {
      throw new Error(
        `業務の操作 ${operation} は${actorKind === 'SYSTEM' ? '定時処理' : 'スタッフ'}の操作です（操作した人の種類が違います）`,
      );
    }
    const requests = changes.map((change) => ({
      roomId: normalizedRoomIds([change.roomId])[0]!,
      to: change.to,
    }));
    if (new Set(requests.map((request) => request.roomId)).size !== requests.length) {
      throw new RangeError('同じ部屋を2回指定しています');
    }
    if (requests.length === 0) return [];

    const rooms = await this.lockRooms(
      tx,
      requests.map((request) => request.roomId),
    );
    const planned: AuditRoomStatusChange[] = [];
    for (const { roomId, to } of requests) {
      const room = rooms.get(roomId)!;
      switch (evaluateOperationTransition(operation, room.status, to)) {
        case 'CHANGE':
          planned.push({ roomId, from: room.status, to });
          break;
        case 'UNCHANGED':
          break;
        case 'ROOM_NOT_CLEAN':
          throw new BusinessError('ROOM_NOT_CLEAN', {
            details: { roomId, roomNumber: room.roomNumber, status: room.status },
          });
        case 'NOT_ALLOWED':
          throw new RoomStatusTransitionError(operation, roomId, room.status, to);
      }
    }

    const at = options.at ?? this.clock.now();
    for (const change of planned) {
      await this.updateStatus(tx, change.roomId, change.to, actor, at);
    }
    return planned;
  }

  /**
   * 部屋の行を ID の順に1行ずつロックして読む（ない部屋は結果に含めない）。
   * FOR NO KEY UPDATE：状態の変更どうしは待たせ合い、外部キーの確認（FOR KEY SHARE）とは衝突しない（先頭の説明）
   */
  private async lockRoomRows(
    tx: TransactionClient,
    roomIds: readonly string[],
  ): Promise<Map<string, RoomStatusView>> {
    const rooms = new Map<string, RoomStatusView>();
    for (const roomId of [...new Set(roomIds.map((id) => id.toLowerCase()))].sort()) {
      const rows = await tx.$queryRaw<LockedRoomRow[]>`
        SELECT id, room_number, status, status_changed_at, status_changed_by
        FROM rooms WHERE id = ${roomId}::uuid FOR NO KEY UPDATE`;
      const row = rows[0];
      if (row !== undefined) rooms.set(roomId, toView(row));
    }
    return rooms;
  }

  private async updateStatus(
    tx: TransactionClient,
    roomId: string,
    to: RoomStatus,
    actor: AuditActor,
    at: Date,
  ): Promise<RoomStatusView> {
    const row = await tx.room.update({
      where: { id: roomId },
      data: {
        status: to,
        statusChangedAt: at,
        statusChangedBy: actor.kind === 'STAFF' ? actor.staffId : null,
      },
      select: {
        id: true,
        roomNumber: true,
        status: true,
        statusChangedAt: true,
        statusChangedBy: true,
      },
    });
    return {
      roomId: row.id,
      roomNumber: row.roomNumber,
      // 値はデータベースの CHECK 制約で ROOM_STATUSES に限られる
      status: row.status as RoomStatus,
      statusChangedAt: row.statusChangedAt,
      statusChangedBy: row.statusChangedBy,
    };
  }
}

function toView(row: LockedRoomRow): RoomStatusView {
  return {
    roomId: row.id,
    roomNumber: row.room_number,
    // 値はデータベースの CHECK 制約で ROOM_STATUSES に限られる
    status: row.status as RoomStatus,
    statusChangedAt: row.status_changed_at,
    statusChangedBy: row.status_changed_by,
  };
}

/** 部屋の ID を確かめて小文字にそろえる（UUID でない値をデータベースに渡すと、トランザクションが中断されるため） */
function normalizedRoomIds(roomIds: readonly string[]): string[] {
  return roomIds.map((roomId) => {
    if (typeof roomId !== 'string' || !UUID.test(roomId)) {
      throw new RangeError('部屋の ID が UUID ではありません');
    }
    return roomId.toLowerCase();
  });
}

/**
 * トランザクションのクライアントか。PrismaService（トランザクションの外の接続）には $connect があり、
 * 対話型のトランザクションのクライアントにはない（shared/audit/audit-log.service.ts と同じ見分け方）
 */
function assertTransactionClient(client: TransactionClient): void {
  if (typeof (client as { $connect?: unknown }).$connect === 'function') {
    throw new Error(
      '部屋の状態は、業務の操作と同じトランザクション（runInTransaction の tx）の中で変えてください。ロックを操作の終わりまで持ち、操作が取り消されたときに状態も戻すためです',
    );
  }
}
