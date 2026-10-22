// 結合テスト用のデータベース（tasks.md 1.4）。
//
// 結合テストの実行のはじめに（global-setup.ts）、テスト用のサーバー（TEST_MIGRATION_DATABASE_URL のサーバー）に
// マイグレーションを適用した「ひな形」のデータベースを1つ作る。各テストは createTestDatabase で、ひな形を複製した
// 空のデータベースを新しく作って使う（複製は速い）。テストのファイルどうしは別のデータベースを使うので、
// 並列に動いても互いの行が見えず、何度実行しても同じ結果になる。
//
//   let db: TestDatabase;
//   beforeAll(async () => { db = await createTestDatabase(); });
//   afterAll(async () => { await db?.drop(); });
//   // db.prisma：アプリ用の利用者（API と同じ権限）で接続した PrismaService
//
// 待ち受け口のアプリでこのデータベースを使うときは、createTestListenerApp(…, { prisma: db.prisma })。
import { randomBytes } from 'node:crypto';
import { inject } from 'vitest';
import {
  connectPg,
  createDatabase,
  dropDatabases,
  withDatabaseName,
} from '../../../prisma/scripts/database-admin.js';
import { loadConfig, requireMigrationDatabaseUrl } from '../../shared/config/app-config.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';

export { connectPg };

/** global-setup.ts から各テストに渡す情報 */
export interface TestDatabaseRun {
  /** マイグレーションを適用したひな形のデータベースの名前 */
  template: string;
  /** この実行で作るデータベースの名前の接頭辞（後片付けに使う） */
  prefix: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseRun: TestDatabaseRun;
  }
}

export interface TestDatabase {
  /** データベースの名前 */
  readonly name: string;
  /** アプリ用の利用者（API と同じ権限）で接続した PrismaService */
  readonly prisma: PrismaService;
  /** アプリ用の利用者の接続文字列 */
  readonly appUrl: string;
  /** テーブルの所有者（マイグレーション用の利用者）の接続文字列。権限やトリガーの確認に使う */
  readonly ownerUrl: string;
  /** 接続を閉じて、データベースを削除する（何度呼んでもよい） */
  drop(): Promise<void>;
}

/** マイグレーションを適用した空のデータベースを新しく作る */
export async function createTestDatabase(): Promise<TestDatabase> {
  const run = inject('testDatabaseRun');
  const config = loadConfig({ appEnv: 'test' });
  const maintenanceUrl = requireMigrationDatabaseUrl(config);
  const name = `${run.prefix}${randomBytes(5).toString('hex')}`;

  await createDatabase(maintenanceUrl, name, run.template);
  const appUrl = withDatabaseName(config.databaseUrl, name);
  const prisma = new PrismaService(appUrl);
  let dropped: Promise<void> | undefined;
  return {
    name,
    prisma,
    appUrl,
    ownerUrl: withDatabaseName(maintenanceUrl, name),
    drop() {
      dropped ??= (async () => {
        await prisma.$disconnect();
        await dropDatabases(maintenanceUrl, [name]);
      })();
      return dropped;
    },
  };
}
