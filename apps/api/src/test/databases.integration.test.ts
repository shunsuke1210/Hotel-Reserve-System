// 開発用とテスト用のデータベースに、設定ファイル（.env など）の接続先で接続できることを確かめる（tasks.md 1.2）。
// データベースが必要なので pnpm check では実行しない。リポジトリの最上位で
//   pnpm db:up            （開発用とテスト用のデータベースを起動する）
//   pnpm db:migrate       （開発用のデータベースにマイグレーションを適用し、アプリ用の利用者を作る）
//   pnpm test:integration （結合テストを実行する。テスト用のデータベースの準備は結合テストが行う）
// の順に実行する。
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  describeDatabaseTarget,
  loadConfig,
  requireMigrationDatabaseUrl,
} from '../shared/config/app-config.js';

interface ServerInfo {
  database: string;
  majorVersion: number;
}

async function connect(url: string, label: string, hint = 'pnpm db:up'): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
  } catch (error) {
    await client.end().catch(() => undefined);
    // 接続先はホスト・ポート・データベース名だけを示す（パスワードを出さない）
    throw new Error(
      `${label}（${describeDatabaseTarget(url)}）に接続できません。リポジトリの最上位で ${hint} を実行してください`,
      { cause: error },
    );
  }
  return client;
}

async function serverInfo(client: pg.Client): Promise<ServerInfo> {
  const { rows } = await client.query<{ database: string; version_num: string }>(
    `SELECT current_database() AS database, current_setting('server_version_num') AS version_num`,
  );
  const row = rows[0];
  if (!row) throw new Error('サーバーの情報を取得できませんでした');
  return { database: row.database, majorVersion: Math.floor(Number(row.version_num) / 10_000) };
}

async function tableExists(client: pg.Client, table: string): Promise<boolean> {
  const { rows } = await client.query<{ found: string | null }>(
    'SELECT to_regclass($1)::text AS found',
    [`public.${table}`],
  );
  return rows[0]?.found != null;
}

function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

describe('開発用とテスト用のデータベース（docker-compose.yml の postgres・postgres-test）', () => {
  // 設定ファイルの読み込みと検証は、API と同じ関数で行う
  const development = loadConfig({ appEnv: 'development' });
  const test = loadConfig({ appEnv: 'test' });
  let devClient: pg.Client | undefined;
  let testClient: pg.Client | undefined;
  /** テスト用のデータベースのテーブルの所有者（表を作る確認に使う。アプリ用の利用者は表を作れない） */
  let testOwnerClient: pg.Client | undefined;

  beforeAll(async () => {
    // アプリ用の利用者は pnpm db:migrate（開発用）と結合テストの準備（テスト用）が作る
    devClient = await connect(
      development.databaseUrl,
      '開発用のデータベース',
      'pnpm db:up と pnpm db:migrate',
    );
    testClient = await connect(test.databaseUrl, 'テスト用のデータベース');
    testOwnerClient = await connect(
      requireMigrationDatabaseUrl(test),
      'テスト用のデータベース（テーブルの所有者）',
    );
  });
  afterAll(async () => {
    await devClient?.end();
    await testClient?.end();
    await testOwnerClient?.end();
  });

  it('設定ファイルの DATABASE_URL で、開発用のデータベース（PostgreSQL 17）に接続できる', async () => {
    const info = await serverInfo(devClient!);
    expect(info).toEqual({ database: databaseName(development.databaseUrl), majorVersion: 17 });
  });

  it('設定ファイルの TEST_DATABASE_URL で、結合テスト用のデータベース（PostgreSQL 17）に接続できる', async () => {
    const info = await serverInfo(testClient!);
    expect(info).toEqual({ database: databaseName(test.databaseUrl), majorVersion: 17 });
  });

  it('開発用とテスト用は別のデータベースで、テスト用に作った表は開発用から見えない', async () => {
    expect(describeDatabaseTarget(test.databaseUrl)).not.toBe(
      describeDatabaseTarget(development.databaseUrl),
    );

    // 表の名前は毎回変える（ほかのテストと同時に動いてもぶつからない）。開発用のデータベースには書き込まない
    const table = `isolation_check_${randomUUID().replaceAll('-', '')}`;
    await testOwnerClient!.query(`CREATE TABLE ${table} (id integer)`);
    try {
      expect(await tableExists(testClient!, table)).toBe(true);
      expect(await tableExists(devClient!, table)).toBe(false);
    } finally {
      await testOwnerClient!.query(`DROP TABLE IF EXISTS ${table}`);
    }
  });
});
