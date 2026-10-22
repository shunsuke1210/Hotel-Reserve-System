// 結合テストの実行のはじめに1回だけ行う準備（vitest.integration.config.mts の globalSetup）。
//
// 1. 前の実行が残したデータベース（1時間より前のもの）を削除する
// 2. テスト用のサーバーに、この実行のひな形のデータベースを作り、マイグレーションを適用する（prisma migrate deploy）
// 3. アプリ用の利用者（TEST_DATABASE_URL の利用者）を用意する
// 実行の終わりに、この実行で作ったデータベースをすべて削除する。
//
// データベースの名前は「{TEST_MIGRATION_DATABASE_URL のデータベース名}_r{実行の開始時刻（36進）}_…」。
// 同時に2つの実行があっても、名前が違うので互いのデータベースを消さない。
import type { TestProject } from 'vitest/node';
import {
  createDatabase,
  databaseNameOf,
  dropDatabases,
  ensureAppDatabaseUser,
  listDatabases,
  migrateDeploy,
  withDatabaseName,
} from '../../../prisma/scripts/database-admin.js';
import { loadConfig, requireMigrationDatabaseUrl } from '../../shared/config/app-config.js';
import type { TestDatabaseRun } from './test-database.js';

/** これより前に始まった実行のデータベースは、残っていれば削除する */
const STALE_AFTER_MS = 60 * 60 * 1000;

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const config = loadConfig({ appEnv: 'test' });
  const maintenanceUrl = requireMigrationDatabaseUrl(config);
  const base = `${databaseNameOf(maintenanceUrl)}_r`;
  const startedAt = Date.now();
  const prefix = `${base}${startedAt.toString(36)}_`;
  const run: TestDatabaseRun = { template: `${prefix}template`, prefix };

  await dropDatabases(maintenanceUrl, await staleDatabases(maintenanceUrl, base, startedAt));

  await createDatabase(maintenanceUrl, run.template);
  try {
    await migrateDeploy({
      appEnv: 'test',
      ownerUrl: withDatabaseName(maintenanceUrl, run.template),
      appUrl: withDatabaseName(config.databaseUrl, run.template),
    });
    await ensureAppDatabaseUser(maintenanceUrl, config.databaseUrl);
  } catch (error) {
    await dropDatabases(maintenanceUrl, [run.template]);
    throw error;
  }

  project.provide('testDatabaseRun', run);
  return async () => {
    await dropDatabases(maintenanceUrl, await listDatabases(maintenanceUrl, prefix));
  };
}

async function staleDatabases(
  maintenanceUrl: string,
  base: string,
  now: number,
): Promise<string[]> {
  const names = await listDatabases(maintenanceUrl, base);
  return names.filter((name) => {
    const startedAt = Number.parseInt(name.slice(base.length).split('_')[0] ?? '', 36);
    return Number.isFinite(startedAt) && now - startedAt > STALE_AFTER_MS;
  });
}
