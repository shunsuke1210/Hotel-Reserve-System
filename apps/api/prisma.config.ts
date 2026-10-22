// Prisma の CLI（prisma generate・prisma migrate など）の設定。apps/api で実行する。
//
// 接続先は API と同じ loadConfig で、リポジトリの最上位の .env などから読む（APP_ENV で環境を選ぶ）。
// CLI はテーブルの所有者（マイグレーション用の利用者：MIGRATION_DATABASE_URL、test では TEST_MIGRATION_DATABASE_URL）で接続する。
// 開発用のデータベースへの適用は、アプリ用の利用者の準備も行う pnpm db:migrate を使う（prisma/scripts/migrate.ts）。
//
// prisma generate などデータベースに接続しないコマンドは、設定ファイルがなくても動くようにする（pnpm install の直後など）。
import { defineConfig } from 'prisma/config';
import {
  ConfigError,
  loadConfig,
  requireMigrationDatabaseUrl,
} from './src/shared/config/app-config.js';

const COMMANDS_WITHOUT_DATABASE = new Set(['generate', 'validate', 'format', 'version']);

function migrationDatabaseUrl(): string | undefined {
  try {
    return requireMigrationDatabaseUrl(loadConfig());
  } catch (error) {
    const command = process.argv.slice(2).find((arg) => !arg.startsWith('-'));
    if (error instanceof ConfigError && COMMANDS_WITHOUT_DATABASE.has(command ?? '')) {
      return undefined;
    }
    throw error;
  }
}

const url = migrationDatabaseUrl();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  ...(url === undefined ? {} : { datasource: { url } }),
});
