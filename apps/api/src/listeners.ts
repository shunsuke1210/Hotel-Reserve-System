// 公開用（GuestApp）と社内用（StaffApp）の2つの待ち受け口を、1つのプロセスで立てる（ADR-03）。
// 2つのアプリは別々のモジュール群を持ち、共通の仕組み（URL の接頭辞・要求のログ・エラーの変換）は
// configureListener でそろえる。テストも同じ関数で設定する。
import {
  ConsoleLogger,
  type DynamicModule,
  type INestApplication,
  type LoggerService,
  type LogLevel,
  type Type,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { GuestAppModule } from './guest-app.module.js';
import { JobScheduler } from './modules/jobs/job-scheduler.js';
import { DevMailsModule } from './modules/notifications/dev-mails.module.js';
import { currentAppEnv, type AppEnv } from './shared/config/app-config.js';
import { ApiExceptionFilter } from './shared/errors/api-exception.filter.js';
import type { ListenerName } from './shared/logging/request-context.js';
import { RequestLogSink } from './shared/logging/request-log.js';
import { createRequestLoggingMiddleware } from './shared/logging/request-logging.middleware.js';
import { StaffAppModule } from './staff-app.module.js';

export interface ListenerDefinition {
  /** URL の接頭辞（公開用 API はすべて /api/guest、社内用 API はすべて /api/staff で始まる） */
  prefix: string;
  /** 既定のポート */
  port: number;
  module: Type;
  /** 開発環境（development・test）でだけ加えるモジュール（開発用の機能。production では読み込まない） */
  devModules?: readonly Type[];
}

export const LISTENERS = {
  guest: { prefix: 'api/guest', port: 3001, module: GuestAppModule },
  staff: {
    prefix: 'api/staff',
    port: 3002,
    module: StaffAppModule,
    // 作成したメールの一覧 GET /dev/mails（画面のテストで確認のリンクを取り出すため。tasks.md 3.4、TC-MB-207）
    devModules: [DevMailsModule],
  },
} as const satisfies Record<ListenerName, ListenerDefinition>;

/** 開発用の機能（devModules）を読み込む環境か。production では読み込まない */
export function devModulesEnabled(appEnv: AppEnv): boolean {
  return appEnv !== 'production';
}

/**
 * 待ち受け口の最上位のモジュール。開発環境では、その待ち受け口の開発用のモジュールを加える
 * （production では読み込まないので、開発用の URL そのものが存在しない）
 */
export function listenerRootModule(listener: ListenerName, appEnv: AppEnv): Type | DynamicModule {
  const definition: ListenerDefinition = LISTENERS[listener];
  const devModules = devModulesEnabled(appEnv) ? (definition.devModules ?? []) : [];
  if (devModules.length === 0) return definition.module;
  return { module: definition.module, imports: [...devModules] };
}

/** 待ち受け口に共通の仕組みを入れる（app.init() または listen() の前に呼ぶ） */
export function configureListener(app: NestExpressApplication, listener: ListenerName): void {
  app.disable('x-powered-by');
  app.setGlobalPrefix(LISTENERS[listener].prefix);
  app.use(createRequestLoggingMiddleware({ listener, sink: app.get(RequestLogSink) }));
  app.useGlobalFilters(new ApiExceptionFilter());
}

export interface CreateListenerOptions {
  /** NestJS のロガー（省略時は1行の JSON で標準出力に書く。false で出さない） */
  logger?: LoggerService | LogLevel[] | false;
  /** 読み込むモジュールを決める環境（省略時は APP_ENV。開発用の機能を production で読み込まないため） */
  appEnv?: AppEnv;
}

export async function createListenerApp(
  listener: ListenerName,
  options: CreateListenerOptions = {},
): Promise<INestApplication> {
  const appEnv = options.appEnv ?? currentAppEnv();
  const app = await NestFactory.create<NestExpressApplication>(
    listenerRootModule(listener, appEnv),
    {
      logger: options.logger ?? new ConsoleLogger({ json: true }),
      abortOnError: false,
    },
  );
  configureListener(app, listener);
  return app;
}

export interface RunningApis {
  guest: INestApplication;
  staff: INestApplication;
  /** 2つの待ち受け口を閉じる（定時処理は、実行中のものが終わるのを待ってから止まる） */
  close(): Promise<void>;
}

export interface StartApisOptions extends CreateListenerOptions {
  /** 社内用の待ち受け口で定時処理を始めるか（省略時は true。起動の確認だけをするテストでは false） */
  scheduleJobs?: boolean;
}

/**
 * 公開用と社内用の2つの待ち受け口を起動し、社内用の待ち受け口で定時処理を始める（research.md ADR-03・ADR-09）。
 * 定時処理はプロセスに1つの社内用の待ち受け口だけで動き、起動の時点では実行しない（最初の実行は次の時刻）。
 * @param ports 待ち受けるポート（省略時は公開用 3001・社内用 3002。0 なら空いているポート）
 */
export async function startApis(
  ports: Partial<Record<ListenerName, number>> = {},
  options: StartApisOptions = {},
): Promise<RunningApis> {
  const { scheduleJobs = true, ...listenerOptions } = options;
  const guest = await createListenerApp('guest', listenerOptions);
  const staff = await createListenerApp('staff', listenerOptions);
  const close = async (): Promise<void> => {
    await Promise.all([guest.close(), staff.close()]);
  };
  try {
    await guest.listen(ports.guest ?? LISTENERS.guest.port);
    await staff.listen(ports.staff ?? LISTENERS.staff.port);
    if (scheduleJobs) staff.get(JobScheduler).start();
  } catch (error) {
    await close();
    throw error;
  }
  return { guest, staff, close };
}
