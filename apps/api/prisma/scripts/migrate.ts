// pnpm db:migrate：データベースにマイグレーションを適用し、アプリ用の利用者を用意する（tasks.md 1.4）。
//
//   pnpm db:migrate                    開発用のデータベース（APP_ENV の既定は development）
//   APP_ENV=production pnpm db:migrate  本番（.env.production か環境変数の接続先）
//
// 1. テーブルの所有者（MIGRATION_DATABASE_URL）で、未適用のマイグレーションを適用する（prisma migrate deploy）
// 2. API が使う利用者（DATABASE_URL の利用者とパスワード）を作り（あればパスワードを合わせ）、権限のロール hotel_app に加える
// 結合テスト用のデータベースは、結合テストが毎回作るので、このスクリプトは使わない。
import {
  ConfigError,
  describeDatabaseTarget,
  loadConfig,
  requireMigrationDatabaseUrl,
} from '../../src/shared/config/app-config.js';
import { ensureAppDatabaseUser, migrateDeploy } from './database-admin.js';

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.appEnv === 'test') {
    throw new Error('結合テスト用のデータベースは結合テストが準備します（pnpm test:integration）');
  }
  const ownerUrl = requireMigrationDatabaseUrl(config);
  const target = describeDatabaseTarget(ownerUrl);

  console.log(`マイグレーションを適用します（${config.appEnv}：${target}）`);
  await migrateDeploy({ appEnv: config.appEnv, ownerUrl, appUrl: config.databaseUrl });
  await ensureAppDatabaseUser(ownerUrl, config.databaseUrl);
  console.log(
    `完了しました。API は利用者 ${decodeURIComponent(new URL(config.databaseUrl).username)} で接続します`,
  );
}

main().catch((error: unknown) => {
  // 設定の誤りは文言だけを示す（値は含まれない）
  console.error(error instanceof ConfigError ? error.message : error);
  process.exitCode = 1;
});
