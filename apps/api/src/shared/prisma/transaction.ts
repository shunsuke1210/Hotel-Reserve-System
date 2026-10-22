// トランザクションの補助。予約に関する変更などは、すべて1つのトランザクションの中で行い、途中で失敗したら何も変えない
// （design.md Domain Model・Error Strategy）。
//
//   await runInTransaction(prisma, async (tx) => {
//     await tx.roomNight.createMany({ data: nights });
//     await tx.reservation.update({ where: { id }, data: { version: { increment: 1 } } });
//   });
//
// 外部サービス（決済など）の呼び出しは、トランザクションの中で行わない（接続を長く占有しないように）。
// 一意制約の違反（同時の確保など）は、isUniqueViolation（prisma-errors.ts）で見分ける。
import type { Prisma } from './generated/client.js';
import type { PrismaService } from './prisma.service.js';

/** トランザクションの中で使うクライアント（PrismaService と同じ操作ができる。$transaction などは除く） */
export type TransactionClient = Prisma.TransactionClient;

export interface TransactionOptions {
  /** 分離レベル（省略時は PostgreSQL の既定と同じ ReadCommitted） */
  isolationLevel?: Prisma.TransactionIsolationLevel;
  /** 接続プールから接続を得るまで待つ最大の時間（ミリ秒） */
  maxWaitMs?: number;
  /** トランザクションの最大の時間（ミリ秒）。過ぎたら取り消す */
  timeoutMs?: number;
}

const DEFAULT_MAX_WAIT_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 10_000;

/** work を1つのトランザクションの中で行う。work が例外を投げたら取り消し、その例外をそのまま投げる */
export function runInTransaction<T>(
  prisma: PrismaService,
  work: (tx: TransactionClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  return prisma.$transaction(work, {
    isolationLevel: options.isolationLevel ?? 'ReadCommitted',
    maxWait: options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
}
