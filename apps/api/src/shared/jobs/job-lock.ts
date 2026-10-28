// 定時処理の多重起動の防止（research.md ADR-09：PostgreSQL のアドバイザリーロック）。
//
// 同じ処理が同時に2つ起動しても（同じプロセスの重なった起動、複数の API のプロセス）、ロックを取れた1つだけが実行する。
// ロックは、処理の間だけ開いておくトランザクションの中で pg_try_advisory_xact_lock で取る（待たずに、取れなければ諦める）。
// - トランザクションが終わると PostgreSQL がロックを放す。処理が終わったとき、最大の時間を過ぎたとき（Prisma が取り消す）、
//   接続が切れたときやプロセスが止まったときも放されるので、ロックが残り続けることはない
// - 接続プールの中の接続を1つ、処理の間だけ使う。処理のデータベースの操作は、このトランザクションの外（別の接続）で行う
// - 鍵は2つの int4：1つ目は定時処理だけの名前空間、2つ目は処理の名前から作る（ほかの用途のアドバイザリーロックと重ならない）
import { createHash } from 'node:crypto';
import type { PrismaService } from '../prisma/prisma.service.js';
import { runInTransaction } from '../prisma/transaction.js';

/** 定時処理のアドバイザリーロックの名前空間（1つ目の鍵）。"JOBS" の ASCII */
export const JOB_LOCK_NAMESPACE = 0x4a4f4253;

/** 処理の名前から作る2つ目の鍵（名前の SHA-256 の先頭4バイトを符号つきの32ビット整数として読む） */
export function jobLockKey(jobName: string): number {
  if (jobName === '') throw new RangeError('定時処理の名前がありません');
  return createHash('sha256').update(jobName, 'utf8').digest().readInt32BE(0);
}

export type JobLockResult<T> =
  /** ほかの実行がロックを持っていた（work は呼ばない） */
  | { acquired: false }
  /**
   * ロックを取り、work を実行した。
   * releaseError：ロックを放すとき（トランザクションを終えるとき）の例外。最大の時間を過ぎて先に取り消されていた場合など。
   * いずれにしてもロックはもう外れている
   */
  | { acquired: true; value: T; releaseError?: unknown };

/**
 * ロックを取れたら work を実行する。
 * ロックの取得の失敗（データベースに接続できないなど）と、work の例外は、そのまま投げる。
 * @param maxDurationMs ロックを持つ最大の時間（ミリ秒）。過ぎるとロックが外れ、ほかの起動が実行できるようになる
 */
export async function withJobLock<T>(
  prisma: PrismaService,
  jobName: string,
  maxDurationMs: number,
  work: () => Promise<T>,
): Promise<JobLockResult<T>> {
  const key = jobLockKey(jobName);
  // work の結果（トランザクションの外へ持ち出す。ロックを放すときに失敗しても、結果は失わない）
  const state: { settled?: { ok: true; value: T } | { ok: false; error: unknown } } = {};
  let acquired: boolean;
  try {
    acquired = await runInTransaction(
      prisma,
      async (tx) => {
        const rows = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${JOB_LOCK_NAMESPACE}::int4, ${key}::int4) AS locked`;
        if (rows[0]?.locked !== true) return false;
        try {
          state.settled = { ok: true, value: await work() };
        } catch (error) {
          state.settled = { ok: false, error };
        }
        return true;
      },
      { timeoutMs: maxDurationMs },
    );
  } catch (error) {
    // work を実行する前の失敗（ロックの取得など）はそのまま投げる。実行した後なら、ロックを放すときの失敗
    const settled = state.settled;
    if (settled === undefined) throw error;
    if (!settled.ok) throw settled.error;
    return { acquired: true, value: settled.value, releaseError: error };
  }
  if (!acquired) return { acquired: false };
  const settled = state.settled;
  if (settled === undefined) throw new Error('ロックを取った後の処理の結果がありません');
  if (!settled.ok) throw settled.error;
  return { acquired: true, value: settled.value };
}
