// 環境ごとの設定（データベースの接続先・秘密の値）を読み込んで検証する（tasks.md 1.2）。
//
// 読み込みの順序（後のものが優先）：
//   1. リポジトリの最上位の .env            （開発用の値。.env.example をコピーして作る。Git に入れない）
//   2. リポジトリの最上位の .env.{APP_ENV}  （その環境だけの値。例：.env.test・.env.production）
//   3. 環境変数                              （本番のコンテナなど。空の値は無視する）
// APP_ENV（development・test・production）は読むファイルを決めるので、環境変数（または引数）だけで指定する。
//
// 誤りは起動の時点で ConfigError として止める。文言には項目名と理由だけを書き、値（パスワードなど）は出さない。
//
// データベースの利用者は2つに分ける（tasks.md 1.4、要件 18.2）：
//   - アプリ用（DATABASE_URL・TEST_DATABASE_URL）：API が使う。テーブルの所有者ではなく、操作履歴（audit_logs）の
//     UPDATE・DELETE の権限を持たない
//   - マイグレーション用（MIGRATION_DATABASE_URL・TEST_MIGRATION_DATABASE_URL）：テーブルの所有者。
//     マイグレーションと結合テストの準備（テスト用のデータベースの作成）だけに使い、API の実行には使わない
//
// メールのリンクの設定（GUEST_WEB_BASE_URL・UNSUBSCRIBE_TOKEN_SECRET）は loadMailLinkConfig で別に読む
// （modules/notifications が使う。tasks.md 3.4）。待ち受け口に読み込むモジュールの環境は currentAppEnv で決める。
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseEnv } from 'node:util';
import { z } from 'zod';

export const APP_ENVS = ['development', 'test', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export interface AppConfig {
  readonly appEnv: AppEnv;
  /**
   * この環境で使うデータベースの接続文字列。
   * test（結合テスト）では TEST_DATABASE_URL、それ以外では DATABASE_URL。
   * パスワードを含むので、ログやエラーの文言には describeDatabaseTarget で表したものを使う。
   */
  readonly databaseUrl: string;
  /**
   * この環境のマイグレーション用（テーブルの所有者）の接続文字列。未設定なら undefined。
   * test では TEST_MIGRATION_DATABASE_URL、それ以外では MIGRATION_DATABASE_URL。
   * API の実行には使わない。使うときは requireMigrationDatabaseUrl で取り出す。
   */
  readonly migrationDatabaseUrl: string | undefined;
  /** 読み込んだ設定ファイルの名前（存在したものだけ） */
  readonly loadedFiles: readonly string[];
}

export interface ConfigProblem {
  /** 設定の項目名（例：DATABASE_URL） */
  readonly key: string;
  /** 誤りの理由（値は含めない） */
  readonly message: string;
}

/** 設定の誤り。起動を止めるために投げる */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';

  constructor(
    readonly problems: readonly ConfigProblem[],
    context: { appEnv: string; loadedFiles: readonly string[] },
  ) {
    const files = context.loadedFiles.length > 0 ? context.loadedFiles.join(', ') : 'なし';
    super(
      [
        `設定に誤りがあります（APP_ENV=${context.appEnv}、読み込んだ設定ファイル：${files}）`,
        ...problems.map((problem) => `- ${problem.key}：${problem.message}`),
        'リポジトリの最上位の .env.example を参考に、.env（環境ごとの値は .env.{APP_ENV}）か環境変数で設定してください',
      ].join('\n'),
    );
  }
}

export interface LoadConfigOptions {
  /** 環境（省略時は環境変数 APP_ENV、それもなければ development） */
  appEnv?: AppEnv;
  /** 設定ファイルを置くディレクトリ（省略時は findEnvDir(process.cwd())） */
  envDir?: string;
  /** 環境変数（省略時は process.env。テストで差し替える） */
  processEnv?: Readonly<Record<string, string | undefined>>;
}

/** 設定を読み込んで検証する。誤りがあれば ConfigError を投げる */
export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const { appEnv, loadedFiles, value } = readEnvSources(options);
  const result = envSchema(appEnv).safeParse({
    DATABASE_URL: value('DATABASE_URL'),
    TEST_DATABASE_URL: value('TEST_DATABASE_URL'),
    MIGRATION_DATABASE_URL: value('MIGRATION_DATABASE_URL'),
    TEST_MIGRATION_DATABASE_URL: value('TEST_MIGRATION_DATABASE_URL'),
  });
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => ({
        key: String(issue.path[0] ?? '(全体)'),
        message: issue.message,
      })),
      { appEnv, loadedFiles },
    );
  }

  const env = result.data;
  const databaseUrl = appEnv === 'test' ? env.TEST_DATABASE_URL : env.DATABASE_URL;
  // envSchema が、その環境で使う接続先を必須にしている
  if (databaseUrl === undefined) throw new Error('使うデータベースの接続先が決まりません');
  const migrationDatabaseUrl =
    appEnv === 'test' ? env.TEST_MIGRATION_DATABASE_URL : env.MIGRATION_DATABASE_URL;
  return { appEnv, databaseUrl, migrationDatabaseUrl, loadedFiles };
}

/** development・test で GUEST_WEB_BASE_URL を省略したときの、宿泊客アプリの URL（pnpm dev:guest のポート） */
export const DEFAULT_GUEST_WEB_BASE_URL = 'http://localhost:5173';

/** 配信停止のリンクの署名の鍵の最小の長さ（文字） */
export const MIN_UNSUBSCRIBE_TOKEN_SECRET_LENGTH = 32;

/** メールのリンクの設定（modules/notifications。tasks.md 3.4） */
export interface MailLinkConfig {
  readonly appEnv: AppEnv;
  /**
   * 宿泊客アプリの URL（確認・再設定・配信停止のリンクの基点。末尾の「/」なし）。GUEST_WEB_BASE_URL。
   * production では必須で https に限る。development・test で省略すると DEFAULT_GUEST_WEB_BASE_URL
   */
  readonly guestWebBaseUrl: string;
  /**
   * 定期配信メールの配信停止のリンクの署名の鍵（UNSUBSCRIBE_TOKEN_SECRET。32文字以上）。
   * production では必須。development・test で省略すると undefined（使う側がプロセスごとの乱数を使う）
   */
  readonly unsubscribeTokenSecret: string | undefined;
}

/**
 * メールのリンクの設定を読み込んで検証する（読み込みの順序は loadConfig と同じ）。誤りがあれば ConfigError を投げる。
 * データベースの接続先などは確かめない（それは loadConfig が確かめる）。
 */
export function loadMailLinkConfig(options: LoadConfigOptions = {}): MailLinkConfig {
  const { appEnv, loadedFiles, value } = readEnvSources(options);
  const production = appEnv === 'production';
  const result = z
    .object({
      GUEST_WEB_BASE_URL: production ? webBaseUrl(true) : webBaseUrl(false).optional(),
      UNSUBSCRIBE_TOKEN_SECRET: production ? signingSecret() : signingSecret().optional(),
    })
    .safeParse({
      GUEST_WEB_BASE_URL: value('GUEST_WEB_BASE_URL'),
      UNSUBSCRIBE_TOKEN_SECRET: value('UNSUBSCRIBE_TOKEN_SECRET'),
    });
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => ({
        key: String(issue.path[0] ?? '(全体)'),
        message: issue.message,
      })),
      { appEnv, loadedFiles },
    );
  }
  return {
    appEnv,
    guestWebBaseUrl: result.data.GUEST_WEB_BASE_URL ?? DEFAULT_GUEST_WEB_BASE_URL,
    unsubscribeTokenSecret: result.data.UNSUBSCRIBE_TOKEN_SECRET,
  };
}

/**
 * 今の環境（APP_ENV だけを読む。省略時は development）。設定ファイルは読まない（APP_ENV は環境変数だけで指定する）。
 * 待ち受け口に読み込むモジュール（開発用の機能）を決めるのに使う。想定外の値なら ConfigError を投げる。
 */
export function currentAppEnv(
  processEnv: Readonly<Record<string, string | undefined>> = process.env,
): AppEnv {
  return resolveAppEnv(nonEmpty(processEnv.APP_ENV));
}

interface EnvSources {
  appEnv: AppEnv;
  loadedFiles: string[];
  /** 項目の値（環境変数 → 設定ファイルの順。空の値は undefined） */
  value(key: string): string | undefined;
}

/** 環境を決め、その環境の設定ファイルと環境変数を読む */
function readEnvSources(options: LoadConfigOptions): EnvSources {
  const processEnv = options.processEnv ?? process.env;
  const appEnv = resolveAppEnv(options.appEnv ?? nonEmpty(processEnv.APP_ENV));
  const envDir = options.envDir ?? findEnvDir(process.cwd());

  const loadedFiles: string[] = [];
  const fileValues: Record<string, string> = {};
  for (const fileName of ['.env', `.env.${appEnv}`]) {
    const path = join(envDir, fileName);
    if (!existsSync(path)) continue;
    // Windows のエディタが付ける BOM を取り除く（最初の項目名に混ざらないように）
    Object.assign(fileValues, parseEnv(stripBom(readFileSync(path, 'utf8'))));
    loadedFiles.push(fileName);
  }
  return {
    appEnv,
    loadedFiles,
    value: (key) => nonEmpty(processEnv[key]) ?? nonEmpty(fileValues[key]),
  };
}

/** 宿泊客アプリの URL。値は文言に出さない。末尾の「/」を取り除いた形にする */
function webBaseUrl(requireHttps: boolean) {
  return z
    .string({ error: MISSING })
    .superRefine((url, ctx) => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        ctx.addIssue({
          code: 'custom',
          message: 'URL として解釈できません（例：https://hotel.example.com）',
        });
        return;
      }
      const protocols = requireHttps ? ['https:'] : ['http:', 'https:'];
      if (!protocols.includes(parsed.protocol)) {
        ctx.addIssue({
          code: 'custom',
          message: requireHttps
            ? 'https:// で始まる URL にしてください'
            : 'http:// または https:// で始まる URL にしてください',
        });
        return;
      }
      if (
        parsed.username !== '' ||
        parsed.password !== '' ||
        parsed.search !== '' ||
        parsed.hash !== ''
      ) {
        ctx.addIssue({
          code: 'custom',
          message: '利用者名・パスワード・クエリ（?）・ハッシュ（#）のない URL にしてください',
        });
      }
    })
    .transform((url) => url.replace(/\/+$/, ''));
}

/** 署名の鍵。値は文言に出さない */
function signingSecret() {
  return z.string({ error: MISSING }).min(MIN_UNSUBSCRIBE_TOKEN_SECRET_LENGTH, {
    error: `${MIN_UNSUBSCRIBE_TOKEN_SECRET_LENGTH}文字以上の推測できない値にしてください`,
  });
}

/**
 * マイグレーション用（テーブルの所有者）の接続先を取り出す。未設定なら ConfigError を投げる。
 * マイグレーション（pnpm db:migrate）と結合テストの準備で使う。
 */
export function requireMigrationDatabaseUrl(config: AppConfig): string {
  if (config.migrationDatabaseUrl !== undefined) return config.migrationDatabaseUrl;
  throw new ConfigError([{ key: migrationUrlKey(config.appEnv), message: MISSING }], config);
}

function migrationUrlKey(appEnv: AppEnv): string {
  return appEnv === 'test' ? 'TEST_MIGRATION_DATABASE_URL' : 'MIGRATION_DATABASE_URL';
}

/**
 * 設定ファイルを置く場所（リポジトリの最上位＝ pnpm-workspace.yaml のあるディレクトリ）を、
 * 開始したディレクトリから上にたどって探す。見つからなければ開始したディレクトリを返す。
 * pnpm --filter で apps/api から実行しても、最上位から実行しても、同じ .env を読むため。
 */
export function findEnvDir(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

/** 接続先を「ホスト:ポート/データベース名」で表す（利用者名とパスワードを含めない） */
export function describeDatabaseTarget(url: string): string {
  const target = parseDatabaseTarget(url);
  return target ? `${target.host}:${target.port}/${target.database}` : '(解釈できない接続先)';
}

const DEFAULT_POSTGRES_PORT = '5432';

interface DatabaseTarget {
  host: string;
  port: string;
  database: string;
}

function parseDatabaseTarget(url: string): DatabaseTarget | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // URL の解釈の誤りの文言には値がそのまま入るので、外に出さない
    return undefined;
  }
  return {
    host: parsed.hostname.toLowerCase(),
    port: parsed.port || DEFAULT_POSTGRES_PORT,
    database: safeDecode(parsed.pathname.replace(/^\//, '')),
  };
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** 同じサーバーの同じデータベースかどうか（localhost と 127.0.0.1 などのループバックは同じとみなす） */
function isSameDatabase(a: DatabaseTarget, b: DatabaseTarget): boolean {
  return (
    normalizeHost(a.host) === normalizeHost(b.host) &&
    a.port === b.port &&
    a.database === b.database
  );
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function normalizeHost(host: string): string {
  return LOOPBACK_HOSTS.has(host) ? 'localhost' : host;
}

/** PostgreSQL の接続文字列としての誤り（なければ undefined）。文言に値を含めない */
function postgresUrlProblem(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'URL として解釈できません（形式：postgresql://利用者:パスワード@ホスト:ポート/データベース名）';
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    return 'postgresql:// で始まる PostgreSQL の接続文字列にしてください';
  }
  if (parsed.hostname === '') return 'ホスト名がありません';
  if (parsed.pathname.replace(/^\//, '') === '') return 'データベース名がありません';
  return undefined;
}

const MISSING = '設定されていません';

const postgresUrl = z.string({ error: MISSING }).superRefine((url, ctx) => {
  const problem = postgresUrlProblem(url);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});

/**
 * 環境ごとに必須の項目を決める。
 * - development・production：API が使う DATABASE_URL が必須
 * - test：結合テストが使う TEST_DATABASE_URL が必須
 * TEST_DATABASE_URL は、書いてあればどの環境でも、DATABASE_URL と別のデータベースであることを確かめる
 * （結合テストはテスト用のデータベースを空にするので、開発用のデータを消さないように）。
 * マイグレーション用の接続先（省略できる）は、書いてあれば、対になるアプリ用と同じデータベースを、別の利用者で指すことを確かめる。
 */
function envSchema(appEnv: AppEnv) {
  return z
    .object({
      DATABASE_URL: appEnv === 'test' ? postgresUrl.optional() : postgresUrl,
      TEST_DATABASE_URL: appEnv === 'test' ? postgresUrl : postgresUrl.optional(),
      MIGRATION_DATABASE_URL: postgresUrl.optional(),
      TEST_MIGRATION_DATABASE_URL: postgresUrl.optional(),
    })
    .superRefine((env, ctx) => {
      for (const [appKey, migrationKey] of [
        ['DATABASE_URL', 'MIGRATION_DATABASE_URL'],
        ['TEST_DATABASE_URL', 'TEST_MIGRATION_DATABASE_URL'],
      ] as const) {
        const problem = migrationPairProblem(env[appKey], env[migrationKey], appKey);
        if (problem) ctx.addIssue({ code: 'custom', path: [migrationKey], message: problem });
      }
      if (env.DATABASE_URL === undefined || env.TEST_DATABASE_URL === undefined) return;
      const development = parseDatabaseTarget(env.DATABASE_URL);
      const test = parseDatabaseTarget(env.TEST_DATABASE_URL);
      if (development && test && isSameDatabase(development, test)) {
        ctx.addIssue({
          code: 'custom',
          path: ['TEST_DATABASE_URL'],
          message: `DATABASE_URL と同じデータベース（${describeDatabaseTarget(env.TEST_DATABASE_URL)}）を指しています。結合テスト用には、開発用とは別のデータベースを指定してください`,
        });
      }
    });
}

/** マイグレーション用の接続先が、対になるアプリ用と同じデータベースを別の利用者で指していなければ、その理由 */
function migrationPairProblem(
  appUrl: string | undefined,
  migrationUrl: string | undefined,
  appKey: string,
): string | undefined {
  if (appUrl === undefined || migrationUrl === undefined) return undefined;
  // 接続文字列としての誤りは、項目ごとの検証で示す（同じ項目に2つ目の誤りを重ねない）
  if (postgresUrlProblem(appUrl) || postgresUrlProblem(migrationUrl)) return undefined;
  const app = parseDatabaseTarget(appUrl);
  const migration = parseDatabaseTarget(migrationUrl);
  if (!app || !migration) return undefined;
  if (!isSameDatabase(app, migration)) {
    return `${appKey} と同じデータベースを指してください（いまは ${describeDatabaseTarget(migrationUrl)}）`;
  }
  if (databaseUser(appUrl) === databaseUser(migrationUrl)) {
    return `${appKey} とは別の利用者（テーブルの所有者）にしてください。アプリ用の利用者から操作履歴の変更・削除の権限を外すため`;
  }
  return undefined;
}

/** 接続文字列の利用者名 */
function databaseUser(url: string): string {
  return safeDecode(new URL(url).username);
}

function resolveAppEnv(raw: string | undefined): AppEnv {
  if (raw === undefined) return 'development';
  const result = z.enum(APP_ENVS).safeParse(raw);
  if (result.success) return result.data;
  throw new ConfigError(
    [{ key: 'APP_ENV', message: 'development・test・production のいずれかにしてください' }],
    { appEnv: '(不明)', loadedFiles: [] },
  );
}

/** 先頭の BOM（U+FEFF）を取り除く */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
