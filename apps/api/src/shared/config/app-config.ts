// 環境ごとの設定（データベースの接続先・秘密の値）を読み込んで検証する（tasks.md 1.2）。
//
// 読み込みの順序（後のものが優先）：
//   1. リポジトリの最上位の .env            （開発用の値。.env.example をコピーして作る。Git に入れない）
//   2. リポジトリの最上位の .env.{APP_ENV}  （その環境だけの値。例：.env.test・.env.production）
//   3. 環境変数                              （本番のコンテナなど。空の値は無視する）
// APP_ENV（development・test・production）は読むファイルを決めるので、環境変数（または引数）だけで指定する。
//
// 誤りは起動の時点で ConfigError として止める。文言には項目名と理由だけを書き、値（パスワードなど）は出さない。
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

  const value = (key: string): string | undefined =>
    nonEmpty(processEnv[key]) ?? nonEmpty(fileValues[key]);
  const result = envSchema(appEnv).safeParse({
    DATABASE_URL: value('DATABASE_URL'),
    TEST_DATABASE_URL: value('TEST_DATABASE_URL'),
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
  return { appEnv, databaseUrl, loadedFiles };
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
 */
function envSchema(appEnv: AppEnv) {
  return z
    .object({
      DATABASE_URL: appEnv === 'test' ? postgresUrl.optional() : postgresUrl,
      TEST_DATABASE_URL: appEnv === 'test' ? postgresUrl : postgresUrl.optional(),
    })
    .superRefine((env, ctx) => {
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
