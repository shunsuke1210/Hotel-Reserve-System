// 操作履歴の記録（design.md shared/audit AuditLogService、要件 18.1〜18.3、設計の補足 DT-M34・L-42・L-49）。
//
// 社内用 API の登録・変更・削除の操作と、定時処理の操作を、audit_logs に1行ずつ追記する。使い方：
//
//   // コントローラー：@CurrentStaff() staff: StaffPrincipal を受け取り、サービスに渡す
//   await runInTransaction(this.prisma, async (tx) => {
//     … 予約・部屋などを変える（部屋の状態の変化は RoomStatusService から受け取る）…
//     await this.audit.record(tx, staffActor(staff), {
//       action: 'CHECK_IN',
//       target: { type: 'reservation', id: reservationId },
//       detail: { roomStatusChanges },
//     });
//   });
//
//   // 定時処理：対象1件ごとのトランザクション（ctx.processTargets の process）の中で
//   await this.audit.record(tx, systemActor(ctx), { action: 'NO_SHOW', target: { type: 'reservation', id } });
//
// 約束：
// - 操作と同じトランザクション（runInTransaction の tx）の中で記録する。操作が失敗して取り消されれば、操作履歴も
//   残らない（権限がない・入力の誤り・業務エラーで失敗した操作は記録しない：TC-MB-219）。トランザクションの外の
//   PrismaService を渡すと断る
// - 1つの操作（API の1回の要求。定時処理は対象1件）につき1行（L-42）。各処理は1つのトランザクションで行う
//   （design.md 処理仕様の前書き）ので、同じトランザクションで2行目を記録しようとすると断る。ほかの処理の中から
//   呼ばれる処理（部屋の状態の変更など）は自分で記録せず、変化を呼び出し側に返して、呼び出し側の1行の detail に入れる
// - 失敗した操作を記録しないので、記録はトランザクションの中のどこで行ってもよい（行が見えるのは確定した後）
// - 個人情報の値は記録しない（audit-entry.ts の形の検査）。そのため会員の削除（P-16）でも操作履歴は消さない（19.4）
// - audit_logs は追記だけ。アプリのデータベース利用者には UPDATE・DELETE の権限がなく、トリガーもそれを拒否する（18.2）。
//   操作履歴を変更・削除する API は作らない
import { Injectable } from '@nestjs/common';
import { BusinessClock } from '../clock/business-clock.js';
import type { TransactionClient } from '../prisma/transaction.js';
import { buildAuditLogRow, type AuditActor, type AuditEntry } from './audit-entry.js';

/** 操作履歴を記録したトランザクション（1つのトランザクションに1行だけにするため。トランザクションが終われば消える） */
const recordedTransactions = new WeakSet<object>();

@Injectable()
export class AuditLogService {
  constructor(private readonly clock: BusinessClock) {}

  /**
   * 1つの操作の操作履歴を、操作と同じトランザクションの中で1行追記する。
   * @param tx 操作のトランザクション（runInTransaction の tx）
   * @returns 追記した行の ID
   * @throws Error トランザクションの外の接続を渡したとき・同じトランザクションで2行目を記録しようとしたとき
   * @throws RangeError 内容の形が正しくないとき（audit-entry.ts）
   */
  async record(tx: TransactionClient, actor: AuditActor, entry: AuditEntry): Promise<string> {
    assertTransactionClient(tx);
    if (recordedTransactions.has(tx)) {
      throw new Error(
        '1つの操作（1つのトランザクション）の操作履歴は1行だけです。同時に変わる部屋の状態などは、その1行の detail に入れてください（設計の補足 L-42）',
      );
    }
    const row = buildAuditLogRow(actor, entry, entry.at ?? this.clock.now());
    recordedTransactions.add(tx);
    const created = await tx.auditLog.create({
      data: { ...row, detail: { ...row.detail } },
      select: { id: true },
    });
    return created.id;
  }
}

/**
 * トランザクションのクライアントか。PrismaService（トランザクションの外の接続）には $connect があり、
 * 対話型のトランザクションのクライアントにはない（Prisma の ITXClientDenyList。TransactionClient の型も同じ）
 */
function assertTransactionClient(client: TransactionClient): void {
  if (typeof (client as { $connect?: unknown }).$connect === 'function') {
    throw new Error(
      '操作履歴は、操作と同じトランザクション（runInTransaction の tx）の中で記録してください。失敗した操作の操作履歴が残らないようにするためです',
    );
  }
}
