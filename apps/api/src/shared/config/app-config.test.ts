import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  APP_ENVS,
  ConfigError,
  describeDatabaseTarget,
  findEnvDir,
  loadConfig,
  requireMigrationDatabaseUrl,
  type LoadConfigOptions,
} from './app-config.js';

/** エラーの文言に出てはいけない秘密の値（パスワード） */
const SECRET = 'S3cr3t-Pa55word';

const DEV_URL = `postgresql://hotel:${SECRET}@127.0.0.1:5432/hotel`;
const TEST_URL = `postgresql://hotel:${SECRET}@127.0.0.1:5433/hotel_test`;
const PROD_URL = `postgresql://hotel_app:${SECRET}@db.internal:5432/hotel`;
/** マイグレーション用（テーブルの所有者）の接続先。アプリ用とは利用者だけが違う */
const DEV_MIGRATION_URL = `postgresql://owner:${SECRET}@127.0.0.1:5432/hotel`;
const TEST_MIGRATION_URL = `postgresql://owner:${SECRET}@127.0.0.1:5433/hotel_test`;

let envDir: string;

beforeEach(() => {
  envDir = mkdtempSync(join(tmpdir(), 'hotel-config-'));
});
afterEach(() => {
  rmSync(envDir, { recursive: true, force: true });
});

function writeEnvFile(name: string, lines: string[]): void {
  writeFileSync(join(envDir, name), `${lines.join('\n')}\n`);
}

/** 設定の読み込みが失敗することを確かめ、そのエラーを返す */
function expectConfigError(options: LoadConfigOptions): ConfigError {
  let caught: unknown;
  try {
    loadConfig(options);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ConfigError);
  const error = caught as ConfigError;
  // 文言・項目の一覧・スタックのどこにも秘密の値を出さない
  expect(error.message).not.toContain(SECRET);
  expect(String(error.stack)).not.toContain(SECRET);
  expect(JSON.stringify(error.problems)).not.toContain(SECRET);
  return error;
}

/** 関数が ConfigError を投げることを確かめ、そのエラーを返す */
function catchConfigError(run: () => unknown): ConfigError {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ConfigError);
  expect((caught as ConfigError).message).not.toContain(SECRET);
  return caught as ConfigError;
}

describe('loadConfig（環境ごとの設定ファイルから接続先と秘密の値を読み込む）', () => {
  describe('環境ごとの設定ファイルの選択', () => {
    beforeEach(() => {
      writeEnvFile('.env', [
        '# 開発用の値',
        `DATABASE_URL=${DEV_URL}`,
        `TEST_DATABASE_URL=${TEST_URL}`,
      ]);
      writeEnvFile('.env.test', [`TEST_DATABASE_URL=${TEST_URL}_ci`]);
      writeEnvFile('.env.production', [`DATABASE_URL=${PROD_URL}`]);
    });

    it('development では .env の DATABASE_URL（開発用のデータベース）を使う', () => {
      const config = loadConfig({ envDir, appEnv: 'development', processEnv: {} });
      expect(config).toEqual({
        appEnv: 'development',
        databaseUrl: DEV_URL,
        loadedFiles: ['.env'],
      });
    });

    it('test では .env.test が .env より優先され、TEST_DATABASE_URL（結合テスト用のデータベース）を使う', () => {
      const config = loadConfig({ envDir, appEnv: 'test', processEnv: {} });
      expect(config).toEqual({
        appEnv: 'test',
        databaseUrl: `${TEST_URL}_ci`,
        loadedFiles: ['.env', '.env.test'],
      });
    });

    it('production では .env.production の値を使い、ほかの環境のファイルは読まない', () => {
      const config = loadConfig({ envDir, appEnv: 'production', processEnv: {} });
      expect(config.databaseUrl).toBe(PROD_URL);
      expect(config.loadedFiles).toEqual(['.env', '.env.production']);
    });

    it('環境は APP_ENV で選び、指定がなければ development になる', () => {
      expect(loadConfig({ envDir, processEnv: { APP_ENV: 'test' } }).appEnv).toBe('test');
      expect(loadConfig({ envDir, processEnv: {} }).appEnv).toBe('development');
      expect(APP_ENVS).toEqual(['development', 'test', 'production']);
    });

    it('環境変数はファイルより優先される（空の環境変数は無視する）', () => {
      const override = 'postgresql://hotel:other@127.0.0.1:6543/hotel_override';
      expect(
        loadConfig({ envDir, appEnv: 'development', processEnv: { DATABASE_URL: override } })
          .databaseUrl,
      ).toBe(override);
      expect(
        loadConfig({ envDir, appEnv: 'development', processEnv: { DATABASE_URL: '  ' } })
          .databaseUrl,
      ).toBe(DEV_URL);
    });

    it('設定ファイルがなくても、環境変数だけで設定できる（本番のコンテナなど）', () => {
      const emptyDir = join(envDir, 'empty');
      mkdirSync(emptyDir);
      const config = loadConfig({
        envDir: emptyDir,
        appEnv: 'production',
        processEnv: { DATABASE_URL: PROD_URL },
      });
      expect(config).toEqual({ appEnv: 'production', databaseUrl: PROD_URL, loadedFiles: [] });
    });

    it('Windows のエディタが付ける BOM があっても、最初の項目を読み取れる', () => {
      const bom = String.fromCharCode(0xfeff);
      writeFileSync(join(envDir, '.env'), `${bom}DATABASE_URL=${DEV_URL}\n`);
      expect(loadConfig({ envDir, appEnv: 'development', processEnv: {} }).databaseUrl).toBe(
        DEV_URL,
      );
    });
  });

  describe('値の検証（足りない・誤った値は起動の時点で止め、秘密の値を文言に出さない）', () => {
    it('development で DATABASE_URL がなければ、項目名とひな形（.env.example）を示して失敗する', () => {
      const error = expectConfigError({ envDir, appEnv: 'development', processEnv: {} });
      expect(error.problems).toEqual([{ key: 'DATABASE_URL', message: '設定されていません' }]);
      expect(error.message).toContain('DATABASE_URL');
      expect(error.message).toContain('.env.example');
    });

    it('test で TEST_DATABASE_URL がなければ失敗する', () => {
      writeEnvFile('.env', [`DATABASE_URL=${DEV_URL}`]);
      const error = expectConfigError({ envDir, appEnv: 'test', processEnv: {} });
      expect(error.problems.map((p) => p.key)).toEqual(['TEST_DATABASE_URL']);
    });

    it.each([
      ['PostgreSQL 以外の接続文字列', `mysql://hotel:${SECRET}@127.0.0.1:3306/hotel`],
      ['URL として解釈できない値', `${SECRET}@127.0.0.1/hotel`],
      ['データベース名がない接続文字列', `postgresql://hotel:${SECRET}@127.0.0.1:5432`],
      ['ホスト名がない接続文字列', `postgresql:///hotel?password=${SECRET}`],
    ])('%s は受け付けない', (_label, value) => {
      const error = expectConfigError({
        envDir,
        appEnv: 'development',
        processEnv: { DATABASE_URL: value },
      });
      expect(error.problems.map((p) => p.key)).toEqual(['DATABASE_URL']);
    });

    it('TEST_DATABASE_URL が開発用と同じデータベースを指していれば失敗する（結合テストが開発用のデータを消さないように）', () => {
      const error = expectConfigError({
        envDir,
        appEnv: 'test',
        processEnv: {
          DATABASE_URL: DEV_URL,
          // ホスト名の書き方や利用者が違っても、同じサーバーの同じデータベースなら同じとみなす
          TEST_DATABASE_URL: `postgres://tester:${SECRET}x@LOCALHOST/hotel`,
        },
      });
      expect(error.problems).toHaveLength(1);
      expect(error.problems[0]?.key).toBe('TEST_DATABASE_URL');
      expect(error.problems[0]?.message).toContain('別のデータベース');
    });

    it('development でも、TEST_DATABASE_URL を書いたなら同じ規則で確かめる', () => {
      const error = expectConfigError({
        envDir,
        appEnv: 'development',
        processEnv: { DATABASE_URL: DEV_URL, TEST_DATABASE_URL: DEV_URL },
      });
      expect(error.problems.map((p) => p.key)).toEqual(['TEST_DATABASE_URL']);
    });

    it('誤りが複数あれば、まとめて示す', () => {
      const error = expectConfigError({
        envDir,
        appEnv: 'development',
        processEnv: { DATABASE_URL: `mysql://x:${SECRET}@h/db`, TEST_DATABASE_URL: 'nope' },
      });
      expect(error.problems.map((p) => p.key)).toEqual(['DATABASE_URL', 'TEST_DATABASE_URL']);
    });

    it('APP_ENV が想定外の値なら失敗する', () => {
      const error = expectConfigError({ envDir, processEnv: { APP_ENV: 'staging' } });
      expect(error.problems.map((p) => p.key)).toEqual(['APP_ENV']);
      expect(error.problems[0]?.message).toContain('development・test・production');
    });
  });
});

describe('マイグレーション用の接続先（テーブルの所有者。アプリ用の利用者と分ける。18.2）', () => {
  it('development では MIGRATION_DATABASE_URL、test では TEST_MIGRATION_DATABASE_URL を使う', () => {
    writeEnvFile('.env', [
      `DATABASE_URL=${DEV_URL}`,
      `MIGRATION_DATABASE_URL=${DEV_MIGRATION_URL}`,
      `TEST_DATABASE_URL=${TEST_URL}`,
      `TEST_MIGRATION_DATABASE_URL=${TEST_MIGRATION_URL}`,
    ]);
    const development = loadConfig({ envDir, appEnv: 'development', processEnv: {} });
    expect(development.migrationDatabaseUrl).toBe(DEV_MIGRATION_URL);
    expect(requireMigrationDatabaseUrl(development)).toBe(DEV_MIGRATION_URL);
    const test = loadConfig({ envDir, appEnv: 'test', processEnv: {} });
    expect(test.migrationDatabaseUrl).toBe(TEST_MIGRATION_URL);
    expect(requireMigrationDatabaseUrl(test)).toBe(TEST_MIGRATION_URL);
  });

  it('API の実行には要らないので省略できるが、マイグレーションで使うときは項目名を示して失敗する', () => {
    writeEnvFile('.env', [`DATABASE_URL=${DEV_URL}`, `TEST_DATABASE_URL=${TEST_URL}`]);
    const development = loadConfig({ envDir, appEnv: 'development', processEnv: {} });
    expect(development.migrationDatabaseUrl).toBeUndefined();
    const devError = catchConfigError(() => requireMigrationDatabaseUrl(development));
    expect(devError.problems.map((p) => p.key)).toEqual(['MIGRATION_DATABASE_URL']);
    expect(devError.message).toContain('.env.example');

    const test = loadConfig({ envDir, appEnv: 'test', processEnv: {} });
    const testError = catchConfigError(() => requireMigrationDatabaseUrl(test));
    expect(testError.problems.map((p) => p.key)).toEqual(['TEST_MIGRATION_DATABASE_URL']);
  });

  it('アプリ用と別のデータベースを指していれば失敗する（違うデータベースにマイグレーションしないように）', () => {
    const error = expectConfigError({
      envDir,
      appEnv: 'development',
      processEnv: {
        DATABASE_URL: DEV_URL,
        MIGRATION_DATABASE_URL: `postgresql://owner:${SECRET}@127.0.0.1:5432/other`,
      },
    });
    expect(error.problems.map((p) => p.key)).toEqual(['MIGRATION_DATABASE_URL']);
    expect(error.problems[0]?.message).toContain('DATABASE_URL と同じデータベース');

    const testError = expectConfigError({
      envDir,
      appEnv: 'test',
      processEnv: { TEST_DATABASE_URL: TEST_URL, TEST_MIGRATION_DATABASE_URL: DEV_MIGRATION_URL },
    });
    expect(testError.problems.map((p) => p.key)).toEqual(['TEST_MIGRATION_DATABASE_URL']);
  });

  it('アプリ用と同じ利用者なら失敗する（アプリの利用者から操作履歴の変更・削除の権限を外すため）', () => {
    const error = expectConfigError({
      envDir,
      appEnv: 'development',
      processEnv: { DATABASE_URL: DEV_URL, MIGRATION_DATABASE_URL: DEV_URL },
    });
    expect(error.problems.map((p) => p.key)).toEqual(['MIGRATION_DATABASE_URL']);
    expect(error.problems[0]?.message).toContain('別の利用者');

    const testError = expectConfigError({
      envDir,
      appEnv: 'test',
      processEnv: { TEST_DATABASE_URL: TEST_URL, TEST_MIGRATION_DATABASE_URL: TEST_URL },
    });
    expect(testError.problems.map((p) => p.key)).toEqual(['TEST_MIGRATION_DATABASE_URL']);
  });

  it('PostgreSQL の接続文字列でなければ失敗する', () => {
    const error = expectConfigError({
      envDir,
      appEnv: 'development',
      processEnv: { DATABASE_URL: DEV_URL, MIGRATION_DATABASE_URL: `mysql://o:${SECRET}@h/hotel` },
    });
    expect(error.problems.map((p) => p.key)).toEqual(['MIGRATION_DATABASE_URL']);
  });
});

describe('describeDatabaseTarget（ログやエラーの文言に使う、秘密の値を含まない接続先の表記）', () => {
  it('ホスト・ポート・データベース名だけを返し、利用者名とパスワードを含めない', () => {
    expect(describeDatabaseTarget(DEV_URL)).toBe('127.0.0.1:5432/hotel');
    expect(describeDatabaseTarget(`postgresql://hotel:${SECRET}@db.internal/hotel`)).toBe(
      'db.internal:5432/hotel',
    );
  });
});

describe('findEnvDir（設定ファイルを置く場所＝リポジトリの最上位を探す）', () => {
  it('pnpm-workspace.yaml のあるディレクトリまで上にたどる', () => {
    writeFileSync(join(envDir, 'pnpm-workspace.yaml'), 'packages: []\n');
    const nested = join(envDir, 'apps', 'api');
    mkdirSync(nested, { recursive: true });
    expect(findEnvDir(nested)).toBe(envDir);
    expect(findEnvDir(envDir)).toBe(envDir);
  });

  it('見つからなければ、開始したディレクトリを使う', () => {
    const nested = join(envDir, 'srv', 'app');
    mkdirSync(nested, { recursive: true });
    expect(findEnvDir(nested)).toBe(nested);
  });
});

describe('ひな形の .env.example と docker-compose.yml', () => {
  const rootDir = findEnvDir(process.cwd());
  let template: string;
  let values: Record<string, string | undefined>;

  beforeAll(() => {
    template = readFileSync(join(rootDir, '.env.example'), 'utf8');
    values = parseEnv(template);
  });

  it('.env.example をそのまま .env にすれば、開発用とテスト用の設定を読み込め、別々のデータベースを指す', () => {
    writeFileSync(join(envDir, '.env'), template);
    const development = loadConfig({ envDir, appEnv: 'development', processEnv: {} });
    const test = loadConfig({ envDir, appEnv: 'test', processEnv: {} });
    expect(describeDatabaseTarget(development.databaseUrl)).not.toBe(
      describeDatabaseTarget(test.databaseUrl),
    );
    expect(requireMigrationDatabaseUrl(development)).toBeTruthy();
    expect(requireMigrationDatabaseUrl(test)).toBeTruthy();
  });

  it('マイグレーション用の接続先は docker-compose.yml に渡す利用者（テーブルの所有者）で、アプリ用はそれと別の利用者で同じデータベースを指す', () => {
    const dev = new URL(String(values.DATABASE_URL));
    const devMigration = new URL(String(values.MIGRATION_DATABASE_URL));
    const test = new URL(String(values.TEST_DATABASE_URL));
    const testMigration = new URL(String(values.TEST_MIGRATION_DATABASE_URL));
    for (const url of [devMigration, testMigration]) {
      expect(decodeURIComponent(url.username)).toBe(values.POSTGRES_USER);
      expect(decodeURIComponent(url.password)).toBe(values.POSTGRES_PASSWORD);
    }
    for (const url of [dev, test]) {
      expect(decodeURIComponent(url.username)).not.toBe(values.POSTGRES_USER);
    }
    // アプリ用の利用者とパスワードは、開発用とテスト用で同じ（pnpm db:migrate と結合テストが、この値で利用者を作る）
    expect(test.username).toBe(dev.username);
    expect(test.password).toBe(dev.password);
    for (const [app, migration] of [
      [dev, devMigration],
      [test, testMigration],
    ] as const) {
      expect(`${app.host}${app.pathname}`).toBe(`${migration.host}${migration.pathname}`);
    }
    expect(dev.port).toBe(values.POSTGRES_PORT);
    expect(dev.pathname).toBe(`/${values.POSTGRES_DB}`);
    expect(test.port).toBe(values.POSTGRES_TEST_PORT);
    expect(test.pathname).toBe(`/${values.POSTGRES_TEST_DB}`);
  });

  it('docker-compose.yml が既定値なしで参照する変数は、すべて .env.example にある', () => {
    const compose = readFileSync(join(rootDir, 'docker-compose.yml'), 'utf8');
    // ${NAME}・${NAME:?文言} は .env.example に必要。${NAME:-既定値} は不要。$${NAME} はコンテナの中の変数
    const referenced = [...compose.matchAll(/(?<!\$)\$\{([A-Z0-9_]+)(?:(:?-)[^}]*|:?\?[^}]*)?\}/g)]
      .filter((match) => match[2] === undefined)
      .map((match) => match[1]);
    expect(referenced.length).toBeGreaterThan(0);
    for (const name of referenced) {
      expect(values, `${name} が .env.example にありません`).toHaveProperty(String(name));
    }
  });
});
