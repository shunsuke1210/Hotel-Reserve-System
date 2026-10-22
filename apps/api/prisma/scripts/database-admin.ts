// データベースの管理の操作（マイグレーションの適用・アプリ用の利用者の準備・スキーマの差の確認・データベースの作成と削除）。
// pnpm db:migrate（migrate.ts）と、結合テストの準備（src/test/database）で使う。API の実行時には使わない。
//
// いずれもテーブルの所有者（マイグレーション用の利用者）の接続先で行う。
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import { describeDatabaseTarget, type AppEnv } from '../../src/shared/config/app-config.js';

const execFileAsync = promisify(execFile);

/** apps/api（prisma.config.ts のある場所。Prisma の CLI はここで実行する） */
export const API_DIR = resolve(__dirname, '..', '..');

/** アプリの権限をまとめたロール（マイグレーションが作り、テーブルの権限を与える） */
export const APP_PRIVILEGE_ROLE = 'hotel_app';

/** マイグレーションの対象 */
export interface MigrationTarget {
  /** prisma.config.ts が読む環境（APP_ENV） */
  appEnv: AppEnv;
  /** テーブルの所有者（マイグレーション用の利用者）の接続先 */
  ownerUrl: string;
  /** アプリ用の利用者の接続先（同じデータベース） */
  appUrl: string;
}

/** node-postgres で接続する（接続できなければ、パスワードを含まない接続先を示して失敗する） */
export async function connectPg(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
  } catch (error) {
    await client.end().catch(() => undefined);
    throw new Error(`データベース（${describeDatabaseTarget(url)}）に接続できません`, {
      cause: error,
    });
  }
  return client;
}

/** 接続文字列のデータベース名だけを差し替える */
export function withDatabaseName(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${encodeURIComponent(database)}`;
  return parsed.toString();
}

/** 接続文字列のデータベース名 */
export function databaseNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

/** 未適用のマイグレーションを適用する（prisma migrate deploy） */
export async function migrateDeploy(target: MigrationTarget): Promise<void> {
  await runPrisma(['migrate', 'deploy'], target);
}

/**
 * schema.prisma と、データベースの今のスキーマ（マイグレーションの結果）を比べる（prisma migrate diff）。
 * マイグレーションの SQL を手で直したときに、schema.prisma との食い違いがないことを確かめる。
 */
export async function checkSchemaDrift(
  target: Omit<MigrationTarget, 'appEnv'> & { appEnv?: AppEnv },
): Promise<{ hasDrift: boolean; summary: string }> {
  const args = [
    'migrate',
    'diff',
    '--from-config-datasource',
    '--to-schema',
    'prisma/schema.prisma',
    '--exit-code',
  ];
  try {
    const { stdout } = await runPrisma(args, { appEnv: 'test', ...target });
    return { hasDrift: false, summary: stdout.trim() };
  } catch (error) {
    // --exit-code：差がなければ 0、差があれば 2、失敗なら 1
    if (isExecError(error) && error.code === 2) {
      return { hasDrift: true, summary: String(error.stdout).trim() };
    }
    throw error;
  }
}

/**
 * アプリ用の利用者（接続文字列の利用者とパスワード）を用意する。なければ作り、あればパスワードを合わせる。
 * 権限は、マイグレーションが作るロール hotel_app のメンバーにして与える（先にマイグレーションを適用しておく）。
 * ロールはサーバー全体で共有されるので、同じサーバーの別のデータベースにも使える。
 */
export async function ensureAppDatabaseUser(ownerUrl: string, appUrl: string): Promise<void> {
  const parsed = new URL(appUrl);
  const user = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  if (user === '' || password === '') {
    throw new Error('アプリ用の接続文字列に、利用者名とパスワードを書いてください');
  }

  const owner = await connectPg(ownerUrl);
  try {
    const { rows: me } = await owner.query<{ name: string }>('SELECT current_user AS name');
    if (me[0]?.name === user) {
      throw new Error(
        'アプリ用の利用者が、テーブルの所有者（マイグレーション用の利用者）と同じです',
      );
    }
    const role = owner.escapeIdentifier(user);
    const secret = owner.escapeLiteral(password);
    const existing = await owner.query<{ superuser: boolean }>(
      'SELECT rolsuper AS superuser FROM pg_roles WHERE rolname = $1',
      [user],
    );
    if (existing.rows[0]?.superuser) {
      throw new Error('アプリ用の利用者がスーパーユーザーです。権限のない利用者にしてください');
    }
    if (existing.rows.length === 0) {
      try {
        await owner.query(`CREATE ROLE ${role} LOGIN PASSWORD ${secret}`);
      } catch (error) {
        // 同時に作られた場合（duplicate_object）は、次のパスワードの設定に進む
        if (!isRecord(error) || error.code !== '42710') throw error;
      }
    }
    await owner.query(`ALTER ROLE ${role} LOGIN PASSWORD ${secret}`);
    await owner.query(`GRANT ${owner.escapeIdentifier(APP_PRIVILEGE_ROLE)} TO ${role}`);
  } finally {
    await owner.end();
  }
}

/** データベースを作る（template を指定すれば、その複製を作る） */
export async function createDatabase(
  maintenanceUrl: string,
  name: string,
  template?: string,
): Promise<void> {
  const client = await connectPg(maintenanceUrl);
  try {
    const statement =
      `CREATE DATABASE ${client.escapeIdentifier(name)}` +
      (template === undefined ? '' : ` TEMPLATE ${client.escapeIdentifier(template)}`);
    // 複製のもとに一時的に接続が残っている（object_in_use）場合は、少し待ってやり直す
    for (let attempt = 1; ; attempt++) {
      try {
        await client.query(statement);
        return;
      } catch (error) {
        if (!isRecord(error) || error.code !== '55006' || attempt >= 10) throw error;
        await new Promise((done) => setTimeout(done, 100 * attempt));
      }
    }
  } finally {
    await client.end();
  }
}

/** データベースを削除する（接続が残っていても切って削除する。なければ何もしない） */
export async function dropDatabases(
  maintenanceUrl: string,
  names: readonly string[],
): Promise<void> {
  if (names.length === 0) return;
  const client = await connectPg(maintenanceUrl);
  try {
    for (const name of names) {
      await client.query(`DROP DATABASE IF EXISTS ${client.escapeIdentifier(name)} WITH (FORCE)`);
    }
  } finally {
    await client.end();
  }
}

/** 名前が prefix で始まるデータベースの一覧 */
export async function listDatabases(maintenanceUrl: string, prefix: string): Promise<string[]> {
  const client = await connectPg(maintenanceUrl);
  try {
    const { rows } = await client.query<{ name: string }>(
      `SELECT datname AS name FROM pg_database WHERE starts_with(datname, $1) ORDER BY datname`,
      [prefix],
    );
    return rows.map((row) => row.name);
  } finally {
    await client.end();
  }
}

/** Prisma の CLI を apps/api で実行する。接続先は prisma.config.ts が環境変数（loadConfig）から読む */
async function runPrisma(
  args: string[],
  target: MigrationTarget,
): Promise<{ stdout: string; stderr: string }> {
  const [appKey, migrationKey] =
    target.appEnv === 'test'
      ? ['TEST_DATABASE_URL', 'TEST_MIGRATION_DATABASE_URL']
      : ['DATABASE_URL', 'MIGRATION_DATABASE_URL'];
  try {
    return await execFileAsync(process.execPath, [prismaCliPath(), ...args], {
      cwd: API_DIR,
      env: {
        ...process.env,
        APP_ENV: target.appEnv,
        [appKey]: target.appUrl,
        [migrationKey]: target.ownerUrl,
        PRISMA_HIDE_UPDATE_MESSAGE: '1',
      },
      windowsHide: true,
    });
  } catch (error) {
    if (isExecError(error) && error.code !== 2) {
      // 出力に接続文字列は含まれない（Prisma はホスト・ポート・データベース名だけを示す）
      throw new Error(
        `prisma ${args.join(' ')} が失敗しました（${describeDatabaseTarget(target.ownerUrl)}）\n${String(error.stdout)}${String(error.stderr)}`,
        { cause: error },
      );
    }
    throw error;
  }
}

function prismaCliPath(): string {
  return createRequire(resolve(API_DIR, 'package.json')).resolve('prisma/build/index.js');
}

interface ExecError {
  code: number | string;
  stdout: unknown;
  stderr: unknown;
}

function isExecError(error: unknown): error is ExecError {
  return isRecord(error) && 'stdout' in error && 'code' in error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
