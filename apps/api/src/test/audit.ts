// 操作履歴（audit_logs）を確かめる結合テストの補助（tasks.md 3.3）。
//
//   const before = await countAuditLogs(db.prisma);
//   … 社内用 API を呼ぶ …
//   const rows = await listAuditLogs(db.prisma, { targetId: reservationId });
//   expect(rows).toHaveLength(1);                                    // 1つの操作につき1行（L-42）
//   expect(personalValuesIn(rows, ['佐藤 一郎', 'E12345678'])).toEqual([]);   // 個人情報の値がない（18.3）
import type { Prisma } from '../shared/prisma/generated/client.js';
import type { PrismaService } from '../shared/prisma/prisma.service.js';

/** 操作履歴の行（記録した順） */
export function listAuditLogs(prisma: PrismaService, where: Prisma.AuditLogWhereInput = {}) {
  return prisma.auditLog.findMany({ where, orderBy: [{ createdAt: 'asc' }, { at: 'asc' }] });
}

/** 操作履歴の行の数 */
export function countAuditLogs(
  prisma: PrismaService,
  where: Prisma.AuditLogWhereInput = {},
): Promise<number> {
  return prisma.auditLog.count({ where });
}

/** values のうち、行のどこか（全列・detail の中を含む）に現れる値。個人情報の値が記録されていなければ空 */
export function personalValuesIn(rows: readonly object[], values: readonly string[]): string[] {
  const text = JSON.stringify(rows);
  return values.filter((value) => text.includes(value));
}
